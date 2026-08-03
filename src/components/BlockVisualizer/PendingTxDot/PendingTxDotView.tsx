import { ExternalLink } from 'lucide-react';
import type { PendingTxDotViewProps } from './types';

export function PendingTxDotView({
  tx,
  compact,
  showTooltip,
  viewModel,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: PendingTxDotViewProps) {
  return (
    <div
      className="relative"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <button
        onClick={onClick}
        className={`
          ${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'}
          rounded-full ${viewModel.dotColor}
          hover:scale-125 transition-transform duration-150
          ring-1 ring-white/50 dark:ring-black/30
          cursor-pointer
        `}
        title={viewModel.title}
      />
      {showTooltip && !compact && (
        <PendingTxTooltip tx={tx} viewModel={viewModel} />
      )}
    </div>
  );
}

function PendingTxTooltip({
  tx,
  viewModel,
}: Pick<PendingTxDotViewProps, 'tx' | 'viewModel'>) {
  return (
    <div className={`
      absolute bottom-full left-1/2 -translate-x-1/2 mb-2
      bg-sanctuary-900 dark:bg-sanctuary-100
      text-white dark:text-sanctuary-900
      text-[10px] rounded-lg shadow-lg
      py-2 px-3 z-[100]
      whitespace-nowrap
      pointer-events-none
    `}>
      <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
        <div className="border-4 border-transparent border-t-sanctuary-900 dark:border-t-sanctuary-100" />
      </div>
      <div className="space-y-1">
        <TooltipTitle viewModel={viewModel} />
        <TooltipDetails tx={tx} viewModel={viewModel} />
        <TooltipFooter />
      </div>
    </div>
  );
}

function TooltipTitle({ viewModel }: Pick<PendingTxDotViewProps, 'viewModel'>) {
  return (
    <div className="font-bold text-[11px] flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${viewModel.dotColor}`} />
      {viewModel.directionLabel}
    </div>
  );
}

function TooltipDetails({
  tx,
  viewModel,
}: Pick<PendingTxDotViewProps, 'tx' | 'viewModel'>) {
  return (
    <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
      <span className="text-sanctuary-400 dark:text-sanctuary-500">Fee Rate:</span>
      <span className="font-mono font-bold">{tx.feeRate.toFixed(1)} sat/vB</span>
      <span className="text-sanctuary-400 dark:text-sanctuary-500">ETA:</span>
      <span className="font-bold">{viewModel.eta}</span>
      <span className="text-sanctuary-400 dark:text-sanctuary-500">Fee:</span>
      <span className="font-mono">{tx.fee.toLocaleString()} sats</span>
      <span className="text-sanctuary-400 dark:text-sanctuary-500">Amount:</span>
      <span className="font-mono">{Math.abs(tx.amount).toLocaleString()} sats</span>
      <RecipientRow recipientPreview={viewModel.recipientPreview} />
      <span className="text-sanctuary-400 dark:text-sanctuary-500">Waiting:</span>
      <span>{viewModel.waitingTime}</span>
    </div>
  );
}

function RecipientRow({ recipientPreview }: { recipientPreview: string | null }) {
  if (!recipientPreview) return null;

  return (
    <>
      <span className="text-sanctuary-400 dark:text-sanctuary-500">To:</span>
      <span className="font-mono truncate max-w-[120px]">
        {recipientPreview}
      </span>
    </>
  );
}

function TooltipFooter() {
  return (
    <div className="text-sanctuary-500 dark:text-sanctuary-400 text-[9px] pt-1 border-t border-sanctuary-700 dark:border-sanctuary-300 flex items-center gap-1">
      <ExternalLink className="w-3 h-3" />
      Click to view in explorer
    </div>
  );
}
