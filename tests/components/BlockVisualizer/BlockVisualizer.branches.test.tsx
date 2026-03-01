import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BlockData } from '../../../components/BlockVisualizer/types';
import type { PendingTransaction } from '../../../src/types';

const {
  parseFeeRangeMock,
  getTxsForBlockMock,
  getStuckTxsMock,
} = vi.hoisted(() => ({
  parseFeeRangeMock: vi.fn(() => [10, 20]),
  getTxsForBlockMock: vi.fn(() => []),
  getStuckTxsMock: vi.fn(() => []),
}));

vi.mock('../../../components/BlockVisualizer/blockUtils', () => ({
  parseFeeRange: parseFeeRangeMock,
  getTxsForBlock: getTxsForBlockMock,
  getStuckTxs: getStuckTxsMock,
}));

vi.mock('../../../components/BlockVisualizer/BlockAnimationStyles', () => ({
  BlockAnimationStyles: () => <div data-testid="anim-styles" />,
}));

vi.mock('../../../components/BlockVisualizer/QueuedSummaryBlock', () => ({
  QueuedSummaryBlock: ({
    summary,
    stuckTxs,
  }: {
    summary: { blockCount: number };
    stuckTxs: PendingTransaction[];
  }) => (
    <div data-testid="queued-summary">
      blocks:{summary.blockCount};stuck:{stuckTxs.length}
    </div>
  ),
}));

