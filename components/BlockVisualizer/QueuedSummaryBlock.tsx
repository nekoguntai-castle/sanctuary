import React from 'react';
import type { PendingTransaction } from '../../src/types';
import type { QueuedBlocksSummary } from './types';
import { PendingTxDot } from './PendingTxDot';

interface QueuedSummaryBlockProps {
  summary: QueuedBlocksSummary;
  compact: boolean;
  stuckTxs?: PendingTransaction[];
  explorerUrl?: string;
}

// Summary block for queued transactions - darker than regular pending blocks
export const QueuedSummaryBlock: React.FC<QueuedSummaryBlockProps> = ({ summary, compact, stuckTxs = [], explorerUrl = 'https://mempool.space' }) => {
  // Generate mini block indicators for the bottom bar
  const maxVisibleBlocks = 8;
  const visibleBlocks = Math.min(summary.blockCount, maxVisibleBlocks);
  const hasMore = summary.blockCount > maxVisibleBlocks;

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
        {/* Stuck transaction dots - top right corner */}
        {stuckTxs.length > 0 && (
          <div className={`
            absolute z-20
            ${compact ? 'top-0.5 right-0.5' : 'top-1 right-1'}
            flex flex-wrap gap-0.5 max-w-[50%] justify-end
          `}>
            {stuckTxs.slice(0, compact ? 3 : 5).map((tx) => (
              <PendingTxDot
                key={tx.txid}
                tx={tx}
                explorerUrl={explorerUrl}
                compact={compact}
                isStuck={true}
              />
            ))}
            {stuckTxs.length > (compact ? 3 : 5) && (
              <span className={`
                ${compact ? 'text-[8px]' : 'text-[9px]'}
                font-bold text-white dark:text-warning-900
              `}>
                +{stuckTxs.length - (compact ? 3 : 5)}
              </span>
            )}
          </div>
        )}

        {/* Content */}
        <div className={`relative z-10 flex flex-col items-center justify-between h-full ${compact ? 'py-1.5 px-1' : 'py-2 px-1'}`}>
          {/* Top spacer - hidden in compact */}
          {!compact && <div className="text-[10px] font-bold text-white dark:text-warning-900">Queue</div>}

          {/* Middle: Median Fee */}
          <div className="text-center">
            {!compact && <div className="text-[10px] uppercase font-bold text-white dark:text-warning-900 mb-0.5">Median Fee</div>}
            <div className={`${compact ? 'text-base' : 'text-xl'} font-black leading-none text-white dark:text-warning-900`}>
              {summary.averageFee < 1 ? summary.averageFee.toFixed(1) : Math.round(summary.averageFee)}
            </div>
            <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} font-bold text-white dark:text-warning-900`}>sat/vB</div>
          </div>

          {/* Bottom: Block count - darker background */}
          <div className="w-full text-center">
            <div className={`${compact ? 'text-[9px] py-0.5 mx-0.5' : 'text-[10px] py-0.5 mx-1'} font-mono font-bold rounded bg-warning-700 text-white dark:bg-warning-50 dark:text-warning-900`}>
              +{summary.blockCount}{compact ? '' : ' BLKS'}
            </div>
          </div>
        </div>

        {/* Bottom bar: stacked mini blocks instead of fullness indicator */}
        <div className="absolute bottom-0 left-0 right-0 h-2 bg-warning-600 dark:bg-warning-50 flex items-center justify-center gap-[2px] px-1">
          {[...Array(visibleBlocks)].map((_, i) => (
            <div
              key={i}
              className="h-1.5 flex-1 max-w-[10px] rounded-[1px] bg-warning-800 dark:bg-warning-500"
            />
          ))}
          {hasMore && (
            <div className="text-[6px] font-bold text-white dark:text-warning-700 ml-0.5">+</div>
          )}
        </div>
      </div>

      {/* "Queued" label below block in compact mode */}
      {compact && (
        <div className="text-[10px] font-medium mt-1 text-warning-600 dark:text-warning-400">
          Queued
        </div>
      )}

      {/* TX count tooltip on hover - positioned above to avoid overflow clipping */}
      {!compact && (
        <div className={`
          absolute bottom-full left-1/2 -translate-x-1/2 mb-1
          text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded
          bg-sanctuary-800 text-white dark:bg-white dark:text-sanctuary-900
          opacity-0 group-hover:opacity-100 transition-opacity duration-200
          whitespace-nowrap z-50 pointer-events-none shadow-lg
        `}>
          {summary.totalTransactions.toLocaleString()} txs waiting
          {stuckTxs.length > 0 && ` • ${stuckTxs.length} stuck`}
        </div>
      )}
    </div>
  );
};
