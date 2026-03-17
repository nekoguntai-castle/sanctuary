import React from 'react';
import { Clock } from 'lucide-react';
import type { PendingTransaction } from '../../src/types';
import type { BlockData } from './types';
import { getBlockColors } from './blockUtils';
import { PendingTxDot } from './PendingTxDot';

interface BlockProps {
  block: BlockData;
  index: number;
  onClick: () => void;
  compact: boolean;
  isAnimating: boolean;
  animationDirection: 'enter' | 'exit' | 'none';
  pendingTxs?: PendingTransaction[];
  explorerUrl: string;
  blockMinFee?: number;
}

// Block component with solid colors and horizontal fill bar
export const Block: React.FC<BlockProps> = ({ block, index, onClick, compact, isAnimating, animationDirection, pendingTxs = [], explorerUrl, blockMinFee }) => {
  const isPending = block.status === 'pending';
  const colors = getBlockColors(isPending);

  // Calculate fill percentage (how full the block is)
  // Max block size is ~4MB (weight), typical is 1.5-2MB
  const fillPercentage = Math.min((block.size / 1.6) * 100, 100);

  // Animation classes
  const getAnimationClass = () => {
    if (!isAnimating) return '';
    if (animationDirection === 'enter') return 'animate-block-enter animate-confirm-glow';
    if (animationDirection === 'exit') return 'animate-block-exit';
    return '';
  };

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
          ${isPending ? 'animate-breathing-pulse' : ''}
          ${getAnimationClass()}
        `}
        style={{
          background: colors.bgGradient,
          animationDelay: `${index * 50}ms`,
        }}
      >
        {/* Pending transaction dots - top right corner */}
        {pendingTxs.length > 0 && (
          <div className={`
            absolute z-20
            ${compact ? 'top-0.5 right-0.5' : 'top-1 right-1'}
            flex flex-wrap gap-0.5 max-w-[50%] justify-end
          `}>
            {pendingTxs.slice(0, compact ? 3 : 5).map((tx) => (
              <PendingTxDot
                key={tx.txid}
                tx={tx}
                explorerUrl={explorerUrl}
                compact={compact}
                isStuck={blockMinFee !== undefined && tx.feeRate < blockMinFee}
              />
            ))}
            {pendingTxs.length > (compact ? 3 : 5) && (
              <span className={`
                ${compact ? 'text-[8px]' : 'text-[9px]'}
                font-bold text-sanctuary-700 dark:text-sanctuary-300
              `}>
                +{pendingTxs.length - (compact ? 3 : 5)}
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div className={`relative z-10 flex flex-col items-center justify-between h-full ${compact ? 'py-1.5 px-1' : 'py-2 px-1'}`}>
          {/* Top: Time - hidden in compact mode */}
          {!compact && (
            <div className={`flex items-center text-[10px] font-bold ${colors.text}`}>
              <Clock className="w-3 h-3 mr-1" />
              <span className="truncate max-w-[60px]">{block.time}</span>
            </div>
          )}

          {/* Middle: Median Fee Rate - main focus */}
          <div className="text-center">
            {!compact && <div className={`text-[10px] uppercase font-bold ${colors.text} mb-0.5`}>Median Fee</div>}
            <div className={`${compact ? 'text-base' : 'text-xl md:text-2xl'} font-black font-mono leading-none tabular-nums ${colors.text}`}>
              {block.medianFee < 1 ? block.medianFee.toFixed(1) : Math.round(block.medianFee)}
            </div>
            <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold font-mono ${colors.text}`}>sat/vB</div>
            {!compact && block.feeRange && (
              <div className={`text-[9px] font-medium ${colors.text} opacity-70 mt-0.5`}>
                {block.feeRange}
              </div>
            )}
          </div>

          {/* Bottom: Height label - darker background */}
          <div className="w-full text-center">
            <div className={`${compact ? 'text-[9px] py-0.5 mx-0.5' : 'text-[10px] py-0.5 mx-1'} font-mono font-bold rounded tabular-nums ${colors.label}`}>
              {isPending ? `${compact ? '' : 'BLK '}${block.height}` : `${typeof block.height === 'number' ? (compact ? block.height : block.height.toLocaleString()) : block.height}`}
            </div>
          </div>
        </div>

        {/* Horizontal fullness bar at bottom */}
        <div className={`absolute bottom-0 left-0 right-0 h-1.5 ${colors.barBg}`}>
          <div
            className={`h-full ${colors.bar} transition-all duration-500 rounded-r-sm`}
            style={{ width: `${fillPercentage}%` }}
          />
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-white/0 group-hover:bg-white/10 dark:group-hover:bg-white/5 transition-colors duration-200 rounded-lg" />
      </button>

      {/* Time label below block in compact mode */}
      {compact && (
        <div className={`text-[10px] font-medium mt-1 ${isPending ? 'text-warning-600 dark:text-warning-400' : 'text-sanctuary-400 dark:text-sanctuary-500'}`}>
          {block.time}
        </div>
      )}

      {/* TX count tooltip on hover - positioned above to avoid overflow clipping */}
      {!compact && block.txCount !== undefined && (
        <div className={`
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          text-[10px] font-medium px-3 py-2 rounded-lg
          bg-sanctuary-800 text-sanctuary-100 dark:bg-sanctuary-100 dark:text-sanctuary-900
          opacity-0 group-hover:opacity-100 transition-all duration-200 delay-150
          group-hover:translate-y-0 -translate-y-1
          whitespace-nowrap z-50 pointer-events-none shadow-xl
          border border-sanctuary-700 dark:border-sanctuary-200
        `}>
          {/* Tooltip arrow pointing down */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 bg-sanctuary-800 dark:bg-sanctuary-100 border-r border-b border-sanctuary-700 dark:border-sanctuary-200" />
          <span className="tabular-nums">{block.txCount.toLocaleString()}</span> txs
          <span className="mx-1.5 text-sanctuary-500 dark:text-sanctuary-400">·</span>
          Median: <span className="tabular-nums">{block.medianFee < 1 ? block.medianFee.toFixed(1) : Math.round(block.medianFee)}</span>
          <span className="mx-1.5 text-sanctuary-500 dark:text-sanctuary-400">·</span>
          Range: <span className="tabular-nums">{block.feeRange}</span>
          <span className="mx-1.5 text-sanctuary-500 dark:text-sanctuary-400">·</span>
          <span className="tabular-nums">{Math.round(fillPercentage)}%</span> full
        </div>
      )}
    </div>
  );
};
