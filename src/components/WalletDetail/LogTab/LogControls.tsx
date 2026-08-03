import React from 'react';
import { Pause, Play, RefreshCw, RotateCcw, ScrollText } from 'lucide-react';
import type { LogLevelFilter } from './types';

interface LogControlsProps {
  logsCount: number;
  filteredLogsCount: number;
  filter: LogLevelFilter;
  isPaused: boolean;
  syncing: boolean;
  onFilterChange: (filter: LogLevelFilter) => void;
  onTogglePause: () => void;
  onClearLogs: () => void;
  onSync: () => void;
  onFullResync: () => void;
  autoScroll: boolean;
  onAutoScrollChange: (enabled: boolean) => void;
}

export const LogControls: React.FC<LogControlsProps> = ({
  logsCount,
  filteredLogsCount,
  filter,
  isPaused,
  syncing,
  onFilterChange,
  onTogglePause,
  onClearLogs,
  onSync,
  onFullResync,
  autoScroll,
  onAutoScrollChange,
}) => (
  <div className="px-4 py-3 surface-muted border-b border-sanctuary-200 dark:border-sanctuary-800 flex items-center justify-between">
    <div className="flex items-center space-x-2">
      <ScrollText className="w-4 h-4 text-sanctuary-500" />
      <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Sync Log</span>
      <span className="text-xs px-2 py-0.5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500">
        {filter === 'all' ? `${logsCount} entries` : `${filteredLogsCount}/${logsCount} entries`}
      </span>
    </div>
    <div className="flex items-center space-x-2">
      <button
        onClick={onSync}
        disabled={syncing}
        className="px-2.5 py-1 text-xs font-medium text-primary-600 dark:text-primary-400 hover:bg-primary-100 dark:hover:bg-primary-900/30 rounded transition-colors disabled:opacity-50 flex items-center space-x-1"
        title="Sync wallet with blockchain"
      >
        <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
        <span>Sync</span>
      </button>
      <button
        onClick={onFullResync}
        disabled={syncing}
        className="px-2.5 py-1 text-xs font-medium text-warning-600 dark:text-warning-400 hover:bg-warning-100 dark:hover:bg-warning-900/30 rounded transition-colors disabled:opacity-50 flex items-center space-x-1"
        title="Clear all transactions and re-sync from blockchain"
      >
        <RotateCcw className="w-3 h-3" />
        <span>Full Resync</span>
      </button>
      <div className="w-px h-4 bg-sanctuary-200 dark:bg-sanctuary-700" />
      <select
        value={filter}
        onChange={(event) => onFilterChange(event.target.value as LogLevelFilter)}
        className="text-xs px-2 py-1 rounded border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
      >
        <option value="all">All Levels</option>
        <option value="info">Info+</option>
        <option value="warn">Warn+</option>
        <option value="error">Error Only</option>
      </select>
      <div className="w-px h-4 bg-sanctuary-200 dark:bg-sanctuary-700" />
      <button
        onClick={onTogglePause}
        className={`p-1.5 rounded transition-colors ${
          isPaused
            ? 'bg-warning-100 dark:bg-warning-900/30 text-warning-600 dark:text-warning-400'
            : 'hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 text-sanctuary-500'
        }`}
        title={isPaused ? 'Resume' : 'Pause'}
      >
        {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
      </button>
      <button
        onClick={onClearLogs}
        className="px-3 py-1.5 text-xs font-medium text-sanctuary-500 hover:text-sanctuary-700 dark:hover:text-sanctuary-300 hover:bg-sanctuary-100 dark:hover:bg-sanctuary-800 rounded transition-colors"
      >
        Clear
      </button>
      <label className="flex items-center space-x-1.5 text-xs text-sanctuary-500 cursor-pointer">
        <input
          type="checkbox"
          checked={autoScroll}
          onChange={(event) => onAutoScrollChange(event.target.checked)}
          className="rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
        />
        <span>Auto-scroll</span>
      </label>
    </div>
  </div>
);
