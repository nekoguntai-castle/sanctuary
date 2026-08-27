import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionChangeCallbacks,
  eventCallbacks,
  mockGetWalletLogs,
  mockOff,
  mockOn,
  mockSubscribe,
  mockUnsubscribe,
} from './useWebSocketTestHarness';
import {
  useWalletLogs,
} from '../../../src/hooks/websocket';

const resetUseWalletLogsHarness = (): void => {
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
};

const renderWalletLogs = async (walletId?: string, options?: { enabled?: boolean; maxEntries?: number }) => {
  const hook = renderHook(() => useWalletLogs(walletId as any, options));
  await waitFor(() => {
    expect(hook.result.current.isLoading).toBe(false);
  });
  return hook;
};

const emitWalletLogEvent = (event: unknown): void => {
  act(() => {
    eventCallbacks.get('log')?.forEach(cb => cb(event));
  });
};

const walletLogEvent = (
  walletId: string,
  id: string,
  timestamp = '2025-01-01T00:00:00Z',
) => ({
  event: 'log',
  channel: `wallet:${walletId}:log`,
  data: {
    id,
    timestamp,
    level: 'info' as const,
    module: 'sync',
    message: id,
  },
});

const deferredLogs = () => {
  let resolve!: (value: any[]) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<any[]>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

const registerWalletLogSubscriptionTests = (): void => {
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
};

const registerWalletLogEventTests = (): void => {
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

      emitWalletLogEvent(logEvent1);

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(1);
        expect(result.current.logs[0]).toEqual(logEvent1.data);
      });

      emitWalletLogEvent(logEvent2);

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

      emitWalletLogEvent(logEvent);

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

      emitWalletLogEvent(transactionEvent);

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
        emitWalletLogEvent(createLog(i));
      }

      await waitFor(() => {
        expect(result.current.logs).toHaveLength(3);
        // Should keep only the last 3
        expect(result.current.logs[0].id).toBe('log-3');
        expect(result.current.logs[1].id).toBe('log-4');
        expect(result.current.logs[2].id).toBe('log-5');
      });
    });
};

const registerWalletLogStateTests = (): void => {
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

      emitWalletLogEvent(logEvent);

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
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
      expect(mockUnsubscribe).not.toHaveBeenCalled();
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

      emitWalletLogEvent(logEvent);

      // Should not add log when paused
      expect(result.current.logs).toHaveLength(0);
    });

    it('should use default maxEntries of 500', async () => {
      const { result } = await renderWalletLogs('wallet-stu');

      // This just checks that the hook renders without error
      expect(result.current.logs).toEqual([]);
    });
};

