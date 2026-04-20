import React from 'react';

interface LogStatusBarProps {
  isPaused: boolean;
  autoScroll: boolean;
}

export const LogStatusBar: React.FC<LogStatusBarProps> = ({ isPaused, autoScroll }) => (
  <div className="px-4 py-2 surface-muted border-t border-sanctuary-200 dark:border-sanctuary-800 flex items-center justify-between text-xs text-sanctuary-400">
    <span>
      {isPaused ? (
        <span className="text-warning-500">Paused</span>
      ) : (
        <span className="text-success-500">Live</span>
      )}
    </span>
    <span>
      {autoScroll ? 'Auto-scroll enabled' : 'Scroll to bottom to re-enable auto-scroll'}
    </span>
  </div>
);
