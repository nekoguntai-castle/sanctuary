/**
 * Log Tab Component
 *
 * Real-time wallet sync log viewer with filtering and controls.
 */

import React, { useRef, useState, useEffect } from 'react';
import { ScrollText, RefreshCw, RotateCcw, Pause, Play } from 'lucide-react';
import type { WalletLogEntry } from '../../hooks/websocket';

interface LogTabProps {
  logs: WalletLogEntry[];
  isPaused: boolean;
  isLoading: boolean;
  syncing: boolean;
  onTogglePause: () => void;
  onClearLogs: () => void;
  onSync: () => void;
  onFullResync: () => void;
}

export const LogTab: React.FC<LogTabProps> = ({
  logs,
  isPaused,
  isLoading,
  syncing,
  onTogglePause,
  onClearLogs,
  onSync,
  onFullResync,
}) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logLevelFilter, setLogLevelFilter] = useState<'all' | 'info' | 'warn' | 'error'>('info');

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Filter logs based on level
  const filteredLogs = logs.filter((entry) => {
    if (logLevelFilter === 'all') return true;
    const levelOrder = ['debug', 'info', 'warn', 'error'];
    const entryLevel = levelOrder.indexOf(entry.level);
    const filterLevel = levelOrder.indexOf(logLevelFilter);
    return entryLevel >= filterLevel;
  });

  return (
    <div className="surface-elevated rounded-2xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden animate-fade-in">
      {/* Log Controls */}
      <div className="px-4 py-3 surface-muted border-b border-sanctuary-200 dark:border-sanctuary-800 flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <ScrollText className="w-4 h-4 text-sanctuary-500" />
          <span className="text-sm font-medium text-sanctuary-700 dark:text-sanctuary-300">Sync Log</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-sanctuary-200 dark:bg-sanctuary-700 text-sanctuary-500">
            {logLevelFilter === 'all' ? `${logs.length} entries` : `${filteredLogs.length}/${logs.length} entries`}
          </span>
        </div>
        <div className="flex items-center space-x-2">
          {/* Sync buttons */}
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
          {/* Log level filter */}
          <select
            value={logLevelFilter}
            onChange={(e) => setLogLevelFilter(e.target.value as typeof logLevelFilter)}
            className="text-xs px-2 py-1 rounded border border-sanctuary-200 dark:border-sanctuary-700 bg-white dark:bg-sanctuary-800 text-sanctuary-700 dark:text-sanctuary-300 focus:outline-none focus:ring-1 focus:ring-primary-500"
          >
            <option value="all">All Levels</option>
            <option value="info">Info+</option>
            <option value="warn">Warn+</option>
            <option value="error">Error Only</option>
          </select>
          <div className="w-px h-4 bg-sanctuary-200 dark:bg-sanctuary-700" />
          {/* Log controls */}
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
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="rounded border-sanctuary-300 text-primary-600 focus:ring-primary-500"
            />
            <span>Auto-scroll</span>
          </label>
        </div>
      </div>

      {/* Log Content */}
      <div
        ref={logContainerRef}
        className="h-[500px] overflow-y-auto font-mono text-xs"
        onScroll={(e) => {
          const el = e.currentTarget;
          const isAtBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 50;
          if (autoScroll !== isAtBottom) {
            setAutoScroll(isAtBottom);
          }
        }}
      >
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-sanctuary-400">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500 mb-3" />
            <p className="text-sm">Loading logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-sanctuary-400">
            <ScrollText className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">No log entries yet</p>
            <p className="text-xs mt-1">Trigger a sync to see real-time logs</p>
          </div>
        ) : (
          <div className="p-2">
            {filteredLogs.map((entry) => {
              const logEntry = entry as {
                id: string;
                timestamp: string;
                level: string;
                module: string;
                message: string;
                details?: Record<string, unknown>;
              };
              const level = logEntry.level;
              const moduleName = logEntry.module;

              return (
                <div
                  key={logEntry.id}
                  className={`flex items-start py-1 px-2 rounded hover:bg-sanctuary-50 dark:hover:bg-sanctuary-900 ${
                    level === 'error' ? 'bg-rose-50/50 dark:bg-rose-900/10' :
                    level === 'warn' ? 'bg-warning-50/50 dark:bg-warning-900/10' : ''
                  }`}
                >
                  {/* Timestamp */}
                  <span className="text-sanctuary-400 flex-shrink-0 w-20">
                    {new Date(logEntry.timestamp).toLocaleTimeString('en-US', { hour12: false })}
                  </span>
                  {/* Level */}
                  <span className={`flex-shrink-0 w-12 font-medium ${
                    level === 'debug' ? 'text-sanctuary-400' :
                    level === 'info' ? 'text-success-600 dark:text-success-400' :
                    level === 'warn' ? 'text-warning-600 dark:text-warning-400' :
                    'text-rose-600 dark:text-rose-400'
                  }`}>
                    {level.toUpperCase()}
                  </span>
                  {/* Module Badge */}
                  <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mr-2 ${
                    moduleName === 'SYNC' ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300' :
                    moduleName === 'BLOCKCHAIN' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300' :
                    moduleName === 'TX' ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300' :
                    moduleName === 'UTXO' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300' :
                    moduleName === 'ELECTRUM' ? 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300' :
                    'bg-sanctuary-100 dark:bg-sanctuary-800 text-sanctuary-600 dark:text-sanctuary-400'
                  }`}>
                    {moduleName}
                  </span>
                  {/* Tor Badge - only shown when viaTor is true */}
                  {Boolean(logEntry.details?.viaTor) && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium mr-2 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300" title="Connection routed through Tor">
                      🧅 TOR
                    </span>
                  )}
                  {/* Message */}
                  <span className="text-sanctuary-700 dark:text-sanctuary-300 flex-1 break-words">
                    {logEntry.message}
                    {logEntry.details && (
                      <span className="text-sanctuary-400 ml-2">
                        {Object.entries(logEntry.details)
                          .filter(([k]) => k !== 'viaTor') // viaTor shown as badge
                          .map(([k, v]) => `${k}=${v}`).join(' ')}
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Status Bar */}
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
    </div>
  );
};
