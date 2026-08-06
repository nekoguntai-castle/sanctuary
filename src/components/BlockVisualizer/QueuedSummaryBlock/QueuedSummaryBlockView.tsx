import { useRef, useState } from 'react';
import type { PendingTransaction } from '../../../types';
import { useDismissable } from '../../../hooks/useDismissable';
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
  const [showTooltip, setShowTooltip] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useDismissable(showTooltip, rootRef, () => setShowTooltip(false));

  return (
    <div ref={rootRef} className="relative group flex flex-col items-center">
      <div
        className={`
          relative flex-shrink-0 flex flex-col
          ${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32 md:w-32 md:h-36'}
          rounded-lg overflow-hidden
          bg-warning-500 dark:bg-warning-100
        `}
      >
        <QueuedSummaryToggle
          compact={compact}
          isOpen={showTooltip}
          tooltipText={viewModel.tooltipText}
          onToggle={() => setShowTooltip((open) => !open)}
        />
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
        isOpen={showTooltip}
      />
    </div>
  );
}

// The queued figure ("N txs waiting • M stuck") lives only in the hover
// tooltip and the card has no other tap target, so on touch/keyboard it is
// otherwise unreachable. This overlay is a real <button> (native Enter/Space,
// no manual key handling) that is a SIBLING of the stuck-tx dot buttons rather
// than an ancestor — so the dots stay independently operable and we avoid
// nesting interactive content. It sits above the static content (z-20) but
// below the dots (z-30); the figure is in aria-label so screen readers hear it
// on focus. Only rendered in non-compact mode (compact has no tooltip).
function QueuedSummaryToggle({
  compact,
  isOpen,
  tooltipText,
  onToggle,
}: {
  compact: boolean;
  isOpen: boolean;
  tooltipText: string;
  onToggle: () => void;
}) {
  if (compact) return null;

  return (
    <button
      type="button"
      aria-expanded={isOpen}
      aria-label={tooltipText}
      onClick={onToggle}
      className="absolute inset-0 z-20 cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sanctuary-400"
    />
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
      absolute z-30
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
    <div className="text-[10px] font-medium mt-1 text-warning-600">
      Queued
    </div>
  );
}

function QueuedTooltip({
  compact,
  tooltipText,
  isOpen,
}: {
  compact: boolean;
  tooltipText: string;
  isOpen: boolean;
}) {
  if (compact) return null;

  // Visual only: aria-hidden because the same figure is in the toggle
  // button's aria-label, so screen readers hear it on focus without a
  // duplicate read. Reveal is driven by the toggle state (tap/Enter/Space)
  // OR mouse hover.
  return (
    <div
      aria-hidden="true"
      className={`
        absolute bottom-full left-1/2 -translate-x-1/2 mb-1
        text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded
        bg-sanctuary-800 text-white dark:bg-white dark:text-sanctuary-900
        ${isOpen ? 'opacity-100' : 'opacity-0'} group-hover:opacity-100 transition-opacity duration-200
        whitespace-nowrap z-50 pointer-events-none shadow-lg
      `}
    >
      {tooltipText}
    </div>
  );
}
