import {
  mockAssistantMessage,
  mockConversation,
  mockUserMessage,
} from './intelligenceTabsTestHarness';
import type { AIConversation } from './intelligenceTabsTestHarness';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatTab } from '../../../src/components/Intelligence/tabs/ChatTab';
import { useChatTabController } from '../../../src/components/Intelligence/tabs/useChatTabController';
import * as intelligenceApi from '../../../src/api/intelligence';

describe('ChatTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(intelligenceApi.getConversations).mockReset().mockResolvedValue({ conversations: [] });
    vi.mocked(intelligenceApi.deleteConversation).mockReset().mockResolvedValue({ success: true });
    vi.mocked(intelligenceApi.getConversationMessages).mockReset().mockResolvedValue({ messages: [] });
    vi.mocked(intelligenceApi.createConversation).mockReset().mockResolvedValue({
      conversation: { ...mockConversation, id: 'new-conversation' },
    });
    vi.mocked(intelligenceApi.sendChatMessage).mockReset().mockResolvedValue({
      userMessage: mockUserMessage,
      assistantMessage: mockAssistantMessage,
    });
  });

  it('keeps the latest conversation when message loads complete in reverse', async () => {
    let resolveA!: (value: { messages: (typeof mockUserMessage)[] }) => void;
    let resolveB!: (value: { messages: (typeof mockUserMessage)[] }) => void;
    const conversationB = { ...mockConversation, id: 'conv-2', title: 'Conversation B' };
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation, conversationB],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockImplementation((id) => new Promise((resolve) => {
      if (id === 'conv-1') resolveA = resolve;
      else resolveB = resolve;
    }));
    render(<ChatTab walletId="wallet-1" />);
    await screen.findByText('UTXO Strategy Discussion');

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));
    fireEvent.click(screen.getByText('Conversation B'));
    await act(async () => resolveB({ messages: [{ ...mockUserMessage, id: 'b', content: 'B message' }] }));
    expect(await screen.findByText('B message')).toBeInTheDocument();
    await act(async () => resolveA({ messages: [{ ...mockUserMessage, id: 'a', content: 'A message' }] }));

    expect(screen.queryByText('A message')).not.toBeInTheDocument();
    expect(screen.getByText('B message')).toBeInTheDocument();
  });

  it('does not commit an old conversation send after selecting another conversation', async () => {
    let resolveSend!: (value: { userMessage: typeof mockUserMessage; assistantMessage: typeof mockAssistantMessage }) => void;
    const conversationB = { ...mockConversation, id: 'conv-2', title: 'Conversation B' };
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [mockConversation, conversationB] });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });
    vi.mocked(intelligenceApi.sendChatMessage).mockReturnValue(new Promise((resolve) => { resolveSend = resolve; }));
    render(<ChatTab walletId="wallet-1" />);
    await screen.findByText('UTXO Strategy Discussion');
    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));
    const textarea = await screen.findByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'A question' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    fireEvent.click(screen.getByText('Conversation B'));
    await act(async () => resolveSend({
      userMessage: { ...mockUserMessage, content: 'A question' },
      assistantMessage: { ...mockAssistantMessage, content: 'A answer' },
    }));

    expect(screen.queryByText('A answer')).not.toBeInTheDocument();
    expect(await screen.findByText('Ask anything about your wallet')).toBeInTheDocument();
  });

  it('does not let an in-flight list reinsert a conversation after delete', async () => {
    let resolveReload!: (value: { conversations: AIConversation[] }) => void;
    vi.mocked(intelligenceApi.getConversations)
      .mockResolvedValueOnce({ conversations: [mockConversation] })
      .mockReturnValueOnce(new Promise((resolve) => { resolveReload = resolve; }))
      .mockResolvedValueOnce({ conversations: [] });
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    act(() => { void result.current.reloadConversations(); });
    act(() => { void result.current.handleDeleteConversation('conv-1'); });
    await waitFor(() => expect(intelligenceApi.deleteConversation).toHaveBeenCalledWith('conv-1'));
    await act(async () => resolveReload({ conversations: [mockConversation] }));

    expect(result.current.conversations).toEqual([]);
  });

  it('ignores stale list and mutation failures after a newer list generation', async () => {
    let rejectReload!: (error: Error) => void;
    vi.mocked(intelligenceApi.getConversations)
      .mockResolvedValueOnce({ conversations: [mockConversation] })
      .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectReload = reject; }))
      .mockResolvedValueOnce({ conversations: [] });
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    act(() => { void result.current.reloadConversations(); });
    act(() => { void result.current.handleDeleteConversation('conv-1'); });
    await act(async () => rejectReload(new Error('stale list')));
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));
  });

  it('settles an initial pending list after create and keeps the authoritative new row', async () => {
    let resolveInitial!: (value: { conversations: AIConversation[] }) => void;
    const created = { ...mockConversation, id: 'created', title: 'Created conversation' };
    vi.mocked(intelligenceApi.getConversations)
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({ conversations: [created] });
    vi.mocked(intelligenceApi.createConversation).mockResolvedValue({ conversation: created });
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));

    act(() => { void result.current.handleNewConversation(); });
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));
    expect(result.current.conversations).toEqual([created]);
    await act(async () => resolveInitial({ conversations: [] }));
    expect(result.current.conversations).toEqual([created]);
  });

  it('settles an initial pending list after delete without reinserting the deleted row', async () => {
    let resolveInitial!: (value: { conversations: AIConversation[] }) => void;
    vi.mocked(intelligenceApi.getConversations)
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({ conversations: [] });
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));

    act(() => { void result.current.handleDeleteConversation('conv-1'); });
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));
    expect(result.current.conversations).toEqual([]);
    await act(async () => resolveInitial({ conversations: [mockConversation] }));
    expect(result.current.conversations).toEqual([]);
  });

  it('restores the authoritative list when create rejects during the initial list read', async () => {
    let resolveInitial!: (value: { conversations: AIConversation[] }) => void;
    vi.mocked(intelligenceApi.getConversations)
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({ conversations: [mockConversation] });
    vi.mocked(intelligenceApi.createConversation).mockRejectedValue(new Error('create failed'));
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));

    act(() => { void result.current.handleNewConversation(); });
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));
    expect(result.current.conversations).toEqual([mockConversation]);
    await act(async () => resolveInitial({ conversations: [] }));
    expect(result.current.conversations).toEqual([mockConversation]);
  });

  it('restores the authoritative list when delete rejects during the initial list read', async () => {
    let resolveInitial!: (value: { conversations: AIConversation[] }) => void;
    vi.mocked(intelligenceApi.getConversations)
      .mockReturnValueOnce(new Promise((resolve) => { resolveInitial = resolve; }))
      .mockResolvedValueOnce({ conversations: [mockConversation] });
    vi.mocked(intelligenceApi.deleteConversation).mockRejectedValue(new Error('delete failed'));
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));

    act(() => { void result.current.handleDeleteConversation('conv-1'); });
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));
    expect(result.current.conversations).toEqual([mockConversation]);
    await act(async () => resolveInitial({ conversations: [] }));
    expect(result.current.conversations).toEqual([mockConversation]);
  });

  it('ignores stale create and delete completions superseded by a list reload', async () => {
    let resolveCreate!: (value: { conversation: AIConversation }) => void;
    let resolveDelete!: (value: { success: boolean }) => void;
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(intelligenceApi.createConversation).mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    vi.mocked(intelligenceApi.deleteConversation).mockReturnValue(new Promise((resolve) => { resolveDelete = resolve; }));
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));
    await waitFor(() => expect(result.current.loadingConversations).toBe(false));

    act(() => { void result.current.handleNewConversation(); });
    await act(async () => { await result.current.reloadConversations(); });
    await act(async () => resolveCreate({ conversation: mockConversation }));
    expect(result.current.conversations).toEqual([]);

    act(() => { void result.current.handleDeleteConversation('conv-1'); });
    await act(async () => { await result.current.reloadConversations(); });
    await act(async () => resolveDelete({ success: true }));
    expect(result.current.conversations).toEqual([]);
  });

  it('ignores stale create, delete, message-load, and send rejections', async () => {
    let rejectCreate!: (error: Error) => void;
    let rejectDelete!: (error: Error) => void;
    let rejectLoad!: (error: Error) => void;
    let rejectSend!: (error: Error) => void;
    const conversationB = { ...mockConversation, id: 'conv-2', title: 'Conversation B' };
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [mockConversation, conversationB] });
    vi.mocked(intelligenceApi.createConversation).mockReturnValue(new Promise((_resolve, reject) => { rejectCreate = reject; }));
    vi.mocked(intelligenceApi.deleteConversation).mockReturnValue(new Promise((_resolve, reject) => { rejectDelete = reject; }));
    vi.mocked(intelligenceApi.getConversationMessages).mockImplementation((id) => id === 'conv-1'
      ? new Promise((_resolve, reject) => { rejectLoad = reject; })
      : Promise.resolve({ messages: [] }));
    vi.mocked(intelligenceApi.sendChatMessage).mockReturnValue(new Promise((_resolve, reject) => { rejectSend = reject; }));
    const { result } = renderHook(() => useChatTabController({ walletId: 'wallet-1' }));
    await waitFor(() => expect(result.current.conversations).toHaveLength(2));

    act(() => { void result.current.handleNewConversation(); });
    await act(async () => { await result.current.reloadConversations(); });
    await act(async () => rejectCreate(new Error('stale create')));
    act(() => { void result.current.handleDeleteConversation('conv-1'); });
    await act(async () => { await result.current.reloadConversations(); });
    await act(async () => rejectDelete(new Error('stale delete')));

    act(() => result.current.setSelectedConversationId('conv-1'));
    await waitFor(() => expect(intelligenceApi.getConversationMessages).toHaveBeenCalledWith('conv-1'));
    act(() => result.current.setSelectedConversationId('conv-2'));
    await act(async () => rejectLoad(new Error('stale load')));

    act(() => result.current.setSelectedConversationId('conv-1'));
    act(() => result.current.setInput('Question'));
    act(() => { void result.current.handleSend(); });
    act(() => result.current.setSelectedConversationId('conv-2'));
    await act(async () => rejectSend(new Error('stale send')));
    expect(result.current.input).toBe('');
  });

  it('should show loading spinner while conversations load', () => {
    vi.mocked(intelligenceApi.getConversations).mockReturnValue(new Promise(() => {}));

    const { container } = render(<ChatTab walletId="wallet-1" />);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('should show empty conversation list', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
  });

  it('should render conversation list', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });
  });

  it('should show "New Conversation" button', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New Conversation')).toBeInTheDocument();
    });
  });

  it('should show placeholder when no conversation is selected', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('Treasury Intelligence Chat')).toBeInTheDocument();
    });

    expect(screen.getByText('Select a conversation or start a new one')).toBeInTheDocument();
  });

  it('should create a new conversation when button is clicked', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(intelligenceApi.createConversation).mockResolvedValue({
      conversation: {
        id: 'new-conv',
        userId: 'user-1',
        walletId: 'wallet-1',
        createdAt: '2024-06-01',
        updatedAt: '2024-06-01',
      },
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New Conversation')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Conversation'));

    await waitFor(() => {
      expect(intelligenceApi.createConversation).toHaveBeenCalledWith('wallet-1');
    });
  });

  it('should load messages when a conversation is selected', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({
      messages: [mockUserMessage, mockAssistantMessage],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    // Click on conversation
    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(intelligenceApi.getConversationMessages).toHaveBeenCalledWith('conv-1');
    });

    await waitFor(() => {
      expect(screen.getByText('What is my UTXO health?')).toBeInTheDocument();
      expect(screen.getByText('Your UTXO health is good with 12 UTXOs.')).toBeInTheDocument();
    });
  });

  it('should render message input area when conversation is selected', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });
  });

  it('should send a message when Enter is pressed', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'How are my UTXOs?' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => {
      expect(intelligenceApi.sendChatMessage).toHaveBeenCalledWith('conv-1', 'How are my UTXOs?');
    });
  });

  it('should not send when Enter+Shift is pressed (multiline)', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'test' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

    expect(intelligenceApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it('should not send empty messages', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(intelligenceApi.sendChatMessage).not.toHaveBeenCalled();
  });

  it('should delete a conversation', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    // Find the delete button
    const deleteButton = screen.getByTitle('Delete conversation');
    fireEvent.click(deleteButton);

    await waitFor(() => {
      expect(intelligenceApi.deleteConversation).toHaveBeenCalledWith('conv-1');
    });
  });

  it('should delete selected conversation and clear messages', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({
      messages: [mockUserMessage],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    // Select the conversation first
    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByText('What is my UTXO health?')).toBeInTheDocument();
    });

    // Delete the selected conversation - wait for delete button to be available
    await waitFor(() => {
      expect(screen.getByTitle('Delete conversation')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTitle('Delete conversation'));

    await waitFor(() => {
      expect(intelligenceApi.deleteConversation).toHaveBeenCalledWith('conv-1');
    });

    // Should show the placeholder again
    await waitFor(() => {
      expect(screen.getByText('Select a conversation or start a new one')).toBeInTheDocument();
    });
  });

  it('should show "Ask anything about your wallet" when conversation is empty', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByText('Ask anything about your wallet')).toBeInTheDocument();
    });
  });

  it('should render "New conversation" for conversations without title', async () => {
    const untitledConv: AIConversation = {
      ...mockConversation,
      id: 'conv-untitled',
      title: undefined,
    };
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [untitledConv],
    });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New conversation')).toBeInTheDocument();
    });
  });

  it('should handle send message API failure gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });
    vi.mocked(intelligenceApi.sendChatMessage).mockRejectedValue(new Error('Send failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'test message' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    // Input should be restored after failure
    await waitFor(() => {
      expect(textarea).toHaveValue('test message');
    });
  });

  it('should handle getConversations API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockRejectedValue(new Error('Network error'));

    render(<ChatTab walletId="wallet-1" />);

    // Should show empty conversation state
    await waitFor(() => {
      expect(screen.getByText('No conversations yet')).toBeInTheDocument();
    });
  });

  it('should handle getConversationMessages API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockRejectedValue(new Error('Load failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    // Should not crash, empty messages shown
    await waitFor(() => {
      expect(screen.getByText('Ask anything about your wallet')).toBeInTheDocument();
    });
  });

  it('should handle createConversation API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(intelligenceApi.createConversation).mockRejectedValue(new Error('Create failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('New Conversation')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('New Conversation'));

    // Should not crash
    await waitFor(() => {
      expect(intelligenceApi.createConversation).toHaveBeenCalled();
    });
  });

  it('should handle deleteConversation API error gracefully', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.deleteConversation).mockRejectedValue(new Error('Delete failed'));

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    const deleteButton = screen.getByTitle('Delete conversation');
    fireEvent.click(deleteButton);

    // Should not crash
    await waitFor(() => {
      expect(intelligenceApi.deleteConversation).toHaveBeenCalled();
    });
  });

  it('should send message via send button click', async () => {
    vi.mocked(intelligenceApi.getConversations).mockResolvedValue({
      conversations: [mockConversation],
    });
    vi.mocked(intelligenceApi.getConversationMessages).mockResolvedValue({ messages: [] });

    render(<ChatTab walletId="wallet-1" />);

    await waitFor(() => {
      expect(screen.getByText('UTXO Strategy Discussion')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('UTXO Strategy Discussion'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Ask about your wallet...')).toBeInTheDocument();
    });

    const textarea = screen.getByPlaceholderText('Ask about your wallet...');
    fireEvent.change(textarea, { target: { value: 'Test via button' } });

    // Find the send button (the one with the Send icon, which is the button next to the textarea)
    const buttons = screen.getAllByRole('button');
    // The send button is the last button in the input area
    const sendButton = buttons[buttons.length - 1];
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(intelligenceApi.sendChatMessage).toHaveBeenCalledWith('conv-1', 'Test via button');
    });
  });
});
