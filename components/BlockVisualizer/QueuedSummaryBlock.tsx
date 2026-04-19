import type { PendingTransaction } from '../../src/types';
import type { QueuedBlocksSummary } from './types';
import { QueuedSummaryBlockView } from './QueuedSummaryBlock/QueuedSummaryBlockView';
import { getQueuedSummaryViewModel } from './QueuedSummaryBlock/queuedSummaryHelpers';

interface QueuedSummaryBlockProps {
  summary: QueuedBlocksSummary;
  compact: boolean;
  stuckTxs?: PendingTransaction[];
  explorerUrl?: string;
}

export function QueuedSummaryBlock({
  summary,
  compact,
  stuckTxs = [],
  explorerUrl = 'https://mempool.space',
}: QueuedSummaryBlockProps) {
  const viewModel = getQueuedSummaryViewModel(summary, compact, stuckTxs.length);

  return (
    <QueuedSummaryBlockView
      compact={compact}
      stuckTxs={stuckTxs}
      explorerUrl={explorerUrl}
      viewModel={viewModel}
    />
  );
}
