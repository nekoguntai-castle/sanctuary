import type { BlockVisualizerProps } from './types';
import { BlockVisualizerView } from './BlockVisualizer/BlockVisualizerView';
import { useBlockVisualizerController } from './BlockVisualizer/useBlockVisualizerController';

export function BlockVisualizer({
  blocks,
  queuedBlocksSummary,
  pendingTxs = [],
  onBlockClick,
  compact = false,
  explorerUrl = 'https://mempool.space',
}: BlockVisualizerProps) {
  const controller = useBlockVisualizerController({ blocks, onBlockClick, explorerUrl });

  return (
    <BlockVisualizerView
      controller={controller}
      queuedBlocksSummary={queuedBlocksSummary}
      pendingTxs={pendingTxs}
      compact={compact}
      explorerUrl={explorerUrl}
    />
  );
}
