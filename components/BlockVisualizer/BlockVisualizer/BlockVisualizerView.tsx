import { ArrowRight } from 'lucide-react';
import type { PendingTransaction } from '../../../src/types';
import { Block } from '../Block';
import { BlockAnimationStyles } from '../BlockAnimationStyles';
import { getStuckTxs, getTxsForBlock, parseFeeRange } from '../blockUtils';
import { QueuedSummaryBlock } from '../QueuedSummaryBlock';
import type { BlockData, QueuedBlocksSummary } from '../types';
import { getMempoolBlockIndex } from './blockVisualizerControllerHelpers';
import type { BlockVisualizerController } from './useBlockVisualizerController';
import { getQueuedSummaryForDisplay } from './blockVisualizerViewHelpers';

interface BlockVisualizerViewProps {
  controller: BlockVisualizerController;
  queuedBlocksSummary?: QueuedBlocksSummary | null;
  pendingTxs: PendingTransaction[];
  compact: boolean;
  explorerUrl: string;
}

export function BlockVisualizerView({
  controller,
  queuedBlocksSummary,
  pendingTxs,
  compact,
  explorerUrl,
}: BlockVisualizerViewProps) {
  return (
    <div className="w-full overflow-hidden">
      <BlockAnimationStyles />
      <BlockVisualizerHeader />
      <BlocksContainer
        controller={controller}
        queuedBlocksSummary={queuedBlocksSummary}
        pendingTxs={pendingTxs}
        compact={compact}
        explorerUrl={explorerUrl}
      />
      <BlockVisualizerLegend />
    </div>
  );
}

function BlockVisualizerHeader() {
  return (
    <div className="flex items-center space-x-2 mb-2 px-2">
      <div className="flex-1 flex items-center justify-end">
        <div className="flex items-center text-xs font-medium text-warning-600 dark:text-warning-400 uppercase tracking-wider opacity-90">
          <span className="w-2 h-2 rounded-full bg-warning-500 animate-pulse mr-2" />
          <span>Mempool (Pending)</span>
        </div>
      </div>
      <div className="w-8 flex justify-center">
        <ArrowRight className="w-4 h-4 text-sanctuary-400" />
      </div>
      <div className="flex-1">
        <div className="flex items-center text-xs font-medium text-success-600 dark:text-success-400 uppercase tracking-wider">
          <span className="w-2 h-2 rounded-full bg-success-500 mr-2" />
          <span>Blockchain (Confirmed)</span>
        </div>
      </div>
    </div>
  );
}

function BlocksContainer({
  controller,
  queuedBlocksSummary,
  pendingTxs,
  compact,
  explorerUrl,
}: BlockVisualizerViewProps) {
  return (
    <div className={`relative flex items-center justify-center ${compact ? 'space-x-1.5' : 'space-x-2 sm:space-x-3'} overflow-x-auto pt-12 pb-2 px-4 scrollbar-hide`}>
      <div className="absolute left-1/2 top-0 bottom-4 w-px bg-gradient-to-b from-transparent via-sanctuary-300 to-transparent dark:via-sanctuary-700 -ml-0.5 z-0" />
      {controller.displayBlocks.length === 0 ? (
        <LoadingBlocks compact={compact} />
      ) : (
        <RenderedBlocks
          controller={controller}
          queuedBlocksSummary={queuedBlocksSummary}
          pendingTxs={pendingTxs}
          compact={compact}
          explorerUrl={explorerUrl}
        />
      )}
    </div>
  );
}

function LoadingBlocks({ compact }: { compact: boolean }) {
  return (
    <div className="text-center text-sanctuary-500 dark:text-sanctuary-400 py-8">
      <div className="animate-pulse flex space-x-2 justify-center">
        {Array.from({ length: compact ? 7 : 6 }).map((_, index) => (
          <div
            key={index}
            className={`${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32'} rounded-lg bg-sanctuary-200 dark:bg-sanctuary-800`}
          />
        ))}
      </div>
      <p className="text-sm mt-4">Loading blockchain data...</p>
    </div>
  );
}

