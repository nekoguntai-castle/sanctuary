import { mockAssistantMessage, mockConversation, mockUserMessage } from './intelligenceTabsTestHarness';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTab } from '../../../src/components/Intelligence/tabs/ChatTab';
import * as api from '../../../src/api/intelligence';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type History = Awaited<ReturnType<typeof api.getConversationMessages>>;
const response = { userMessage: mockUserMessage, assistantMessage: mockAssistantMessage };

async function selectConversation() {
  const user = userEvent.setup();
  render(<ChatTab walletId="wallet-1" />);
  await user.click(await screen.findByText(mockConversation.title!));
  const input = screen.getByPlaceholderText('Ask about your wallet...');
  const send = input.parentElement!.querySelector('button')!;
  return { user, input, send };
}

async function settleHistory(history: ReturnType<typeof deferred<History>>, fails = false) {
  await act(async () => {
    if (fails) history.reject(new Error('History unavailable'));
    else history.resolve({ messages: [] });
  });
}

describe('Chat readiness and repeated selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getConversations).mockReset().mockResolvedValue({ conversations: [mockConversation] });
    vi.mocked(api.getConversationMessages).mockReset().mockResolvedValue({ messages: [] });
    vi.mocked(api.sendChatMessage).mockReset().mockResolvedValue(response);
    vi.mocked(api.createConversation).mockReset();
    vi.mocked(api.deleteConversation).mockReset();
  });

  it.each(['keyboard', 'button'] as const)('retains typed text until history settles, then sends through %s', async method => {
    const history = deferred<History>();
    vi.mocked(api.getConversationMessages).mockReturnValue(history.promise);
    const { user, input, send } = await selectConversation();
    await user.type(input, mockUserMessage.content);
    await user.keyboard('{Enter}');
    expect(api.sendChatMessage).not.toHaveBeenCalled();
    expect(send).toBeDisabled();
    await user.click(send);
    expect(api.sendChatMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue(mockUserMessage.content);
    await settleHistory(history);
    expect(send).toBeEnabled();
    expect(input).toHaveValue(mockUserMessage.content);
    if (method === 'keyboard') {
      await user.click(input);
      await user.keyboard('{Enter}');
    } else await user.click(send);
    expect(await screen.findByText(mockAssistantMessage.content)).toBeInTheDocument();
    expect(api.sendChatMessage).toHaveBeenCalledExactlyOnceWith('conv-1', mockUserMessage.content);
  });

  it('releases readiness after history failure without losing typed input', async () => {
    const history = deferred<History>();
    vi.mocked(api.getConversationMessages).mockReturnValue(history.promise);
    const { user, input, send } = await selectConversation();
    await user.type(input, mockUserMessage.content);
    expect(send).toBeDisabled();
    await settleHistory(history, true);
    expect(input).toHaveValue(mockUserMessage.content);
    expect(send).toBeEnabled();
    await user.click(send);
    expect(await screen.findByText(mockAssistantMessage.content)).toBeInTheDocument();
  });

  it.each([false, true])('keeps B gated when stale A settles (failure=%s)', async fails => {
    const a = deferred<History>();
    const b = deferred<History>();
    vi.mocked(api.getConversations).mockResolvedValue({ conversations: [mockConversation, { ...mockConversation, id: 'conv-2', title: 'Conversation B' }] });
    vi.mocked(api.getConversationMessages).mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const { user, input, send } = await selectConversation();
    await user.type(input, 'A draft');
    await user.click(screen.getByText('Conversation B'));
    expect(input).toHaveValue('');
    await user.type(input, 'B draft');
    await settleHistory(a, fails);
    expect(send).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(api.sendChatMessage).not.toHaveBeenCalled();
    expect(input).toHaveValue('B draft');
    await settleHistory(b);
    expect(send).toBeEnabled();
  });

  it('preserves loaded messages and draft when the selected row is clicked again', async () => {
    vi.mocked(api.getConversationMessages).mockResolvedValue({ messages: [mockAssistantMessage] });
    const { user, input, send } = await selectConversation();
    expect(await screen.findByText(mockAssistantMessage.content)).toBeInTheDocument();
    await user.type(input, 'Unsent draft');
    await user.click(screen.getByText(mockConversation.title!));
    expect(screen.getByText(mockAssistantMessage.content)).toBeInTheDocument();
    expect(input).toHaveValue('Unsent draft');
    expect(send).toBeEnabled();
    expect(api.getConversationMessages).toHaveBeenCalledTimes(1);
  });

  it('preserves draft and original history owner on repeated pending selection', async () => {
    const history = deferred<History>();
    vi.mocked(api.getConversationMessages).mockReturnValue(history.promise);
    const { user, input, send } = await selectConversation();
    await user.type(input, 'Unsent draft');
    await user.click(screen.getByText(mockConversation.title!));
    expect(input).toHaveValue('Unsent draft');
    expect(send).toBeDisabled();
    await act(async () => history.resolve({ messages: [mockAssistantMessage] }));
    expect(screen.getByText(mockAssistantMessage.content)).toBeInTheDocument();
    expect(send).toBeEnabled();
    expect(api.getConversationMessages).toHaveBeenCalledTimes(1);
  });

  it('preserves an admitted send and its busy state on repeated selection', async () => {
    const pending = deferred<typeof response>();
    vi.mocked(api.sendChatMessage).mockReturnValue(pending.promise);
    const { user, input, send } = await selectConversation();
    await screen.findByText('Ask anything about your wallet');
    await user.type(input, mockUserMessage.content);
    await user.click(send);
    await user.type(input, 'Next draft');
    await user.click(screen.getByText(mockConversation.title!));
    expect(send).toBeDisabled();
    expect(input).toHaveValue('Next draft');
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
    await act(async () => pending.resolve(response));
    expect(screen.getByText(mockAssistantMessage.content)).toBeInTheDocument();
    expect(input).toHaveValue('Next draft');
    expect(send).toBeEnabled();
    expect(api.sendChatMessage).toHaveBeenCalledTimes(1);
    expect(api.getConversationMessages).toHaveBeenCalledTimes(1);
  });
});
