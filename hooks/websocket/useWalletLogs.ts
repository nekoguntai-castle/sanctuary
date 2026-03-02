/**
 * Wallet Logs Hook
 *
 * Subscribe to wallet log events with historical log fetching.
 * Returns an array of log entries that accumulates in real-time.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { websocketClient, WebSocketEvent } from '../../services/websocket';
import { getWalletLogs } from '../../src/api/sync';
import { createLogger } from '../../utils/logger';

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
  const { maxEntries = 500, enabled = true } = options;
  const [logs, setLogs] = useState<WalletLogEntry[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const logsRef = useRef<WalletLogEntry[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Keep ref in sync with state for use in callbacks
  useEffect(() => {
    logsRef.current = logs;
  }, [logs]);

  const clearLogs = useCallback(() => {
    setLogs([]);
    logsRef.current = [];
    seenIdsRef.current.clear();
  }, []);

  const togglePause = useCallback(() => {
    setIsPaused(prev => !prev);
  }, []);

  // Fetch historical logs when enabled
  useEffect(() => {
    if (!walletId || !enabled) return;

    let cancelled = false;
    setIsLoading(true);

    getWalletLogs(walletId)
      .then(historicalLogs => {
        if (cancelled) return;

        // Initialize with historical logs
        setLogs(historicalLogs);

        // Track seen IDs to avoid duplicates with real-time updates
        seenIdsRef.current = new Set(historicalLogs.map(log => log.id));
      })
      .catch(err => {
        // Silently fail - logs are optional
        log.warn('Failed to fetch historical logs', { error: err });
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [walletId, enabled]);

  // Subscribe to real-time log events
  useEffect(() => {
    if (!walletId || !enabled) return;

    const channel = `wallet:${walletId}:log`;

    // Subscribe to the log channel
    websocketClient.subscribe(channel);

    // Handle log events
    const handleLog = (event: WebSocketEvent) => {
      if (event.event !== 'log') return;

      // Check if this is for our wallet
      const eventChannel = event.channel;
      if (eventChannel !== channel) return;

      // Don't add if paused
      if (isPaused) return;

      const entry = event.data as WalletLogEntry;

      // Skip if we've already seen this entry (from historical fetch)
      if (seenIdsRef.current.has(entry.id)) return;
      seenIdsRef.current.add(entry.id);

      setLogs(prev => {
        const newLogs = [...prev, entry];
        // Keep only last maxEntries
        if (newLogs.length > maxEntries) {
          // Also clean up seenIds for removed entries
          const removedLogs = newLogs.slice(0, newLogs.length - maxEntries);
          for (const removed of removedLogs) {
            seenIdsRef.current.delete(removed.id);
          }
          return newLogs.slice(-maxEntries);
        }
        return newLogs;
      });
    };

    websocketClient.on('log', handleLog);

    return () => {
      websocketClient.unsubscribe(channel);
      websocketClient.off('log', handleLog);
    };
  }, [walletId, enabled, maxEntries, isPaused]);

  return {
    logs,
    isPaused,
    isLoading,
    clearLogs,
    togglePause,
  };
};