function RenderedBlocks({
  controller,
  queuedBlocksSummary,
  pendingTxs,
  compact,
  explorerUrl,
}: BlockVisualizerViewProps) {
  return (
    <>
      <QueuedSummarySlot
        queuedBlocksSummary={queuedBlocksSummary}
        pendingBlocks={controller.pendingBlocks}
        pendingTxs={pendingTxs}
        compact={compact}
        explorerUrl={explorerUrl}
      />
      <PendingBlockList
        controller={controller}
        pendingTxs={pendingTxs}
        compact={compact}
        explorerUrl={explorerUrl}
      />
      <ConfirmedBlockList
        controller={controller}
        compact={compact}
        explorerUrl={explorerUrl}
      />
    </>
  );
}

function QueuedSummarySlot({
  queuedBlocksSummary,
  pendingBlocks,
  pendingTxs,
  compact,
  explorerUrl,
}: {
  queuedBlocksSummary?: QueuedBlocksSummary | null;
  pendingBlocks: BlockData[];
  pendingTxs: PendingTransaction[];
  compact: boolean;
  explorerUrl: string;
}) {
  const stuckTxs = getStuckTxs(pendingTxs, pendingBlocks);
  const summary = getQueuedSummaryForDisplay(queuedBlocksSummary, stuckTxs);

  if (!summary) return null;

  return (
    <QueuedSummaryBlock
      summary={summary}
      compact={compact}
      stuckTxs={stuckTxs}
      explorerUrl={explorerUrl}
    />
  );
}

function PendingBlockList({
  controller,
  pendingTxs,
  compact,
  explorerUrl,
}: {
  controller: BlockVisualizerController;
  pendingTxs: PendingTransaction[];
  compact: boolean;
  explorerUrl: string;
}) {
  return (
    <>
      {controller.pendingBlocks.map((block, index) => {
        const mempoolBlockIndex = getMempoolBlockIndex(controller.pendingBlocks.length, index);
        const [blockMinFee] = parseFeeRange(block.feeRange);
        return (
          <Block
            key={`pending-${block.height}-${index}`}
            block={block}
            index={index}
            onClick={() => controller.handleBlockClick(block, mempoolBlockIndex)}
            compact={compact}
            isAnimating={controller.isAnimating && controller.newBlockDetected}
            animationDirection="none"
            pendingTxs={getTxsForBlock(
              block,
              pendingTxs,
              index,
              controller.pendingBlocks.length,
              controller.pendingBlocks
            )}
            explorerUrl={explorerUrl}
            blockMinFee={blockMinFee}
          />
        );
      })}
    </>
  );
}

function ConfirmedBlockList({
  controller,
  compact,
  explorerUrl,
}: {
  controller: BlockVisualizerController;
  compact: boolean;
  explorerUrl: string;
}) {
  return (
    <>
      {controller.confirmedBlocks.map((block, index) => (
        <Block
          key={`confirmed-${block.height}`}
          block={block}
          index={index + controller.pendingBlocks.length}
          onClick={() => controller.handleBlockClick(block)}
          compact={compact}
          isAnimating={controller.isAnimating && controller.newBlockDetected && index === 0}
          animationDirection={controller.isAnimating && controller.newBlockDetected && index === 0 ? 'enter' : 'none'}
          explorerUrl={explorerUrl}
        />
      ))}
    </>
  );
}

function BlockVisualizerLegend() {
  return (
    <div className="flex items-center justify-center space-x-4 text-[10px] font-medium text-sanctuary-700 dark:text-sanctuary-400 mt-1">
      <span>Block Fullness:</span>
      <LegendFullnessIndicator label="25%" widthClass="w-1/4" />
      <LegendFullnessIndicator label="100%" widthClass="w-full" />
      <span className="text-sanctuary-500 dark:text-sanctuary-500 ml-2">• Hover for details</span>
    </div>
  );
}

function LegendFullnessIndicator({
  label,
  widthClass,
}: {
  label: string;
  widthClass: string;
}) {
  return (
    <div className="flex items-center space-x-1">
      <div className="w-10 h-1.5 rounded-sm bg-sanctuary-300 dark:bg-sanctuary-800 relative overflow-hidden">
        <div className={`absolute left-0 top-0 bottom-0 ${widthClass} bg-sanctuary-500 dark:bg-sanctuary-500 rounded-sm`} />
      </div>
      <span>{label}</span>
    </div>
  );
}
