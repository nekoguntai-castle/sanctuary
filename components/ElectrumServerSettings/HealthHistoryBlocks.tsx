import React from 'react';
import { HealthHistoryBlocksProps } from './types';

// Health History Blocks Component - shows colored blocks for recent health checks
export const HealthHistoryBlocks: React.FC<HealthHistoryBlocksProps> = ({ history, maxBlocks = 10 }) => {
  if (!history || history.length === 0) {
    return null;
  }

  // Take the most recent N blocks (history is most-recent-first from backend)
  const blocks = history.slice(0, maxBlocks);

  return (
    <div className="flex items-center space-x-0.5" title="Recent health checks (newest → oldest)">
      {blocks.map((check, index) => {
        const timestamp = new Date(check.timestamp).toLocaleString();
        const latencyText = check.latencyMs ? `${check.latencyMs}ms` : '';
        const tooltipText = check.success
          ? `✓ ${timestamp}${latencyText ? ` (${latencyText})` : ''}`
          : `✗ ${timestamp}${check.error ? `: ${check.error}` : ''}`;

        return (
          <div
            key={`${check.timestamp}-${index}`}
            className={`w-2 h-2 rounded-sm cursor-help transition-transform hover:scale-125 ${
              check.success
                ? 'bg-success-500 dark:bg-success-400'
                : 'bg-rose-500 dark:bg-rose-400'
            }`}
            title={tooltipText}
          />
        );
      })}
      {history.length > maxBlocks && (
        <span className="text-[9px] text-sanctuary-400 ml-1">
          +{history.length - maxBlocks}
        </span>
      )}
    </div>
  );
};
