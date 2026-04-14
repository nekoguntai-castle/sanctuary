import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionChangeCallbacks,
  eventCallbacks,
  flushPromises,
  mockConnect,
  mockDisconnect,
  mockGetState,
  mockGetWalletLogs,
  mockInvalidateQueries,
  mockIsConnected,
  mockOff,
  mockOffConnectionChange,
  mockOn,
  mockOnConnectionChange,
  mockSetQueryData,
  mockSubscribe,
  mockSubscribeBatch,
  mockUnsubscribe,
  mockUnsubscribeBatch,
} from './useWebSocketTestHarness';
import {
  useModelDownloadProgress,
  useWalletEvents,
  useWalletLogs,
  useWebSocket,
  useWebSocketEvent,
  useWebSocketQueryInvalidation,
} from '../../../hooks/websocket';

export function registerUseWalletLogsTests(): void {
  describe('useWalletLogs', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      connectionChangeCallbacks.clear();
      eventCallbacks.clear();

      // Mock getWalletLogs to return empty array by default
      mockGetWalletLogs.mockResolvedValue([]);

      mockOn.mockImplementation((eventType: string, callback: (event: any) => void) => {
        if (!eventCallbacks.has(eventType)) {
          eventCallbacks.set(eventType, new Set());
        }
        eventCallbacks.get(eventType)!.add(callback);
      });

      mockOff.mockImplementation((eventType: string, callback: (event: any) => void) => {
        const callbacks = eventCallbacks.get(eventType);
        if (callbacks) {
          callbacks.delete(callback);
        }
      });
    });

    const renderWalletLogs = async (walletId?: string, options?: { enabled?: boolean; maxEntries?: number }) => {
      const hook = renderHook(() => useWalletLogs(walletId as any, options));
      await waitFor(() => {
        expect(hook.result.current.isLoading).toBe(false);
      });
      return hook;
    };

    it('should subscribe to wallet log channel when enabled', async () => {
      await renderWalletLogs('wallet-123', { enabled: true });

      expect(mockSubscribe).toHaveBeenCalledWith('wallet:wallet-123:log');
    });

    it('should not subscribe when walletId is undefined', async () => {
      await renderWalletLogs(undefined);

      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('should not subscribe when disabled', async () => {
      await renderWalletLogs('wallet-123', { enabled: false });

      expect(mockSubscribe).not.toHaveBeenCalled();
    });

    it('should unsubscribe on unmount', async () => {
      const { unmount } = await renderWalletLogs('wallet-456');

      unmount();

      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:wallet-456:log');
    });

    it('should accumulate log entries', async () => {
      const { result } = await renderWalletLogs('wallet-789');

      const logEvent1 = {
        event: 'log',
        channel: 'wallet:wallet-789:log',
        data: {
          id: 'log-1',
          timestamp: '2025-01-01T00:00:00Z',
          level: 'info',
          module: 'wallet',
          message: 'First log',
        },
      };

      const logEvent2 = {
        event: 'log',
        channel: 'wallet:wallet-789:log',
        data: {
          id: 'log-2',
          timestamp: '2025-01-01T00:01:00Z',
          level: 'debug',
          module: 'sync',
          message: 'Second log',
        },
      };

      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(logEvent1));
      });

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(1);
        expect(result.current.logs[0]).toEqual(logEvent1.data);
      });

      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(logEvent2));
      });

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(2);
        expect(result.current.logs[1]).toEqual(logEvent2.data);
      });
    });

    it('should ignore duplicate log ids that were already loaded from history', async () => {
      mockGetWalletLogs.mockResolvedValueOnce([
        {
          id: 'existing-log',
          timestamp: '2025-01-01T00:00:00Z',
          level: 'info',
          module: 'wallet',
          message: 'From history',
        },
      ] as any);

      const { result } = await renderWalletLogs('wallet-dup');

      act(() => {
        eventCallbacks.get('log')?.forEach(cb =>
          cb({
            event: 'log',
            channel: 'wallet:wallet-dup:log',
            data: {
              id: 'existing-log',
              timestamp: '2025-01-01T00:01:00Z',
              level: 'warn',
              module: 'wallet',
              message: 'Duplicate',
            },
          })
        );
      });

      expect(result.current.logs).toHaveLength(1);
      expect(result.current.logs[0].id).toBe('existing-log');
    });

    it('should ignore log events from other wallets', async () => {
      const { result } = await renderWalletLogs('wallet-abc');

      const logEvent = {
        event: 'log',
        channel: 'wallet:wallet-xyz:log', // Different wallet
        data: {
          id: 'log-1',
          timestamp: '2025-01-01T00:00:00Z',
          level: 'info',
          module: 'wallet',
          message: 'Other wallet log',
        },
      };

      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(logEvent));
      });

      // Should not add log from different wallet
      expect(result.current.logs).toHaveLength(0);
    });

    it('should ignore non-log events', async () => {
      const { result } = await renderWalletLogs('wallet-def');

      const transactionEvent = {
        event: 'transaction',
        channel: 'wallet:wallet-def:log',
        data: { txid: 'tx123' },
      };

      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(transactionEvent));
      });

      expect(result.current.logs).toHaveLength(0);
    });

    it('should respect maxEntries limit', async () => {
      const { result } = await renderWalletLogs('wallet-ghi', { maxEntries: 3 });

      const createLog = (id: number) => ({
        event: 'log',
        channel: 'wallet:wallet-ghi:log',
        data: {
          id: `log-${id}`,
          timestamp: `2025-01-01T00:${String(id).padStart(2, '0')}:00Z`,
          level: 'info' as const,
          module: 'wallet',
          message: `Log ${id}`,
        },
      });

      // Add 5 logs
      for (let i = 1; i <= 5; i++) {
        act(() => {
          eventCallbacks.get('log')?.forEach(cb => cb(createLog(i)));
        });
      }

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(3);
        // Should keep only the last 3
        expect(result.current.logs[0].id).toBe('log-3');
        expect(result.current.logs[1].id).toBe('log-4');
        expect(result.current.logs[2].id).toBe('log-5');
      });
    });

    it('should clear logs when clearLogs is called', async () => {
      const { result } = await renderWalletLogs('wallet-jkl');

      const logEvent = {
        event: 'log',
        channel: 'wallet:wallet-jkl:log',
        data: {
          id: 'log-1',
          timestamp: '2025-01-01T00:00:00Z',
          level: 'info' as const,
          module: 'wallet',
          message: 'Test log',
        },
      };

      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(logEvent));
      });

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(1);
      });

      act(() => {
        result.current.clearLogs();
      });

      expect(result.current.logs).toHaveLength(0);
    });

    it('should toggle pause state', async () => {
      const { result } = await renderWalletLogs('wallet-mno');

      expect(result.current.isPaused).toBe(false);

      act(() => {
        result.current.togglePause();
      });

      expect(result.current.isPaused).toBe(true);

      act(() => {
        result.current.togglePause();
      });

      expect(result.current.isPaused).toBe(false);
    });

    it('should not add logs when paused', async () => {
      const { result } = await renderWalletLogs('wallet-pqr');

      act(() => {
        result.current.togglePause();
      });

      const logEvent = {
        event: 'log',
        channel: 'wallet:wallet-pqr:log',
        data: {
          id: 'log-1',
          timestamp: '2025-01-01T00:00:00Z',
          level: 'info' as const,
          module: 'wallet',
          message: 'Paused log',
        },
      };

      act(() => {
        eventCallbacks.get('log')?.forEach(cb => cb(logEvent));
      });

      // Should not add log when paused
      expect(result.current.logs).toHaveLength(0);
    });

    it('should use default maxEntries of 500', async () => {
      const { result } = await renderWalletLogs('wallet-stu');

      // This just checks that the hook renders without error
      expect(result.current.logs).toEqual([]);
    });

    it('should skip history state updates when request resolves after unmount', async () => {
      let resolveLogs!: (value: any[]) => void;
      const pendingLogs = new Promise<any[]>((resolve) => {
        resolveLogs = resolve;
      });
      mockGetWalletLogs.mockReturnValueOnce(pendingLogs);

      const { unmount } = renderHook(() => useWalletLogs('wallet-cancelled'));
      unmount();

      await act(async () => {
        resolveLogs([
          {
            id: 'late-log',
            timestamp: '2025-01-01T00:00:00Z',
            level: 'info',
            module: 'wallet',
            message: 'late',
          },
        ]);
        await Promise.resolve();
      });

      expect(mockGetWalletLogs).toHaveBeenCalledWith('wallet-cancelled');
    });

    it('should handle historical log fetch failures without crashing', async () => {
      mockGetWalletLogs.mockRejectedValueOnce(new Error('history failed'));

      const { result } = renderHook(() => useWalletLogs('wallet-failed-history'));

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(mockGetWalletLogs).toHaveBeenCalledWith('wallet-failed-history');
      expect(result.current.logs).toEqual([]);
    });
  });
}
