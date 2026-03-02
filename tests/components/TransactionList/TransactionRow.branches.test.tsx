import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransactionRow } from '../../../components/TransactionList/TransactionRow';
import type { Transaction, Wallet } from '../../../types';

vi.mock('../../../components/Amount', () => ({
  Amount: ({
    sats = 0,
    showSign,
  }: {
    sats?: number;
    showSign?: boolean;
  }) => <span data-testid="amount">{showSign && sats > 0 ? '+' : ''}{String(sats)}</span>,
}));

vi.mock('../../../components/LabelSelector', () => ({
  LabelBadges: ({ labels }: { labels: Array<{ id: string; name: string }> }) => (
    <span data-testid="label-badges">{labels.length}</span>
  ),
}));

vi.mock('lucide-react', () => ({
  ArrowDownLeft: () => <span data-testid="arrow-down-left" />,
  ArrowUpRight: () => <span data-testid="arrow-up-right" />,
  RefreshCw: () => <span data-testid="refresh-cw" />,
  Clock: () => <span data-testid="clock" />,
  Tag: () => <span data-testid="tag" />,
  CheckCircle2: () => <span data-testid="check-circle" />,
  ShieldCheck: () => <span data-testid="shield-check" />,
}));

const baseTx: Transaction = {
  id: 'tx-1',
  txid: 'txid-1',
  walletId: 'wallet-1',
  amount: 1000,
  confirmations: 1,
  timestamp: Date.now(),
  labels: [],
  rbfStatus: null,
};

const singleSigWallet: Wallet = {
  id: 'wallet-1',
  name: 'Single Wallet',
  type: 'single_sig',
  balance: 0,
};

const multiSigWallet: Wallet = {
  id: 'wallet-2',
  name: 'Multi Wallet',
  type: 'multi_sig',
  balance: 0,
};

const renderRow = (
  txOverrides: Partial<Transaction> = {},
  propOverrides: Partial<React.ComponentProps<typeof TransactionRow>> = {}
) => {
  const onTxClick = vi.fn();
  const props: React.ComponentProps<typeof TransactionRow> = {
    tx: { ...baseTx, ...txOverrides },
    isReceive: true,
    isConsolidation: false,
    isHighlighted: false,
    txWallet: singleSigWallet,
    showWalletBadge: false,
    walletBalance: undefined,
    confirmationThreshold: 2,
    deepConfirmationThreshold: 6,
    onTxClick,
    ...propOverrides,
  };

  const view = render(
    <table>
      <tbody>
        <tr>
          <TransactionRow {...props} />
        </tr>
      </tbody>
    </table>
  );

  return { ...view, props, onTxClick };
};

describe('TransactionRow branch coverage', () => {
  it('renders consolidation with pending timestamp and pending confirmation', () => {
    renderRow(
      { timestamp: undefined, confirmations: 0, amount: 2500 },
      { isConsolidation: true, isReceive: false }
    );

    expect(screen.getAllByText('Pending').length).toBeGreaterThan(0);
    expect(screen.getByTestId('refresh-cw')).toBeInTheDocument();
    expect(screen.getByText('Consolidation')).toBeInTheDocument();
    expect(screen.getByTestId('clock')).toBeInTheDocument();
  });

  it('renders receive path with confirmed branch and balance fallback to zero', () => {
    renderRow(
      { confirmations: 3, balanceAfter: undefined },
      { isReceive: true, isConsolidation: false, walletBalance: 12345 }
    );

    expect(screen.getByTestId('arrow-down-left')).toBeInTheDocument();
    expect(screen.getByText('Received')).toBeInTheDocument();
    expect(screen.getByTestId('check-circle')).toBeInTheDocument();
    expect(screen.getByText('3/6')).toBeInTheDocument();
    expect(screen.getAllByTestId('amount').some(node => node.textContent === '0')).toBe(true);
  });

  it('renders sent path with confirming branch', () => {
    renderRow(
      { confirmations: 1, amount: -1500 },
      { isReceive: false, isConsolidation: false, confirmationThreshold: 2, deepConfirmationThreshold: 6 }
    );

    expect(screen.getByTestId('arrow-up-right')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('1/6')).toBeInTheDocument();
  });

  it('uses deep confirmation fallback when toLocaleString returns empty string', () => {
    const strangeConfirmations = {
      valueOf: () => 99,
      toLocaleString: () => '',
    } as any;

    renderRow(
      { confirmations: strangeConfirmations },
      { confirmationThreshold: 2, deepConfirmationThreshold: 6 }
    );

    expect(screen.getByTestId('shield-check')).toBeInTheDocument();
  });

  it('renders labels branches for labels array, singular label, and empty state', () => {
    const { rerender, props } = renderRow({
      labels: [{ id: 'label-1', name: 'Important', color: '#f00' } as any],
    });
    expect(screen.getByTestId('label-badges')).toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <tr>
            <TransactionRow
              {...props}
              tx={{ ...props.tx, labels: [], label: 'Manual Label' }}
            />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByText('Manual Label')).toBeInTheDocument();
    expect(screen.getByTestId('tag')).toBeInTheDocument();

    rerender(
      <table>
        <tbody>
          <tr>
            <TransactionRow
              {...props}
              tx={{ ...props.tx, labels: [], label: undefined }}
            />
          </tr>
        </tbody>
      </table>
    );
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('invokes onTxClick for each clickable cell including wallet balance and badge cell', () => {
    const { onTxClick } = renderRow(
      { confirmations: 2 },
      {
        walletBalance: 1000,
        showWalletBadge: true,
        txWallet: singleSigWallet,
      }
    );

    const cells = screen.getAllByRole('cell');
    cells.forEach(cell => fireEvent.click(cell));

    expect(onTxClick.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('supports wallet badge click without callback (multisig style path)', () => {
    const { onTxClick } = renderRow(
      {},
      {
        showWalletBadge: true,
        txWallet: multiSigWallet,
        onWalletClick: undefined,
      }
    );

    fireEvent.click(screen.getByText('Multi Wallet'));
    expect(onTxClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'tx-1' }));
  });

  it('calls onWalletClick and stops propagation when wallet callback is provided', () => {
    const onWalletClick = vi.fn();
    const { onTxClick } = renderRow(
      {},
      {
        showWalletBadge: true,
        txWallet: singleSigWallet,
        onWalletClick,
      }
    );

    fireEvent.click(screen.getByText('Single Wallet'));

    expect(onWalletClick).toHaveBeenCalledWith('wallet-1');
    expect(onTxClick).not.toHaveBeenCalled();
  });
});
