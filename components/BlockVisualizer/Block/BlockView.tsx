import { Clock } from 'lucide-react';
import { getBlockColors } from '../blockUtils';
import { PendingTxDot } from '../PendingTxDot';
import {
  getPendingOverflowCount,
  isPendingTxStuck,
} from './blockHelpers';
import type { BlockProps, BlockViewModel } from './types';

interface BlockViewProps extends BlockProps {
  viewModel: BlockViewModel;
}

export function BlockView({
  block,
  index,
  onClick,
  compact,
  pendingTxs = [],
  explorerUrl,
  blockMinFee,
  viewModel,
}: BlockViewProps) {
  const colors = getBlockColors(viewModel.isPending);

  return (
    <div className="relative group flex flex-col items-center">
      <button
        onClick={onClick}
        className={`
          relative flex-shrink-0 flex flex-col
          ${compact ? 'w-[72px] h-[72px]' : 'w-28 h-32 md:w-32 md:h-36'}
          rounded-lg overflow-hidden transition-all duration-300
          hover:scale-105 hover:shadow-lg hover:z-20
          cursor-pointer
          ${colors.bg}
          ${viewModel.isPending ? 'animate-breathing-pulse' : ''}
          ${viewModel.animationClass}
        `}
        style={{
          background: colors.bgGradient,
          animationDelay: `${index * 50}ms`,
        }}
      >
        <PendingTxDots
          pendingTxs={pendingTxs}
          explorerUrl={explorerUrl}
          compact={compact}
          blockMinFee={blockMinFee}
          pendingTxLimit={viewModel.pendingTxLimit}
        />
        <BlockContent
          block={block}
          compact={compact}
          colors={colors}
          viewModel={viewModel}
        />
        <FullnessBar colors={colors} fillPercentage={viewModel.fillPercentage} />
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:group-hover:bg-white/5 transition-colors duration-200 rounded-lg" />
      </button>
      <CompactTimeLabel block={block} compact={compact} isPending={viewModel.isPending} />
      <BlockTooltip
        block={block}
        compact={compact}
        viewModel={viewModel}
      />
    </div>
  );
}

type BlockColors = ReturnType<typeof getBlockColors>;

function PendingTxDots({
  pendingTxs,
  explorerUrl,
  compact,
  blockMinFee,
  pendingTxLimit,
}: {
  pendingTxs: NonNullable<BlockProps['pendingTxs']>;
  explorerUrl: string;
  compact: boolean;
  blockMinFee?: number;
  pendingTxLimit: number;
}) {
  if (pendingTxs.length === 0) return null;

  const overflowCount = getPendingOverflowCount(pendingTxs.length, pendingTxLimit);

  return (
    <div className={`
      absolute z-20
      ${compact ? 'top-0.5 right-0.5' : 'top-1 right-1'}
      flex flex-wrap gap-0.5 max-w-[50%] justify-end
    `}>
      {pendingTxs.slice(0, pendingTxLimit).map((tx) => (
        <PendingTxDot
          key={tx.txid}
          tx={tx}
          explorerUrl={explorerUrl}
          compact={compact}
          isStuck={isPendingTxStuck(tx.feeRate, blockMinFee)}
        />
      ))}
      {overflowCount > 0 && (
        <span className={`
          ${compact ? 'text-[8px]' : 'text-[9px]'}
          font-bold text-sanctuary-700 dark:text-sanctuary-300
        `}>
          +{overflowCount}
        </span>
      )}
    </div>
  );
}

function BlockContent({
  block,
  compact,
  colors,
  viewModel,
}: {
  block: BlockProps['block'];
  compact: boolean;
  colors: BlockColors;
  viewModel: BlockViewModel;
}) {
  return (
    <div className={`relative z-10 flex flex-col items-center justify-between h-full ${compact ? 'py-1.5 px-1' : 'py-2 px-1'}`}>
      <BlockTimeHeader block={block} compact={compact} colors={colors} />
      <MedianFee block={block} compact={compact} colors={colors} viewModel={viewModel} />
      <BlockHeightLabel compact={compact} colors={colors} viewModel={viewModel} />
    </div>
  );
}