const registerWalletLogHistoryTests = (): void => {
    it('retains a live entry when later empty history resolves', async () => {
      const history = deferredLogs();
      mockGetWalletLogs.mockReturnValueOnce(history.promise);
      const { result } = renderHook(() => useWalletLogs('wallet-live-first'));

      emitWalletLogEvent(walletLogEvent('wallet-live-first', 'live'));
      expect(result.current.logs.map(entry => entry.id)).toEqual(['live']);

      await act(async () => {
        history.resolve([]);
        await history.promise;
      });

      expect(result.current.logs.map(entry => entry.id)).toEqual(['live']);
      expect(result.current.isLoading).toBe(false);
    });

    it('merges overlapping history without replacing the live duplicate', async () => {
      const history = deferredLogs();
      mockGetWalletLogs.mockReturnValueOnce(history.promise);
      const { result } = renderHook(() => useWalletLogs('wallet-overlap'));
      const live = walletLogEvent(
        'wallet-overlap',
        'shared',
        '2025-01-01T00:02:00Z',
      );
      emitWalletLogEvent(live);

      await act(async () => {
        history.resolve([
          walletLogEvent('wallet-overlap', 'history', '2025-01-01T00:01:00Z').data,
          { ...live.data, message: 'stale history duplicate' },
        ]);
        await history.promise;
      });

      expect(result.current.logs.map(entry => entry.id)).toEqual(['history', 'shared']);
      expect(result.current.logs[1].message).toBe('shared');
    });

    it('does not let pending history undo a clear', async () => {
      const history = deferredLogs();
      mockGetWalletLogs.mockReturnValueOnce(history.promise);
      const { result } = renderHook(() => useWalletLogs('wallet-cleared'));

      act(() => result.current.clearLogs());
      await act(async () => {
        history.resolve([walletLogEvent('wallet-cleared', 'late').data]);
        await history.promise;
      });

      expect(result.current.logs).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it('resets wallet-owned state on an identity change while disabled', async () => {
      const renderedLogIds: string[][] = [];
      const { result, rerender } = renderHook(
        ({ walletId, enabled }) => {
          const value = useWalletLogs(walletId, { enabled });
          renderedLogIds.push(value.logs.map(entry => entry.id));
          return value;
        },
        { initialProps: { walletId: 'wallet-a', enabled: true } },
      );
      await waitFor(() => expect(result.current.isLoading).toBe(false));
      emitWalletLogEvent(walletLogEvent('wallet-a', 'wallet-a-log'));
      expect(result.current.logs).toHaveLength(1);

      const renderCountBeforeSwitch = renderedLogIds.length;
      rerender({ walletId: 'wallet-b', enabled: false });

      expect(result.current.logs).toEqual([]);
      expect(renderedLogIds.slice(renderCountBeforeSwitch)).not.toContainEqual(['wallet-a-log']);
      expect(mockGetWalletLogs).toHaveBeenCalledTimes(1);
      expect(mockSubscribe).toHaveBeenCalledTimes(1);
    });

    it('ignores rejection from an earlier wallet session', async () => {
      const staleHistory = deferredLogs();
      mockGetWalletLogs
        .mockReturnValueOnce(staleHistory.promise)
        .mockResolvedValueOnce([walletLogEvent('wallet-b', 'wallet-b-log').data]);
      const { result, rerender } = renderHook(
        ({ walletId }) => useWalletLogs(walletId),
        { initialProps: { walletId: 'wallet-a' } },
      );

      rerender({ walletId: 'wallet-b' });
      await waitFor(() => {
        expect(result.current.logs.map(entry => entry.id)).toEqual(['wallet-b-log']);
      });
      await act(async () => {
        staleHistory.reject(new Error('late wallet-a failure'));
        await staleHistory.promise.catch(() => undefined);
      });

      expect(result.current.logs.map(entry => entry.id)).toEqual(['wallet-b-log']);
      expect(result.current.isLoading).toBe(false);
    });

    it('ignores successful history from an earlier enabled wallet session', async () => {
      const staleHistory = deferredLogs();
      mockGetWalletLogs
        .mockReturnValueOnce(staleHistory.promise)
        .mockResolvedValueOnce([walletLogEvent('wallet-b', 'wallet-b-log').data]);
      const { result, rerender } = renderHook(
        ({ walletId }) => useWalletLogs(walletId),
        { initialProps: { walletId: 'wallet-a' } },
      );

      rerender({ walletId: 'wallet-b' });
      await waitFor(() => {
        expect(result.current.logs.map(entry => entry.id)).toEqual(['wallet-b-log']);
      });
      await act(async () => {
        staleHistory.resolve([walletLogEvent('wallet-a', 'stale-wallet-a-log').data]);
        await staleHistory.promise;
      });

      expect(result.current.logs.map(entry => entry.id)).toEqual(['wallet-b-log']);
      expect(result.current.isLoading).toBe(false);
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
};

const registerWalletLogCapTests = (): void => {
    it.each([
      ['negative', -1, 500],
      ['fraction', 2.9, 2],
      ['NaN', Number.NaN, 500],
      ['Infinity', Number.POSITIVE_INFINITY, 500],
      ['zero', 0, 0],
      ['one', 1, 1],
      ['over 500', 501, 500],
    ])('applies the normalized %s cap to list and seen ids', async (_label, cap, expected) => {
      const { result } = await renderWalletLogs('wallet-cap', { maxEntries: cap });
      const count = expected >= 500 ? 501 : 4;
      for (let index = 0; index < count; index += 1) {
        emitWalletLogEvent(walletLogEvent(
          'wallet-cap',
          `log-${index}`,
          new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
        ));
      }

      expect(result.current.logs).toHaveLength(expected);
    });

    it('allows an id evicted by the cap to be accepted again', async () => {
      const { result } = await renderWalletLogs('wallet-seen-cap', { maxEntries: 1 });
      emitWalletLogEvent(walletLogEvent('wallet-seen-cap', 'first', '2025-01-01T00:00:00Z'));
      emitWalletLogEvent(walletLogEvent('wallet-seen-cap', 'second', '2025-01-01T00:01:00Z'));
      emitWalletLogEvent(walletLogEvent('wallet-seen-cap', 'first', '2025-01-01T00:02:00Z'));

      expect(result.current.logs.map(entry => entry.id)).toEqual(['first']);
      expect(result.current.logs[0].timestamp).toBe('2025-01-01T00:02:00Z');
    });
};

export function registerUseWalletLogsTests(): void {
  describe('useWalletLogs', () => {
    beforeEach(resetUseWalletLogsHarness);

    registerWalletLogSubscriptionTests();
    registerWalletLogEventTests();
    registerWalletLogStateTests();
    registerWalletLogHistoryTests();
    registerWalletLogCapTests();
  });
}
