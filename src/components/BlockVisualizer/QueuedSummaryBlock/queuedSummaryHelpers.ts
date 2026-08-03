import type { QueuedBlocksSummary } from '../types';

const maxVisibleBlocks = 8;

export interface QueuedSummaryViewModel {
  visibleBlocks: number;
  hasMoreBlocks: boolean;
  visibleTxLimit: number;
  txOverflowCount: number;
  formattedAverageFee: string | number;
  blockCountLabel: string;
  tooltipText: string;
}

export const getQueuedSummaryViewModel = (
  summary: QueuedBlocksSummary,
  compact: boolean,
  stuckTxCount: number
): QueuedSummaryViewModel => {
  const visibleTxLimit = compact ? 3 : 5;

  return {
    visibleBlocks: Math.min(summary.blockCount, maxVisibleBlocks),
    hasMoreBlocks: summary.blockCount > maxVisibleBlocks,
    visibleTxLimit,
    txOverflowCount: Math.max(stuckTxCount - visibleTxLimit, 0),
    formattedAverageFee: formatAverageFee(summary.averageFee),
    blockCountLabel: `+${summary.blockCount}${compact ? '' : ' BLKS'}`,
    tooltipText: formatTooltipText(summary.totalTransactions, stuckTxCount),
  };
};

/**
 * Exported so the collapsed dashboard summary renders the same figure as the
 * expanded visualiser. One backend path (simpleEstimator) returns an unrounded
 * float, so interpolating averageFee raw yields e.g. "1.7333333333333334".
 */
export const formatAverageFee = (averageFee: number) => {
  return averageFee < 1 ? averageFee.toFixed(1) : Math.round(averageFee);
};

const formatTooltipText = (totalTransactions: number, stuckTxCount: number) => {
  const baseText = `${totalTransactions.toLocaleString()} txs waiting`;
  return stuckTxCount > 0 ? `${baseText} • ${stuckTxCount} stuck` : baseText;
};
