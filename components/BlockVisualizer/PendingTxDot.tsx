import React, { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { PendingTransaction } from '../../src/types';
import { formatTimeInQueue } from './blockUtils';

interface PendingTxDotProps {
  tx: PendingTransaction;
  explorerUrl: string;
  compact: boolean;
  isStuck?: boolean;
}

// Pending transaction dot component
export const PendingTxDot: React.FC<PendingTxDotProps> = ({ tx, explorerUrl, compact, isStuck = false }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const isSent = tx.type === 'sent';

  // Colors: amber for stuck, rose for sent, muted red/coral for received
  const dotColor = isStuck
    ? 'bg-amber-500 dark:bg-amber-400 animate-pulse'
    : isSent
      ? 'bg-rose-500 dark:bg-rose-400'
      : 'bg-red-400/80 dark:bg-red-400/70';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(`${explorerUrl}/tx/${tx.txid}`, '_blank');
  };

  // Calculate ETA based on position in mempool (rough estimate)
  const estimateEta = (): string => {
    if (isStuck) return 'Stuck - fee too low';
    if (tx.feeRate >= 20) return '~10 min';
    if (tx.feeRate >= 10) return '~30 min';
    if (tx.feeRate >= 5) return '~1 hour';
    return '~2+ hours';
  };

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        onClick={handleClick}
        className={`
          ${compact ? 'w-2 h-2' : 'w-2.5 h-2.5'}
          rounded-full ${dotColor}
          hover:scale-125 transition-transform duration-150
          ring-1 ring-white/50 dark:ring-black/30
          cursor-pointer
        `}
        title={`${isSent ? 'Sending' : 'Receiving'} ${tx.feeRate} sat/vB`}
      />

      {/* Detailed tooltip */}
      {showTooltip && !compact && (
        <div className={`
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          bg-sanctuary-900 dark:bg-sanctuary-100
          text-white dark:text-sanctuary-900
          text-[10px] rounded-lg shadow-lg
          py-2 px-3 z-[100]
          whitespace-nowrap
          pointer-events-none
        `}>
          {/* Arrow */}
          <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
            <div className="border-4 border-transparent border-t-sanctuary-900 dark:border-t-sanctuary-100" />
          </div>

          {/* Content */}
          <div className="space-y-1">
            <div className="font-bold text-[11px] flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${dotColor}`} />
              {isSent ? 'Sending' : 'Receiving'}
            </div>

            <div className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5">
              <span className="text-sanctuary-400 dark:text-sanctuary-500">Fee Rate:</span>
              <span className="font-mono font-bold">{tx.feeRate.toFixed(1)} sat/vB</span>

              <span className="text-sanctuary-400 dark:text-sanctuary-500">ETA:</span>
              <span className="font-bold">{estimateEta()}</span>

              <span className="text-sanctuary-400 dark:text-sanctuary-500">Fee:</span>
              <span className="font-mono">{tx.fee.toLocaleString()} sats</span>

              <span className="text-sanctuary-400 dark:text-sanctuary-500">Amount:</span>
              <span className="font-mono">{Math.abs(tx.amount).toLocaleString()} sats</span>

              {tx.recipient && (
                <>
                  <span className="text-sanctuary-400 dark:text-sanctuary-500">To:</span>
                  <span className="font-mono truncate max-w-[120px]">
                    {tx.recipient.slice(0, 8)}...{tx.recipient.slice(-4)}
                  </span>
                </>
              )}

              <span className="text-sanctuary-400 dark:text-sanctuary-500">Waiting:</span>
              <span>{formatTimeInQueue(tx.timeInQueue)}</span>
            </div>

            <div className="text-sanctuary-500 dark:text-sanctuary-400 text-[9px] pt-1 border-t border-sanctuary-700 dark:border-sanctuary-300 flex items-center gap-1">
              <ExternalLink className="w-3 h-3" />
              Click to view in explorer
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
