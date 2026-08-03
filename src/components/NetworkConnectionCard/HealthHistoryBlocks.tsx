import React from 'react';
import type { HealthHistoryBlocksProps } from './types';

// Health History Blocks Component - shows colored blocks for recent health checks
export const HealthHistoryBlocks: React.FC<HealthHistoryBlocksProps> = ({ history, maxBlocks = 10 }) => {
  if (!history || history.length === 0) {
    return null;
  }

  // Take the most recent N blocks (history is most-recent-first from backend)
  const blocks = history.slice(0, maxBlocks);

  return (
    <div className="flex items-center space-x-0.5" title={`${history.length} health checks recorded`}>
      {blocks.map((check, i) => (
        <div
          key={i}
          className={`w-1.5 h-3 rounded-sm transition-colors ${
            check.success
              ? 'bg-emerald-400 dark:bg-emerald-500'
              : 'bg-rose-400 dark:bg-rose-500'
          }`}
          title={`${check.success ? 'Healthy' : 'Failed'} - ${new Date(check.timestamp).toLocaleTimeString()}`}
        />
      ))}
      {history.length > maxBlocks && (
        <span className="text-[9px] text-sanctuary-400 ml-1">
          +{history.length - maxBlocks}
        </span>
      )}
    </div>
  );
};
