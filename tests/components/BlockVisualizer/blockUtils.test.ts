import { describe,expect,it } from 'vitest';
import {
formatTimeInQueue,
getBlockColors,
getStuckTxs,
getTxsForBlock,
parseFeeRange,
} from '../../../components/BlockVisualizer/blockUtils';
import type { BlockData } from '../../../components/BlockVisualizer/types';
import type { PendingTransaction } from '../../../src/types';

const makeTx = (feeRate: number): PendingTransaction => ({
  txid: `tx-${feeRate}`,
  walletId: 'wallet-1',
  type: 'sent',
  amount: -1000,
  fee: 100,
  feeRate,
  timeInQueue: 120,
  createdAt: '2025-01-01T00:00:00.000Z',
});

const makeBlock = (overrides: Partial<BlockData>): BlockData => ({
  height: 'mempool',
  medianFee: 10,
  feeRange: '5-10',
  size: 1.2,
  time: '1m',
  status: 'pending',
  ...overrides,
});

describe('blockUtils', () => {
  describe('getBlockColors', () => {
    it('returns warning colors for pending blocks', () => {
      const colors = getBlockColors(true);
      expect(colors.bgGradient).toContain('warning');
      expect(colors.bar).toContain('bg-warning-600');
      expect(colors.label).toContain('bg-warning-500');
    });

    it('returns success colors for confirmed blocks', () => {
      const colors = getBlockColors(false);
      expect(colors.bgGradient).toContain('success');
      expect(colors.bar).toContain('bg-success-600');
      expect(colors.label).toContain('bg-success-500');
    });
  });

  describe('formatTimeInQueue', () => {
    it('formats sub-minute, minute, and hour ranges', () => {
      expect(formatTimeInQueue(59)).toBe('<1m');
      expect(formatTimeInQueue(60)).toBe('1m');
      expect(formatTimeInQueue(3599)).toBe('59m');
      expect(formatTimeInQueue(3600)).toBe('1h');
      expect(formatTimeInQueue(3660)).toBe('1h 1m');
    });
  });

  describe('parseFeeRange', () => {
    it('parses valid ranges', () => {
      expect(parseFeeRange('1-2')).toEqual([1, 2]);
      expect(parseFeeRange(' 0.5 - 3.75 ')).toEqual([0.5, 3.75]);
    });

    it('falls back for malformed ranges', () => {
      expect(parseFeeRange('abc-2')).toEqual([0, Infinity]);
      expect(parseFeeRange('1-2-3')).toEqual([0, Infinity]);
      expect(parseFeeRange('invalid')).toEqual([0, Infinity]);
    });
  });

  describe('getTxsForBlock', () => {
    const txs = [1, 5, 9, 10, 14, 20, 30].map(makeTx);
    const blocks: BlockData[] = [
      makeBlock({ feeRange: '5-10', status: 'pending' }),
      makeBlock({ feeRange: '10-20', status: 'pending' }),
      makeBlock({ feeRange: '20-40', status: 'pending' }),
    ];

    it('returns no transactions for non-pending blocks', () => {
      const confirmed = makeBlock({ status: 'confirmed', feeRange: '5-10' });
      expect(getTxsForBlock(confirmed, txs, 0, 3, blocks)).toEqual([]);
    });

    it('matches rightmost pending block using min fee only', () => {
      const nextBlockTxs = getTxsForBlock(blocks[2], txs, 2, 3, blocks);
      expect(nextBlockTxs.map(tx => tx.feeRate)).toEqual([20, 30]);
    });

    it('matches non-next blocks between current and closer block min fee', () => {
      const firstBlockTxs = getTxsForBlock(blocks[0], txs, 0, 3, blocks);
      expect(firstBlockTxs.map(tx => tx.feeRate)).toEqual([5, 9]);

      const secondBlockTxs = getTxsForBlock(blocks[1], txs, 1, 3, blocks);
      expect(secondBlockTxs.map(tx => tx.feeRate)).toEqual([10, 14]);
    });

    it('handles missing closer block fallback to Infinity', () => {
      const result = getTxsForBlock(blocks[0], txs, 0, 0, blocks);
      expect(result.map(tx => tx.feeRate)).toEqual([5, 9, 10, 14, 20, 30]);
    });
  });

  describe('getStuckTxs', () => {
    const txs = [1, 3, 5, 10].map(makeTx);

    it('returns empty list when there are no pending blocks', () => {
      expect(getStuckTxs(txs, [])).toEqual([]);
    });

    it('returns transactions below the lowest pending block minimum', () => {
      const pendingBlocks = [makeBlock({ feeRange: '5-10' }), makeBlock({ feeRange: '10-20' })];
      expect(getStuckTxs(txs, pendingBlocks).map(tx => tx.feeRate)).toEqual([1, 3]);
    });
  });
});
