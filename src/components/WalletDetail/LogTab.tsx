/**
 * Log Tab Component
 *
 * Real-time wallet sync log viewer with filtering and controls.
 */

import React, { useRef, useState, useEffect } from 'react';
import type { WalletLogEntry } from '../../hooks/websocket';
import { filterLogsByLevel } from './LogTab/logFiltering';
import { LogContent } from './LogTab/LogContent';
import { LogControls } from './LogTab/LogControls';
import { LogStatusBar } from './LogTab/LogStatusBar';
import type { LogLevelFilter } from './LogTab/types';
import type {
  WalletSyncControls,
  WalletSyncLifecycleClassification,
} from '../../utils/walletSyncLifecycle';
import { findLastSyncProgressCheckpoint } from './LogTab/logPresentation';
import { LogAttemptStatus } from './LogTab/LogAttemptStatus';

interface LogTabProps {
  logs: WalletLogEntry[];
  isPaused: boolean;
  isLoading: boolean;
  syncLifecycle: WalletSyncLifecycleClassification;
  syncControls: WalletSyncControls;
  onTogglePause: () => void;
  onClearLogs: () => void;
  onSync: () => void;
  onFullResync: () => void;
}

export const LogTab: React.FC<LogTabProps> = ({
  logs,
  isPaused,
  isLoading,
  syncLifecycle,
  syncControls,
  onTogglePause,
  onClearLogs,
  onSync,
  onFullResync,
}) => {
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [logLevelFilter, setLogLevelFilter] = useState<LogLevelFilter>('info');

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filteredLogs = filterLogsByLevel(logs, logLevelFilter);
  const checkpoint = findLastSyncProgressCheckpoint(logs);

  const handleScroll: React.UIEventHandler<HTMLDivElement> = (event) => {
    const element = event.currentTarget;
    const isAtBottom = element.scrollHeight - element.scrollTop <= element.clientHeight + 50;
    if (autoScroll !== isAtBottom) {
      setAutoScroll(isAtBottom);
    }
  };

  return (
    <div className="surface-elevated rounded-xl border border-sanctuary-200 dark:border-sanctuary-800 overflow-hidden animate-fade-in">
      <LogControls
        logsCount={logs.length}
        filteredLogsCount={filteredLogs.length}
        filter={logLevelFilter}
        isPaused={isPaused}
        syncControls={syncControls}
        onFilterChange={setLogLevelFilter}
        onTogglePause={onTogglePause}
        onClearLogs={onClearLogs}
        onSync={onSync}
        onFullResync={onFullResync}
        autoScroll={autoScroll}
        onAutoScrollChange={setAutoScroll}
      />
      <LogAttemptStatus checkpoint={checkpoint} lifecycle={syncLifecycle} controls={syncControls} />
      <LogContent
        ref={logContainerRef}
        isLoading={isLoading}
        logsCount={logs.length}
        filteredLogs={filteredLogs}
        onScroll={handleScroll}
      />
      <LogStatusBar isPaused={isPaused} autoScroll={autoScroll} />
    </div>
  );
};
