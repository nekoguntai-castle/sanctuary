import type { PendingTransaction } from '../../../src/types';
import type { QueuedBlocksSummary } from '../types';

const emptyQueuedSummary: QueuedBlocksSummary = {
  blockCount: 0,
  totalTransactions: 0,
  averageFee: 0,
  totalFees: 0,
};

export const getQueuedSummaryForDisplay = (
  queuedBlocksSummary: QueuedBlocksSummary | null | undefined,
  stuckTxs: PendingTransaction[]
) => {
  const hasQueuedBlocks = Boolean(queuedBlocksSummary && queuedBlocksSummary.blockCount > 0);
  const hasStuckTxs = stuckTxs.length > 0;

  if (!hasQueuedBlocks && !hasStuckTxs) {
    return null;
  }

  return queuedBlocksSummary ?? emptyQueuedSummary;
};
