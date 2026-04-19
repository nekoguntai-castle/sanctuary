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

const formatAverageFee = (averageFee: number) => {
  return averageFee < 1 ? averageFee.toFixed(1) : Math.round(averageFee);
};

const formatTooltipText = (totalTransactions: number, stuckTxCount: number) => {
  const baseText = `${totalTransactions.toLocaleString()} txs waiting`;
  return stuckTxCount > 0 ? `${baseText} • ${stuckTxCount} stuck` : baseText;
};
