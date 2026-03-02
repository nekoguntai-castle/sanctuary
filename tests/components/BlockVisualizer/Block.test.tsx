import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Block } from '../../../components/BlockVisualizer/Block';
import type { PendingTransaction } from '../../../src/types';
import type { BlockData } from '../../../components/BlockVisualizer/types';

vi.mock('lucide-react', () => ({
  Clock: () => <span data-testid="clock-icon" />,
}));

vi.mock('../../../components/BlockVisualizer/PendingTxDot', () => ({
  PendingTxDot: ({
    tx,
    isStuck,
    compact,
  }: {
    tx: PendingTransaction;
    isStuck?: boolean;
    compact: boolean;
  }) => (
    <span
      data-testid="pending-dot"
      data-txid={tx.txid}
      data-stuck={String(Boolean(isStuck))}
      data-compact={String(compact)}
    />
  ),
}));

const makePendingTx = (index: number, feeRate: number): PendingTransaction => ({
  txid: `tx-${index}`,
  walletId: 'wallet-1',
  type: 'sent',
  amount: -1000 * index,
  fee: 100 + index,
  feeRate,
  timeInQueue: 120,
  createdAt: '2025-01-01T00:00:00.000Z',
});

const pendingBlock: BlockData = {
  height: 'mempool',
  medianFee: 12.4,
  feeRange: '10-20',
  size: 3.2,
  txCount: 1234,
  time: '5m',
  status: 'pending',
};

const confirmedBlock: BlockData = {
  height: 800000,
  medianFee: 0.7,
  feeRange: '1-2',
  size: 0.8,
  txCount: 420,
  time: 'Just now',
  status: 'confirmed',
};

describe('Block', () => {
  it('renders non-compact pending block with dots, stuck state, and overflow indicator', () => {
    const pendingTxs = [
      makePendingTx(1, 1),
      makePendingTx(2, 2),
      makePendingTx(3, 3),
      makePendingTx(4, 4),
      makePendingTx(5, 5),
      makePendingTx(6, 6),
    ];

    const { container } = render(
      <Block
        block={pendingBlock}
        index={0}
        onClick={vi.fn()}
        compact={false}
        isAnimating={false}
        animationDirection="none"
        pendingTxs={pendingTxs}
        explorerUrl="https://mempool.space"
        blockMinFee={3}
      />
    );

    expect(screen.getByText('Median Fee')).toBeInTheDocument();
    expect(screen.getByText('10-20')).toBeInTheDocument();
    expect(screen.getByText('BLK mempool')).toBeInTheDocument();
    expect(screen.getByText('5m')).toBeInTheDocument();

    const dots = screen.getAllByTestId('pending-dot');
    expect(dots).toHaveLength(5);
    expect(screen.getByText('+1')).toBeInTheDocument();

    expect(container.querySelector('[data-txid="tx-1"]')).toHaveAttribute('data-stuck', 'true');
    expect(container.querySelector('[data-txid="tx-2"]')).toHaveAttribute('data-stuck', 'true');
    expect(container.querySelector('[data-txid="tx-3"]')).toHaveAttribute('data-stuck', 'false');

    expect(screen.getByText('1,234 txs • Median: 12 • Range: 10-20 • 100% full')).toBeInTheDocument();
    expect(container.querySelector('div[style*="width: 100%"]')).toBeInTheDocument();
  });

  it('renders compact pending block with compact dot limit and bottom time label', () => {
    const { container } = render(
      <Block
        block={pendingBlock}
        index={2}
        onClick={vi.fn()}
        compact={true}
        isAnimating={false}
        animationDirection="none"
        pendingTxs={[makePendingTx(1, 1), makePendingTx(2, 2), makePendingTx(3, 3), makePendingTx(4, 4)]}
        explorerUrl="https://mempool.space"
      />
    );

    expect(screen.queryByText('Median Fee')).not.toBeInTheDocument();
    expect(screen.queryByText('10-20')).not.toBeInTheDocument();
    expect(screen.getByText('mempool')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
    expect(screen.getAllByTestId('pending-dot')).toHaveLength(3);
    expect(container.querySelector('[data-compact="true"]')).toBeInTheDocument();
  });

  it('applies animation classes for enter/exit directions', () => {
    const { rerender, container } = render(
      <Block
        block={pendingBlock}
        index={1}
        onClick={vi.fn()}
        compact={false}
        isAnimating={false}
        animationDirection="none"
        explorerUrl="https://mempool.space"
      />
    );

    const getButton = () => container.querySelector('button') as HTMLButtonElement;
    expect(getButton().className).not.toContain('animate-block-enter');
    expect(getButton().className).not.toContain('animate-block-exit');

    rerender(
      <Block
        block={pendingBlock}
        index={1}
        onClick={vi.fn()}
        compact={false}
        isAnimating={true}
        animationDirection="enter"
        explorerUrl="https://mempool.space"
      />
    );
    expect(getButton().className).toContain('animate-block-enter');

    rerender(
      <Block
        block={pendingBlock}
        index={1}
        onClick={vi.fn()}
        compact={false}
        isAnimating={true}
        animationDirection="exit"
        explorerUrl="https://mempool.space"
      />
    );
    expect(getButton().className).toContain('animate-block-exit');

    rerender(
      <Block
        block={pendingBlock}
        index={1}
        onClick={vi.fn()}
        compact={false}
        isAnimating={true}
        animationDirection="none"
        explorerUrl="https://mempool.space"
      />
    );
    expect(getButton().className).not.toContain('animate-block-enter');
    expect(getButton().className).not.toContain('animate-block-exit');
  });

  it('formats confirmed block values and handles click', () => {
    const onClick = vi.fn();

    render(
      <Block
        block={confirmedBlock}
        index={0}
        onClick={onClick}
        compact={false}
        isAnimating={false}
        animationDirection="none"
        explorerUrl="https://mempool.space"
      />
    );

    expect(screen.getByText('0.7')).toBeInTheDocument();
    expect(screen.getByText('800,000')).toBeInTheDocument();
    expect(screen.getByText('420 txs • Median: 0.7 • Range: 1-2 • 50% full')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('handles compact confirmed block height formatting and missing optional sections', () => {
    const block = { ...confirmedBlock, height: 'tip', txCount: undefined, feeRange: '' };
    render(
      <Block
        block={block}
        index={3}
        onClick={vi.fn()}
        compact={true}
        isAnimating={false}
        animationDirection="none"
        explorerUrl="https://mempool.space"
      />
    );

    expect(screen.getByText('tip')).toBeInTheDocument();
    expect(screen.queryByText(/txs • Median:/)).not.toBeInTheDocument();
    expect(screen.queryByText('Median Fee')).not.toBeInTheDocument();
  });

  it('renders compact confirmed numeric height without locale formatting', () => {
    render(
      <Block
        block={{ ...confirmedBlock, height: 800000 }}
        index={4}
        onClick={vi.fn()}
        compact={true}
        isAnimating={false}
        animationDirection="none"
        explorerUrl="https://mempool.space"
      />
    );

    expect(screen.getByText('800000')).toBeInTheDocument();
  });
});
