import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueuedSummaryBlock } from '../../../components/BlockVisualizer/QueuedSummaryBlock';
import type { PendingTransaction } from '../../../src/types';

vi.mock('../../../components/BlockVisualizer/PendingTxDot', () => ({
  PendingTxDot: ({
    tx,
    explorerUrl,
    compact,
    isStuck,
  }: {
    tx: PendingTransaction;
    explorerUrl: string;
    compact: boolean;
    isStuck: boolean;
  }) => (
    <span
      data-testid="pending-dot"
      data-txid={tx.txid}
      data-explorer={explorerUrl}
      data-compact={String(compact)}
      data-stuck={String(isStuck)}
    />
  ),
}));

const makeTx = (index: number): PendingTransaction => ({
  txid: `stuck-${index}`,
  walletId: 'wallet-1',
  type: 'sent',
  amount: -1000,
  fee: 100,
  feeRate: 1,
  timeInQueue: 3600,
  createdAt: '2025-01-01T00:00:00.000Z',
});

describe('QueuedSummaryBlock', () => {
  it('renders non-compact queued summary with stuck dots, overflow, and hasMore indicator', () => {
    const stuckTxs = [1, 2, 3, 4, 5, 6].map(makeTx);
    const { container } = render(
      <QueuedSummaryBlock
        summary={{ blockCount: 10, totalTransactions: 12345, averageFee: 12.6, totalFees: 0 }}
        compact={false}
        stuckTxs={stuckTxs}
        explorerUrl="https://custom.explorer"
      />
    );

    expect(screen.getByText('Queue')).toBeInTheDocument();
    expect(screen.getByText('Median Fee')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument();
    expect(screen.getByText('+10 BLKS')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('+')).toBeInTheDocument();
    expect(screen.getByText('12,345 txs waiting • 6 stuck')).toBeInTheDocument();

    const dots = screen.getAllByTestId('pending-dot');
    expect(dots).toHaveLength(5);
    expect(container.querySelector('[data-txid="stuck-1"]')).toHaveAttribute('data-stuck', 'true');
    expect(container.querySelector('[data-txid="stuck-1"]')).toHaveAttribute(
      'data-explorer',
      'https://custom.explorer'
    );

    // Bottom mini-blocks are capped at 8 visible blocks.
    expect(container.querySelectorAll('.bg-warning-800').length).toBe(8);
  });

  it('renders compact mode with compact limits/labels and without non-compact tooltip', () => {
    const stuckTxs = [1, 2, 3, 4].map(makeTx);

    render(
      <QueuedSummaryBlock
        summary={{ blockCount: 3, totalTransactions: 20, averageFee: 0.7, totalFees: 0 }}
        compact={true}
        stuckTxs={stuckTxs}
      />
    );

    expect(screen.queryByText('Queue')).not.toBeInTheDocument();
    expect(screen.queryByText('Median Fee')).not.toBeInTheDocument();
    expect(screen.getByText('0.7')).toBeInTheDocument();
    expect(screen.getByText('+3')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.queryByText(/txs waiting/)).not.toBeInTheDocument();
    expect(screen.getAllByTestId('pending-dot')).toHaveLength(3);
  });

  it('handles empty stuck transaction list and omits stuck text', () => {
    render(
      <QueuedSummaryBlock
        summary={{ blockCount: 1, totalTransactions: 50, averageFee: 5, totalFees: 0 }}
        compact={false}
      />
    );

    expect(screen.queryByTestId('pending-dot')).not.toBeInTheDocument();
    expect(screen.getByText('50 txs waiting')).toBeInTheDocument();
  });

  it('uses default explorer URL for pending dots when no explorerUrl is provided', () => {
    render(
      <QueuedSummaryBlock
        summary={{ blockCount: 2, totalTransactions: 5, averageFee: 3, totalFees: 0 }}
        compact={false}
        stuckTxs={[makeTx(1)]}
      />
    );

    expect(screen.getByTestId('pending-dot')).toHaveAttribute('data-explorer', 'https://mempool.space');
  });
});
