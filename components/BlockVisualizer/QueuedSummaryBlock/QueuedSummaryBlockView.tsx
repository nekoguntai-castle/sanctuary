import type { PendingTransaction } from '../../../src/types';
import { PendingTxDot } from '../PendingTxDot';
import type { QueuedSummaryViewModel } from './queuedSummaryHelpers';

interface QueuedSummaryBlockViewProps {
  compact: boolean;
  stuckTxs: PendingTransaction[];
  explorerUrl: string;
  viewModel: QueuedSummaryViewModel;
}

export function QueuedSummaryBlockView({
  compact,
  stuckTxs,
  explorerUrl,
  viewModel,
}: QueuedSummaryBlockViewProps) {
  return (
    <div className="relative group flex flex-col items-center">
      <div
        className={`
          relative flex-shrink-0 flex flex-col
          ${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32 md:w-32 md:h-36'}
          rounded-lg overflow-hidden
          bg-warning-500 dark:bg-warning-100
        `}
      >
        <StuckTxDots
          stuckTxs={stuckTxs}
          explorerUrl={explorerUrl}
          compact={compact}
          viewModel={viewModel}
        />
        <QueuedSummaryContent
          compact={compact}
          viewModel={viewModel}
        />
        <QueuedMiniBlocks viewModel={viewModel} />
      </div>
      <QueuedCompactLabel compact={compact} />
      <QueuedTooltip
        compact={compact}
        tooltipText={viewModel.tooltipText}
      />
    </div>
  );
}

function StuckTxDots({
  stuckTxs,
  explorerUrl,
  compact,
  viewModel,
}: {
  stuckTxs: PendingTransaction[];
  explorerUrl: string;
  compact: boolean;
  viewModel: QueuedSummaryViewModel;
}) {
  if (stuckTxs.length === 0) return null;

  return (
    <div className={`
      absolute z-20
      ${compact ? 'top-0.5 right-0.5' : 'top-1 right-1'}
      flex flex-wrap gap-0.5 max-w-[50%] justify-end
    `}>
      {stuckTxs.slice(0, viewModel.visibleTxLimit).map((tx) => (
        <PendingTxDot
          key={tx.txid}
          tx={tx}
          explorerUrl={explorerUrl}
          compact={compact}
          isStuck={true}
        />
      ))}
      {viewModel.txOverflowCount > 0 && (
        <span className={`
          ${compact ? 'text-[8px]' : 'text-[9px]'}
          font-bold text-white dark:text-warning-900
        `}>
          +{viewModel.txOverflowCount}
        </span>
      )}
    </div>
  );
}

function QueuedSummaryContent({
  compact,
  viewModel,
}: {
  compact: boolean;
  viewModel: QueuedSummaryViewModel;
}) {
  return (
    <div className={`relative z-10 flex flex-col items-center justify-between h-full ${compact ? 'py-1.5 px-1' : 'py-2 px-1'}`}>
      {!compact && <div className="text-[10px] font-bold text-white dark:text-warning-900">Queue</div>}
      <div className="text-center">
        {!compact && <div className="text-[10px] uppercase font-bold text-white dark:text-warning-900 mb-0.5">Median Fee</div>}
        <div className={`${compact ? 'text-base' : 'text-xl'} font-black leading-none text-white dark:text-warning-900`}>
          {viewModel.formattedAverageFee}
        </div>
        <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold text-white dark:text-warning-900`}>sat/vB</div>
      </div>
      <div className="w-full text-center">
        <div className={`${compact ? 'text-[9px] py-0.5 mx-0.5' : 'text-[10px] py-0.5 mx-1'} font-mono font-bold rounded bg-warning-700 text-white dark:bg-warning-50 dark:text-warning-900`}>
          {viewModel.blockCountLabel}
        </div>
      </div>
    </div>
  );
}

function QueuedMiniBlocks({
  viewModel,
}: {
  viewModel: QueuedSummaryViewModel;
}) {
  return (
    <div className="absolute bottom-0 left-0 right-0 h-2 bg-warning-600 dark:bg-warning-50 flex items-center justify-center gap-[2px] px-1">
      {Array.from({ length: viewModel.visibleBlocks }).map((_, index) => (
        <div
          key={index}
          className="h-1.5 flex-1 max-w-[10px] rounded-[1px] bg-warning-800 dark:bg-warning-500"
        />
      ))}
      {viewModel.hasMoreBlocks && (
        <div className="text-[6px] font-bold text-white dark:text-warning-700 ml-0.5">+</div>
      )}
    </div>
  );
}

function QueuedCompactLabel({ compact }: { compact: boolean }) {
  if (!compact) return null;

  return (
    <div className="text-[10px] font-medium mt-1 text-warning-600 dark:text-warning-400">
      Queued
    </div>
  );
}

function QueuedTooltip({
  compact,
  tooltipText,
}: {
  compact: boolean;
  tooltipText: string;
}) {
  if (compact) return null;

  return (
    <div className={`
      absolute bottom-full left-1/2 -translate-x-1/2 mb-1
      text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded
      bg-sanctuary-800 text-white dark:bg-white dark:text-sanctuary-900
      opacity-0 group-hover:opacity-100 transition-opacity duration-200
      whitespace-nowrap z-50 pointer-events-none shadow-lg
    `}>
      {tooltipText}
    </div>
  );
}
