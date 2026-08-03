import type { PendingTransaction } from '../../types';
import type { QueuedBlocksSummary } from './types';
import { QueuedSummaryBlockView } from './QueuedSummaryBlock/QueuedSummaryBlockView';
import { getQueuedSummaryViewModel } from './QueuedSummaryBlock/queuedSummaryHelpers';
import { getDefaultNodeExternalServiceUrl } from '@sanctuary/shared/constants/nodeConfig';

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
  explorerUrl = getDefaultNodeExternalServiceUrl('mainnet'),
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