function BlockTimeHeader({
  block,
  compact,
  colors,
}: {
  block: BlockProps['block'];
  compact: boolean;
  colors: BlockColors;
}) {
  if (compact) return null;

  return (
    <div className={`flex items-center text-[10px] font-bold ${colors.text}`}>
      <Clock className="w-3 h-3 mr-1" />
      <span className="truncate max-w-[60px]">{block.time}</span>
    </div>
  );
}

function MedianFee({
  block,
  compact,
  colors,
  viewModel,
}: {
  block: BlockProps['block'];
  compact: boolean;
  colors: BlockColors;
  viewModel: BlockViewModel;
}) {
  return (
    <div className="text-center">
      {!compact && <div className={`text-[10px] uppercase font-bold ${colors.text} mb-0.5`}>Median Fee</div>}
      <div className={`${compact ? 'text-base' : 'text-xl md:text-2xl'} font-black font-mono leading-none tabular-nums ${colors.text}`}>
        {viewModel.formattedMedianFee}
      </div>
      <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold font-mono ${colors.text}`}>sat/vB</div>
      {!compact && block.feeRange && (
        <div className={`text-[9px] font-medium ${colors.text} opacity-70 mt-0.5`}>
          {block.feeRange}
        </div>
      )}
    </div>
  );
}

function BlockHeightLabel({
  compact,
  colors,
  viewModel,
}: {
  compact: boolean;
  colors: BlockColors;
  viewModel: BlockViewModel;
}) {
  return (
    <div className="w-full text-center">
      <div className={`${compact ? 'text-[9px] py-0.5 mx-0.5' : 'text-[10px] py-0.5 mx-1'} font-mono font-bold rounded tabular-nums ${colors.label}`}>
        {viewModel.formattedHeight}
      </div>
    </div>
  );
}

function FullnessBar({
  colors,
  fillPercentage,
}: {
  colors: BlockColors;
  fillPercentage: number;
}) {
  return (
    <div className={`absolute bottom-0 left-0 right-0 h-1.5 ${colors.barBg}`}>
      <div
        className={`h-full ${colors.bar} transition-all duration-500 rounded-r-sm`}
        style={{ width: `${fillPercentage}%` }}
      />
    </div>
  );
}

function CompactTimeLabel({
  block,
  compact,
  isPending,
}: {
  block: BlockProps['block'];
  compact: boolean;
  isPending: boolean;
}) {
  if (!compact) return null;

  return (
    <div className={`text-[10px] font-medium mt-1 ${isPending ? 'text-warning-600 dark:text-warning-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
      {block.time}
    </div>
  );
}

function BlockTooltip({
  block,
  compact,
  viewModel,
}: {
  block: BlockProps['block'];
  compact: boolean;
  viewModel: BlockViewModel;
}) {
  if (compact || block.txCount === undefined) return null;

  return (
    <div className={`
      absolute bottom-full left-1/2 -translate-x-1/2 mb-2
      text-[10px] font-medium px-3 py-2 rounded-lg
      bg-sanctuary-800 text-sanctuary-100 dark:bg-sanctuary-100 dark:text-sanctuary-900
      opacity-0 group-hover:opacity-100 transition-all duration-200 delay-150
      group-hover:translate-y-0 -translate-y-1
      whitespace-nowrap z-50 pointer-events-none shadow-xl
      border border-sanctuary-700 dark:border-sanctuary-200
    `}>
      <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-sanctuary-800 dark:bg-sanctuary-100 border-r border-b border-sanctuary-700 dark:border-sanctuary-200" />
      <span className="tabular-nums">{block.txCount.toLocaleString()}</span> txs
      <span className="mx-1.5 text-sanctuary-500 dark:text-sanctuary-400">·</span>
      Median: <span className="tabular-nums">{viewModel.formattedMedianFee}</span>
      <span className="mx-1.5 text-sanctuary-500 dark:text-sanctuary-400">·</span>
      Range: <span className="tabular-nums">{block.feeRange}</span>
      <span className="mx-1.5 text-sanctuary-500 dark:text-sanctuary-400">·</span>
      <span className="tabular-nums">{Math.round(viewModel.fillPercentage)}%</span> full
    </div>
  );
}
