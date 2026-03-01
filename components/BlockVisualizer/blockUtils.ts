import type { PendingTransaction } from '../../src/types';
import type { BlockData } from './types';

// Get color based on block status (sanctuary theme)
// Note: In dark mode, warning/success values are inverted in the theme
// So we use specific shades that work correctly in both modes
export const getBlockColors = (isPending: boolean) => {
  if (isPending) {
    // Pending blocks use warning/amber colors
    // Light: warning-200 (#efe0c0), Dark: warning-200 is actually dark (#644a2d)
    return {
      bg: 'bg-warning-200 dark:bg-warning-200',
      bar: 'bg-warning-600 dark:bg-warning-600',
      barBg: 'bg-warning-100 dark:bg-warning-100',
      text: 'text-warning-800 dark:text-warning-800',
      label: 'bg-warning-500 text-white dark:bg-warning-500 dark:text-white'
    };
  } else {
    // Confirmed blocks use success/green colors
    return {
      bg: 'bg-success-200 dark:bg-success-200',
      bar: 'bg-success-600 dark:bg-success-600',
      barBg: 'bg-success-100 dark:bg-success-100',
      text: 'text-success-800 dark:text-success-800',
      label: 'bg-success-500 text-white dark:bg-success-500 dark:text-white'
    };
  }
};

// Format seconds into human readable time
export const formatTimeInQueue = (seconds: number): string => {
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
};

// Parse fee range string "min-max" into [min, max] numbers
export const parseFeeRange = (feeRange: string): [number, number] => {
  const parts = feeRange.split('-').map(s => parseFloat(s.trim()));
  if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
    return [parts[0], parts[1]];
  }
  return [0, Infinity]; // Fallback
};

// IMPORTANT: Block ordering documentation
// =========================================
// The backend returns mempool blocks in display order (left-to-right):
//   - pendingBlocks[0] = +3 block (furthest from confirmation, LOWEST fees)
//   - pendingBlocks[1] = +2 block
//   - pendingBlocks[2] = Next block (closest to confirmation, HIGHEST fees)
//
// Visual layout:  [+3] [+2] [Next] | [Confirmed blocks...]
//                  ^              ^
//               idx=0          idx=length-1
//            (lowest fee)     (highest fee)
//
// Transaction matching logic:
//   - "Next" block (rightmost): transactions with fee >= block's min fee
//   - Other blocks: transactions with fee >= block's min fee AND < closer block's min fee
//
// Helper to match pending transactions to blocks based on fee rate
// Uses actual fee ranges from mempool data for accurate predictions
// Note: "Stuck" transactions (feeRate < lowest block's minFee) are NOT included here;
// they are displayed in QueuedSummaryBlock instead
export const getTxsForBlock = (
  block: BlockData,
  allPendingTxs: PendingTransaction[],
  blockIndex: number,
  totalPendingBlocks: number,
  allBlocks: BlockData[]
): PendingTransaction[] => {
  // Only show in pending blocks
  if (block.status !== 'pending') return [];

  const [minFee] = parseFeeRange(block.feeRange);

  // Check if this is the "Next" block (closest to confirmation)
  // It's the last in the display order (rightmost pending block)
  const isNextBlock = blockIndex === totalPendingBlocks - 1;

  // Get the block closer to confirmation (to the right, higher index)
  const closerBlock = blockIndex < totalPendingBlocks - 1 ? allBlocks[blockIndex + 1] : null;
  const closerBlockMinFee = closerBlock ? parseFeeRange(closerBlock.feeRange)[0] : Infinity;

  return allPendingTxs.filter(tx => {
    // "Next" block (rightmost): tx fee rate >= this block's min fee
    if (isNextBlock) {
      return tx.feeRate >= minFee;
    }

    // All other blocks: fee rate >= this block's min fee AND < closer block's min fee
    // Stuck txs (feeRate < this block's minFee) go to QueuedSummaryBlock instead
    return tx.feeRate >= minFee && tx.feeRate < closerBlockMinFee;
  });
};

// Helper to get "stuck" transactions - those with fee rate below the lowest pending block's minimum
export const getStuckTxs = (
  allPendingTxs: PendingTransaction[],
  pendingBlocks: BlockData[]
): PendingTransaction[] => {
  if (pendingBlocks.length === 0) return [];

  // The lowest fee block is index 0 (furthest from confirmation)
  const lowestBlock = pendingBlocks[0];
  const [lowestMinFee] = parseFeeRange(lowestBlock.feeRange);

  // Transactions with fee rate below the lowest block's minimum are "stuck"
  return allPendingTxs.filter(tx => tx.feeRate < lowestMinFee);
};
