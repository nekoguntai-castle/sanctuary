/**
 * Wallet Logs Hook
 *
 * Subscribe to wallet log events with historical log fetching.
 * Returns an array of log entries that accumulates in real-time.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { WebSocketChannels } from '@sanctuary/shared/types/websocket';
import { websocketClient, WebSocketEvent } from '../../services/websocket';
import { getWalletLogs } from '../../api/sync';
import { createLogger } from '../../utils/logger';
import {
  mergeWalletLogEntries,
  normalizeWalletLogMaxEntries,
} from './walletLogMerge';

const log = createLogger('useWebSocket');

// Log entry type matching backend WalletLogEntry
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WalletLogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: Record<string, unknown>;
}

export const useWalletLogs = (
  walletId: string | undefined,
  options: {
    maxEntries?: number;
    enabled?: boolean;
  } = {}
) => {
  const { enabled = true } = options;
  const maxEntries = normalizeWalletLogMaxEntries(options.maxEntries);
  const [logs, setLogs] = useState<WalletLogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const logsRef = useRef<WalletLogEntry[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pausedRef = useRef(false);
  const maxEntriesRef = useRef(maxEntries);
  const sessionRef = useRef({ walletId, epoch: 0 });
  const clearEpochRef = useRef(0);

  maxEntriesRef.current = maxEntries;

  const commitLogs = useCallback((incoming: readonly WalletLogEntry[]) => {
    const next = mergeWalletLogEntries(
      logsRef.current,
      incoming,
      maxEntriesRef.current,
    );
    logsRef.current = next;
    seenIdsRef.current = new Set(next.map(entry => entry.id));
    setLogs(next);
  }, []);

  // Reset wallet-owned state even when live subscriptions are disabled.
  useEffect(() => {
    if (sessionRef.current.walletId === walletId) return;
    sessionRef.current = { walletId, epoch: sessionRef.current.epoch + 1 };
    clearEpochRef.current += 1;
    logsRef.current = [];
    seenIdsRef.current.clear();
    setLogs([]);
    setIsLoading(false);
  }, [walletId]);

  useEffect(() => {
    commitLogs([]);
  }, [commitLogs, maxEntries]);

  const clearLogs = useCallback(() => {
    clearEpochRef.current += 1;
    setLogs([]);
    setIsLoading(false);
    logsRef.current = [];
    seenIdsRef.current.clear();
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(prev => {
      const next = !prev;
      pausedRef.current = next;
      return next;
    });
  }, []);

  // Fetch historical logs when enabled
  useEffect(() => {
    if (!walletId || !enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const sessionEpoch = sessionRef.current.epoch;
    const clearEpoch = clearEpochRef.current;
    const isCurrentRequest = () => !cancelled
      && sessionRef.current.walletId === walletId
      && sessionRef.current.epoch === sessionEpoch
      && clearEpochRef.current === clearEpoch;
    setIsLoading(true);

    getWalletLogs(walletId)
      .then(historicalLogs => {
        if (!isCurrentRequest()) return;
        commitLogs(historicalLogs);
      })
      .catch(err => {
        if (!isCurrentRequest()) return;
        // Silently fail - logs are optional
        log.warn('Failed to fetch historical logs', { error: err });
      })
      .finally(() => {
        if (isCurrentRequest()) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletId, enabled, commitLogs]);

  // Subscribe to real-time log events
  useEffect(() => {
    if (!walletId || !enabled) return;

    const channel = WebSocketChannels.walletEvent(walletId, 'log');

    // Subscribe to the log channel
    websocketClient.subscribe(channel);

    // Handle log events
    const handleLog = (event: WebSocketEvent) => {
      if (event.event !== 'log') return;

      // Check if this is for our wallet
      const eventChannel = event.channel;
      if (eventChannel !== channel) return;

      // Don't add if paused
      if (pausedRef.current) return;

      const entry = event.data as WalletLogEntry;

      // Skip if we've already seen this entry (from historical fetch)
      if (seenIdsRef.current.has(entry.id)) return;
      commitLogs([entry]);
    };

    websocketClient.on('log', handleLog);

    return () => {
      websocketClient.unsubscribe(channel);
      websocketClient.off('log', handleLog);
    };
  }, [walletId, enabled, commitLogs]);

  const currentSession = sessionRef.current.walletId === walletId;
  return {
    logs: currentSession ? logs : [],
    isPaused,
    isLoading: currentSession ? isLoading : false,
    clearLogs,
    togglePause,
  };
};