vi.mock('../../../components/BlockVisualizer/Block', () => ({
  Block: ({
    block,
    onClick,
    isAnimating,
    animationDirection,
    index,
  }: {
    block: BlockData;
    onClick: () => void;
    isAnimating: boolean;
    animationDirection: string;
    index: number;
  }) => (
    <button
      onClick={onClick}
      data-testid={`block-${block.status}-${String(block.height)}`}
      data-anim={String(isAnimating)}
      data-dir={animationDirection}
      data-index={index}
    >
      {block.status}:{String(block.height)}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  ArrowRight: () => <span data-testid="arrow-right" />,
}));

import { BlockVisualizer } from '../../../components/BlockVisualizer/BlockVisualizer';

const makeBlock = (overrides: Partial<BlockData>): BlockData => ({
  height: 'mempool',
  medianFee: 12,
  feeRange: '10-20',
  size: 1.2,
  time: '1m',
  status: 'pending',
  ...overrides,
});

const makePendingTx = (feeRate: number): PendingTransaction => ({
  txid: `tx-${feeRate}`,
  walletId: 'wallet-1',
  type: 'sent',
  amount: -1000,
  fee: 100,
  feeRate,
  timeInQueue: 60,
  createdAt: '2025-01-01T00:00:00.000Z',
});

describe('BlockVisualizer branch coverage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    parseFeeRangeMock.mockReturnValue([10, 20]);
    getTxsForBlockMock.mockReturnValue([]);
    getStuckTxsMock.mockReturnValue([]);
    vi.spyOn(window, 'open').mockImplementation(() => null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders loading skeletons for empty/undefined blocks and compact layout', () => {
    const { container } = render(
      <BlockVisualizer blocks={undefined as unknown as BlockData[]} compact={true} />
    );

    expect(screen.getByText('Loading blockchain data...')).toBeInTheDocument();
    expect(container.querySelectorAll('.bg-sanctuary-200').length).toBe(7);
    expect(screen.getByTestId('anim-styles')).toBeInTheDocument();
  });

  it('uses onBlockClick callback instead of opening explorer', async () => {
    const user = userEvent.setup();
    const onBlockClick = vi.fn();

    render(
      <BlockVisualizer
        blocks={[makeBlock({ status: 'confirmed', height: 800123, medianFee: 42 })]}
        onBlockClick={onBlockClick}
      />
    );

    await user.click(screen.getByTestId('block-confirmed-800123'));
    expect(onBlockClick).toHaveBeenCalledWith(42);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('opens explorer URLs for confirmed and pending blocks when callback is absent', async () => {
    const user = userEvent.setup();

    render(
      <BlockVisualizer
        blocks={[
          makeBlock({ status: 'pending', height: 'mempool' }),
          makeBlock({ status: 'confirmed', height: 800456 }),
        ]}
        explorerUrl="https://mempool.space"
      />
    );

    await user.click(screen.getByTestId('block-pending-mempool'));
    await user.click(screen.getByTestId('block-confirmed-800456'));

    expect(window.open).toHaveBeenCalledWith('https://mempool.space/mempool-block/0', '_blank');
    expect(window.open).toHaveBeenCalledWith('https://mempool.space/block/800456', '_blank');
  });

  it('shows/hides queued summary based on queued block count and stuck transactions', () => {
    const { rerender } = render(
      <BlockVisualizer
        blocks={[makeBlock({ status: 'pending', height: 'mempool' })]}
        queuedBlocksSummary={{ blockCount: 2, totalTransactions: 3, averageFee: 15, totalFees: 200 }}
      />
    );

    expect(screen.getByTestId('queued-summary')).toHaveTextContent('blocks:2;stuck:0');

    getStuckTxsMock.mockReturnValue([makePendingTx(1)]);
    rerender(
      <BlockVisualizer
        blocks={[makeBlock({ status: 'pending', height: 'mempool' })]}
        queuedBlocksSummary={undefined}
      />
    );
    expect(screen.getByTestId('queued-summary')).toHaveTextContent('blocks:0;stuck:1');

    getStuckTxsMock.mockReturnValue([]);
    rerender(
      <BlockVisualizer
        blocks={[makeBlock({ status: 'pending', height: 'mempool' })]}
        queuedBlocksSummary={undefined}
      />
    );
    expect(screen.queryByTestId('queued-summary')).toBeNull();
  });

  it('animates when a new first confirmed block appears and resets after timeout', () => {
    vi.useFakeTimers();

    const initialBlocks: BlockData[] = [
      makeBlock({ status: 'pending', height: 'mempool' }),
      makeBlock({ status: 'confirmed', height: 800100 }),
      makeBlock({ status: 'confirmed', height: 800099 }),
    ];
    const nextBlocks: BlockData[] = [
      makeBlock({ status: 'pending', height: 'mempool' }),
      makeBlock({ status: 'confirmed', height: 800101 }),
      makeBlock({ status: 'confirmed', height: 800100 }),
    ];

    const { rerender } = render(<BlockVisualizer blocks={initialBlocks} />);
    rerender(<BlockVisualizer blocks={nextBlocks} />);

    expect(screen.getByTestId('block-pending-mempool')).toHaveAttribute('data-anim', 'true');
    // During animation window, displayBlocks still show previous confirmed heights.
    expect(screen.getByTestId('block-confirmed-800100')).toHaveAttribute('data-anim', 'true');
    expect(screen.getByTestId('block-confirmed-800100')).toHaveAttribute('data-dir', 'enter');
    expect(screen.getByTestId('block-confirmed-800099')).toHaveAttribute('data-anim', 'false');
    expect(screen.getByTestId('block-confirmed-800099')).toHaveAttribute('data-dir', 'none');

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByTestId('block-pending-mempool')).toHaveAttribute('data-anim', 'false');
    expect(screen.getByTestId('block-confirmed-800101')).toHaveAttribute('data-anim', 'false');
  });

  it('clears existing animation timeout on subsequent updates and on unmount', () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

    const first: BlockData[] = [
      makeBlock({ status: 'pending', height: 'mempool' }),
      makeBlock({ status: 'confirmed', height: 800200 }),
    ];
    const second: BlockData[] = [
      makeBlock({ status: 'pending', height: 'mempool' }),
      makeBlock({ status: 'confirmed', height: 800201 }),
    ];
    const third: BlockData[] = [
      makeBlock({ status: 'pending', height: 'mempool' }),
      makeBlock({ status: 'confirmed', height: 800202 }),
    ];

    const { rerender, unmount } = render(<BlockVisualizer blocks={first} />);
    rerender(<BlockVisualizer blocks={second} />);
    rerender(<BlockVisualizer blocks={third} />);
    unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
