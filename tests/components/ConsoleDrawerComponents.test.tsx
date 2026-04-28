import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ConsoleMessageList } from '../../components/ConsoleDrawer/ConsoleMessageList';
import { ConsoleScopeSelector } from '../../components/ConsoleDrawer/ConsoleScopeSelector';
import { MAX_WALLET_SET_SCOPE_WALLETS } from '../../components/ConsoleDrawer/consoleDrawerUtils';
import type { ConsoleMessage } from '../../components/ConsoleDrawer/types';
import { KeyboardShortcutsModal } from '../../components/Layout/KeyboardShortcutsModal';

function turnMessages(id: string, prompt: string, response: string): ConsoleMessage[] {
  return [
    {
      id: `${id}:prompt`,
      role: 'user',
      content: prompt,
      createdAt: '2026-04-26T01:00:00.000Z',
    },
    {
      id: `${id}:response`,
      role: 'assistant',
      content: response,
      createdAt: '2026-04-26T01:00:01.000Z',
      state: 'completed',
    },
  ];
}

describe('Console drawer child components', () => {
  it('renders compressed history summaries with duplicate rerun counts', () => {
    const messages = [
      ...turnMessages('turn-1', 'current block?', 'block 840000'),
      ...Array.from({ length: 8 }, (_, index) =>
        turnMessages(
          `turn-${index + 2}`,
          `prompt ${index}`,
          `response ${index}`,
        ),
      ).flat(),
      ...turnMessages('turn-10', 'current block?', 'block 840000'),
    ];

    const { rerender } = render(
      <ConsoleMessageList
        messages={messages}
        loading={false}
        sending={false}
        messagesEndRef={React.createRef<HTMLDivElement>()}
      />,
    );

    expect(screen.getByText(/Earlier history compressed/i)).toHaveTextContent(
      '4 messages hidden · 1 duplicate rerun hidden',
    );

    rerender(
      <ConsoleMessageList
        messages={Array.from({ length: 10 }, (_, index) =>
          turnMessages(
            `unique-turn-${index}`,
            `unique prompt ${index}`,
            `unique response ${index}`,
          ),
        ).flat()}
        loading={false}
        sending={false}
        messagesEndRef={React.createRef<HTMLDivElement>()}
      />,
    );

    const summary = screen.getByText(/Earlier history compressed/i);
    expect(summary).toHaveTextContent('4 messages hidden');
    expect(summary).not.toHaveTextContent('duplicate rerun');
  });

  it('labels all-wallet scope truncation in the selector', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const wallets = Array.from(
      { length: MAX_WALLET_SET_SCOPE_WALLETS + 1 },
      (_, index) => ({
        id: `wallet-${index}`,
        name: `Wallet ${index}`,
        type: 'single_sig',
      }),
    ) as any;

    render(
      <ConsoleScopeSelector
        wallets={wallets}
        selectedWalletId="auto"
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole('option', {
        name: `All visible wallets (first ${MAX_WALLET_SET_SCOPE_WALLETS})`,
      }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Console context'), 'wallet-2');
    expect(onChange).toHaveBeenCalledWith('wallet-2');
  });
});

describe('KeyboardShortcutsModal', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <KeyboardShortcutsModal
        show={false}
        consoleAvailable={true}
        onClose={vi.fn()}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('filters the AI Console shortcut by availability and closes from the icon button', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <KeyboardShortcutsModal
        show
        consoleAvailable={false}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('Show keyboard shortcuts')).toBeInTheDocument();
    expect(screen.queryByText('Open AI Console')).not.toBeInTheDocument();

    rerender(
      <KeyboardShortcutsModal show consoleAvailable={true} onClose={onClose} />,
    );
    expect(screen.getByText('Open AI Console')).toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: 'Close keyboard shortcuts' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
