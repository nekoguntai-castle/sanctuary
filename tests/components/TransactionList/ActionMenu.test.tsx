import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActionMenu } from '../../../components/TransactionList/ActionMenu';
import { getTxExplorerUrl } from '../../../utils/explorer';
import type { Transaction, Wallet } from '../../../types';

vi.mock('../../../utils/explorer', () => ({
  getTxExplorerUrl: vi.fn(() => 'https://explorer.example/tx/mock'),
}));

vi.mock('../../../components/TransactionActions', () => ({
  TransactionActions: ({
    isReceived,
    onActionComplete,
  }: {
    isReceived: boolean;
    onActionComplete: () => void;
  }) => (
    <div data-testid="tx-actions" data-is-received={String(isReceived)}>
      <button onClick={onActionComplete}>complete-action</button>
    </div>
  ),
}));

const makeTx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: 'tx-1',
  txid: 'abc123',
  walletId: 'wallet-1',
  amount: -1000,
  confirmations: 0,
  ...overrides,
});

const wallets: Wallet[] = [
  {
    id: 'wallet-1',
    name: 'Main',
    type: 'watchonly',
    network: 'testnet',
    balance: 0,
  },
];

describe('TransactionList ActionMenu', () => {
  it('copies transaction ID and reflects copied state icon/title branch', async () => {
    const user = userEvent.setup();
    const onCopyToClipboard = vi.fn();

    const { rerender } = render(
      <ActionMenu
        selectedTx={makeTx()}
        wallets={wallets}
        walletAddresses={[]}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={onCopyToClipboard}
        onClose={vi.fn()}
      />
    );

    const copyButton = screen.getByTitle('Copy to clipboard');
    await user.click(copyButton);
    expect(onCopyToClipboard).toHaveBeenCalledWith('abc123');

    rerender(
      <ActionMenu
        selectedTx={makeTx()}
        wallets={wallets}
        walletAddresses={[]}
        explorerUrl="https://mempool.space"
        copied={true}
        onCopyToClipboard={onCopyToClipboard}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByTitle('Copied!')).toBeInTheDocument();
  });

  it('builds explorer link using wallet network and falls back to mainnet when wallet is missing', () => {
    const { rerender } = render(
      <ActionMenu
        selectedTx={makeTx({ walletId: 'wallet-1' })}
        wallets={wallets}
        walletAddresses={[]}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(getTxExplorerUrl).toHaveBeenCalledWith('abc123', 'testnet', 'https://mempool.space');

    rerender(
      <ActionMenu
        selectedTx={makeTx({ walletId: 'missing-wallet' })}
        wallets={wallets}
        walletAddresses={[]}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(getTxExplorerUrl).toHaveBeenLastCalledWith('abc123', 'mainnet', 'https://mempool.space');
    expect(screen.getByRole('link', { name: /view on block explorer/i })).toHaveAttribute(
      'href',
      'https://explorer.example/tx/mock'
    );
  });

  it('passes consolidation receive-override and invokes close + optional label refresh after action completion', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onLabelsChange = vi.fn();

    render(
      <ActionMenu
        selectedTx={makeTx({
          amount: 2000,
          type: 'consolidation',
          counterpartyAddress: 'bc1qours',
        })}
        wallets={wallets}
        walletAddresses={['bc1qours']}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={vi.fn()}
        onClose={onClose}
        onLabelsChange={onLabelsChange}
      />
    );

    expect(screen.getByTestId('tx-actions')).toHaveAttribute('data-is-received', 'false');

    await user.click(screen.getByRole('button', { name: 'complete-action' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onLabelsChange).toHaveBeenCalledTimes(1);
  });

  it('handles pending action completion when onLabelsChange is not provided and hides actions for confirmed txs', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    const { rerender } = render(
      <ActionMenu
        selectedTx={makeTx({ amount: 1500, type: 'received' })}
        wallets={wallets}
        walletAddresses={[]}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.getByTestId('tx-actions')).toHaveAttribute('data-is-received', 'true');
    await user.click(screen.getByRole('button', { name: 'complete-action' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <ActionMenu
        selectedTx={makeTx({ confirmations: 1 })}
        wallets={wallets}
        walletAddresses={[]}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={vi.fn()}
        onClose={onClose}
      />
    );

    expect(screen.queryByTestId('tx-actions')).not.toBeInTheDocument();
  });

  it('treats self-transfer transactions as consolidation via counterparty address match', () => {
    render(
      <ActionMenu
        selectedTx={makeTx({
          amount: 1200,
          type: 'received',
          counterpartyAddress: 'bc1qself',
        })}
        wallets={wallets}
        walletAddresses={['bc1qself']}
        explorerUrl="https://mempool.space"
        copied={false}
        onCopyToClipboard={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId('tx-actions')).toHaveAttribute('data-is-received', 'false');
  });
});
