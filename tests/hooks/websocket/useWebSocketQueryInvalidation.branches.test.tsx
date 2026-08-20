import { act,renderHook } from '@testing-library/react';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import { useWebSocketQueryInvalidation } from '../../../src/hooks/websocket/useWebSocketQueryInvalidation';

const mockState = vi.hoisted(() => {
  const listeners = new Map<string, Set<(event: any) => void>>();

  const on = vi.fn((eventType: string, callback: (event: any) => void) => {
    if (!listeners.has(eventType)) {
      listeners.set(eventType, new Set());
    }
    listeners.get(eventType)!.add(callback);
  });

  const off = vi.fn((eventType: string, callback: (event: any) => void) => {
    listeners.get(eventType)?.delete(callback);
  });

  return {
    listeners,
    on,
    off,
    subscribeBatch: vi.fn(),
    unsubscribeBatch: vi.fn(),
    invalidateQueries: vi.fn(),
    setQueryData: vi.fn(),
    queryClientValue: null as any,
  };
});

vi.mock('../../../src/hooks/websocket/useWebSocket', () => ({
  useWebSocket: () => ({
    connected: true,
    subscribeBatch: mockState.subscribeBatch,
    unsubscribeBatch: mockState.unsubscribeBatch,
  }),
}));

vi.mock('../../../src/services/websocket', () => ({
  websocketClient: {
    on: (...args: unknown[]) => mockState.on(...args as [string, (event: any) => void]),
    off: (...args: unknown[]) => mockState.off(...args as [string, (event: any) => void]),
  },
}));

vi.mock('../../../src/providers/QueryProvider', () => ({
  getQueryClient: () => mockState.queryClientValue,
}));

const emit = (eventType: string, event: any) => {
  mockState.listeners.get(eventType)?.forEach(callback => callback(event));
};

const getUpdater = (queryKey: unknown[]) => {
  const call = mockState.setQueryData.mock.calls.find(([key]) => (
    Array.isArray(key) &&
    key.length === queryKey.length &&
    queryKey.every((part, idx) => key[idx] === part)
  ));
  return call?.[1] as ((data: any) => any) | undefined;
};

describe('useWebSocketQueryInvalidation branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.listeners.clear();
    mockState.queryClientValue = {
      invalidateQueries: mockState.invalidateQueries,
      setQueryData: mockState.setQueryData,
    };
  });

  it('covers null query client guard branches for all event handlers', () => {
    mockState.queryClientValue = null;

    renderHook(() => useWebSocketQueryInvalidation());

    act(() => {
      emit('transaction', { event: 'transaction', data: { txid: 'tx-1' } });
      emit('newBlock', { event: 'newBlock', data: { height: 900001 } });
      emit('sync', { event: 'sync', data: { walletId: 'wallet-1', inProgress: true } });
    });

    expect(mockState.invalidateQueries).not.toHaveBeenCalled();
    expect(mockState.setQueryData).not.toHaveBeenCalled();
  });

  it('covers sync cache updater branches for undefined data and status/inProgress combinations', () => {
    renderHook(() => useWebSocketQueryInvalidation());

    act(() => {
      emit('sync', {
        event: 'sync',
        data: {
          walletId: 'wallet-1',
          inProgress: true,
        },
      });
    });

    const listUpdater = getUpdater(['wallets', 'list']);
    const detailUpdater = getUpdater(['wallets', 'detail', 'wallet-1']);
    expect(listUpdater).toBeDefined();
    expect(detailUpdater).toBeDefined();

    expect(listUpdater?.(undefined)).toBeUndefined();
    expect(detailUpdater?.(undefined)).toBeUndefined();

    const listInProgress = listUpdater?.([
      { id: 'wallet-1', syncInProgress: false },
      { id: 'wallet-2', syncInProgress: false },
    ]);
    expect(listInProgress[0].syncInProgress).toBe(true);
    expect(listInProgress[0].lastSyncStatus).toBeUndefined();
    expect(listInProgress[0].lastSyncedAt).toBeUndefined();

    const detailInProgress = detailUpdater?.({ id: 'wallet-1', syncInProgress: false });
    expect(detailInProgress.syncInProgress).toBe(true);
    expect(detailInProgress.lastSyncStatus).toBeUndefined();
    expect(detailInProgress.lastSyncedAt).toBeUndefined();

    mockState.setQueryData.mockClear();

    act(() => {
      emit('sync', {
        event: 'sync',
        data: {
          walletId: 'wallet-1',
          inProgress: false,
          status: 'success',
        },
      });
    });

    const listUpdaterComplete = getUpdater(['wallets', 'list']);
    const detailUpdaterComplete = getUpdater(['wallets', 'detail', 'wallet-1']);
    const listComplete = listUpdaterComplete?.([{ id: 'wallet-1', syncInProgress: true }]);
    const detailComplete = detailUpdaterComplete?.({ id: 'wallet-1', syncInProgress: true });

    expect(listComplete[0].syncInProgress).toBe(false);
    expect(listComplete[0].lastSyncStatus).toBe('success');
    expect(typeof listComplete[0].lastSyncedAt).toBe('string');

    expect(detailComplete.syncInProgress).toBe(false);
    expect(detailComplete.lastSyncStatus).toBe('success');
    expect(typeof detailComplete.lastSyncedAt).toBe('string');
  });

  it('does not stamp a fresh sync time onto a wallet whose sync just failed', () => {
    renderHook(() => useWebSocketQueryInvalidation());

    act(() => {
      emit('sync', {
        event: 'sync',
        data: { walletId: 'wallet-1', inProgress: false, status: 'failed' },
      });
    });

    const listFailed = getUpdater(['wallets', 'list'])?.([
      { id: 'wallet-1', syncInProgress: true, lastSyncedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const detailFailed = getUpdater(['wallets', 'detail', 'wallet-1'])?.({
      id: 'wallet-1',
      syncInProgress: true,
      lastSyncedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(listFailed[0].lastSyncStatus).toBe('failed');
    expect(listFailed[0].lastSyncedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(detailFailed.lastSyncedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('prefers a server-supplied sync time over the client clock', () => {
    renderHook(() => useWebSocketQueryInvalidation());

    act(() => {
      emit('sync', {
        event: 'sync',
        data: {
          walletId: 'wallet-1',
          inProgress: false,
          status: 'success',
          lastSyncedAt: '2026-08-19T10:00:00.000Z',
        },
      });
    });

    const listUpdated = getUpdater(['wallets', 'list'])?.([
      { id: 'wallet-1', syncInProgress: true },
    ]);

    expect(listUpdated[0].lastSyncedAt).toBe('2026-08-19T10:00:00.000Z');
  });
});
