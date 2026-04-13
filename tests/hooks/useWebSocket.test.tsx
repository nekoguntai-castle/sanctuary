/**
 * useWebSocket Hook Tests
 *
 * Tests for WebSocket hooks that manage real-time connections and subscriptions.
 * Covers connection lifecycle, authentication, subscription management, and event handling.
 */

import { act,renderHook,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Store connection change callbacks for testing
let connectionChangeCallbacks: Set<(connected: boolean) => void> = new Set();
let eventCallbacks: Map<string, Set<(event: any) => void>> = new Map();

// Mock the WebSocket client
const mockConnect = vi.fn();
const mockDisconnect = vi.fn();
const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockSubscribeBatch = vi.fn();
const mockUnsubscribeBatch = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();
const mockIsConnected = vi.fn();
const mockGetState = vi.fn();
const mockOnConnectionChange = vi.fn();
const mockOffConnectionChange = vi.fn();

vi.mock('../../services/websocket', () => ({
  websocketClient: {
    connect: (...args: any[]) => mockConnect(...args),
    disconnect: (...args: any[]) => mockDisconnect(...args),
    subscribe: (...args: any[]) => mockSubscribe(...args),
    unsubscribe: (...args: any[]) => mockUnsubscribe(...args),
    subscribeBatch: (...args: any[]) => mockSubscribeBatch(...args),
    unsubscribeBatch: (...args: any[]) => mockUnsubscribeBatch(...args),
    on: (...args: any[]) => mockOn(...args),
    off: (...args: any[]) => mockOff(...args),
    isConnected: (...args: any[]) => mockIsConnected(...args),
    getState: (...args: any[]) => mockGetState(...args),
    onConnectionChange: (...args: any[]) => mockOnConnectionChange(...args),
    offConnectionChange: (...args: any[]) => mockOffConnectionChange(...args),
  },
  WebSocketEvent: {},
  WebSocketEventType: {},
}));

// Phase 4: useWebSocket no longer reads a token from apiClient — the
// browser's sanctuary_access HttpOnly cookie is attached automatically
// by the same-origin WebSocket upgrade, and the server's extractToken
// in websocket/auth.ts (Phase 3) reads it from the upgrade request.
// No apiClient mock needed for the hook.

// Mock the sync API to avoid actual API calls in useWalletLogs
const mockGetWalletLogs = vi.fn();

vi.mock('../../src/api/sync', () => ({
  getWalletLogs: (...args: any[]) => mockGetWalletLogs(...args),
}));

// Mock queryClient for useWebSocketQueryInvalidation tests
// Use vi.hoisted to ensure these are available when vi.mock factories run
const { mockInvalidateQueries, mockSetQueryData, mockQueryClient } = vi.hoisted(() => {
  const mockInvalidateQueries = vi.fn();
  const mockSetQueryData = vi.fn();
  const mockQueryClient = {
    invalidateQueries: (...args: any[]) => mockInvalidateQueries(...args),
    setQueryData: (...args: any[]) => mockSetQueryData(...args),
  };
  return { mockInvalidateQueries, mockSetQueryData, mockQueryClient };
});

// Mock with path relative to the test file
vi.mock('../../providers/QueryProvider', () => ({
  queryClient: mockQueryClient,
  getQueryClient: () => mockQueryClient,
}));

// Helper to flush pending promises (for React state updates)
// Uses microtask queueing which is more reliable than setTimeout
const flushPromises = () => new Promise<void>(resolve => queueMicrotask(resolve));

// Import hooks after mocks
import {
useModelDownloadProgress,
useWalletEvents,
useWalletLogs,
useWebSocket,
useWebSocketEvent,
useWebSocketQueryInvalidation,
} from '../../hooks/websocket';

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    // Default mock implementations
    mockIsConnected.mockReturnValue(false);
    mockGetState.mockReturnValue('disconnected');

    // Store callbacks when registered
    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

    mockOffConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.delete(callback);
    });

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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Connection Lifecycle', () => {
    it('should connect on mount when not already connected (no token arg — Phase 4 cookie auth)', () => {
      mockIsConnected.mockReturnValue(false);

      renderHook(() => useWebSocket());

      expect(mockOnConnectionChange).toHaveBeenCalledTimes(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      // Phase 3-4: same-origin WS upgrades carry the sanctuary_access
      // HttpOnly cookie automatically, so the frontend no longer passes
      // a token to connect(). The server's extractToken reads the cookie
      // off the upgrade request.
      expect(mockConnect).toHaveBeenCalledWith();
    });

    it('should not connect if already connected', () => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      const { result } = renderHook(() => useWebSocket());

      expect(mockConnect).not.toHaveBeenCalled();
      expect(result.current.connected).toBe(true);
      expect(result.current.state).toBe('connected');
    });

    it('should disconnect on unmount', () => {
      mockIsConnected.mockReturnValue(false);

      const { unmount } = renderHook(() => useWebSocket());

      unmount();

      expect(mockOffConnectionChange).toHaveBeenCalledTimes(1);
    });

    it('should update connected state on connection change', async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(false);
      expect(result.current.state).toBe('disconnected');

      // Simulate connection
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      act(() => {
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
        expect(result.current.state).toBe('connected');
      });
    });

    it('should update connected state on disconnection', async () => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(true);

      // Simulate disconnection
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      act(() => {
        connectionChangeCallbacks.forEach(cb => cb(false));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(false);
        expect(result.current.state).toBe('disconnected');
      });
    });

    it('should handle reconnection', async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      // First connection
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
      });

      // Disconnect
      act(() => {
        mockIsConnected.mockReturnValue(false);
        mockGetState.mockReturnValue('disconnected');
        connectionChangeCallbacks.forEach(cb => cb(false));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(false);
      });

      // Reconnect
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(result.current.connected).toBe(true);
        expect(result.current.state).toBe('connected');
      });
    });

    it('should update state periodically via interval', async () => {
      vi.useFakeTimers();

      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.state).toBe('disconnected');

      // Change state
      mockGetState.mockReturnValue('connecting');

      // Fast-forward 1 second (interval period)
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.state).toBe('connecting');

      vi.useRealTimers();
    });

    it('should clear interval on unmount', () => {
      vi.useFakeTimers();
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      const { unmount } = renderHook(() => useWebSocket());

      unmount();

      expect(clearIntervalSpy).toHaveBeenCalled();

      vi.useRealTimers();
    });
  });

  describe('Subscription Management', () => {
    it('should subscribe to a channel', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.subscribe('wallet:123');
      });

      expect(mockSubscribe).toHaveBeenCalledWith('wallet:123');
    });

    it('should unsubscribe from a channel', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.unsubscribe('wallet:123');
      });

      expect(mockUnsubscribe).toHaveBeenCalledWith('wallet:123');
    });

    it('should subscribe to all wallet channels', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.subscribeWallet('wallet-abc');
      });

      expect(mockSubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-abc',
        'wallet:wallet-abc:transaction',
        'wallet:wallet-abc:balance',
        'wallet:wallet-abc:confirmation',
        'wallet:wallet-abc:sync',
      ]);
      expect(mockSubscribeBatch).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from all wallet channels', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.unsubscribeWallet('wallet-xyz');
      });

      expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-xyz',
        'wallet:wallet-xyz:transaction',
        'wallet:wallet-xyz:balance',
        'wallet:wallet-xyz:confirmation',
        'wallet:wallet-xyz:sync',
      ]);
      expect(mockUnsubscribeBatch).toHaveBeenCalledTimes(1);
    });

    it('should batch subscribe channels for multiple wallets', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.subscribeWallets(['wallet-a', 'wallet-b']);
      });

      expect(mockSubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-a',
        'wallet:wallet-a:transaction',
        'wallet:wallet-a:balance',
        'wallet:wallet-a:confirmation',
        'wallet:wallet-a:sync',
        'wallet:wallet-b',
        'wallet:wallet-b:transaction',
        'wallet:wallet-b:balance',
        'wallet:wallet-b:confirmation',
        'wallet:wallet-b:sync',
      ]);
    });

    it('should batch unsubscribe channels for multiple wallets', () => {
      const { result } = renderHook(() => useWebSocket());

      act(() => {
        result.current.unsubscribeWallets(['wallet-a', 'wallet-b']);
      });

      expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
        'wallet:wallet-a',
        'wallet:wallet-a:transaction',
        'wallet:wallet-a:balance',
        'wallet:wallet-a:confirmation',
        'wallet:wallet-a:sync',
        'wallet:wallet-b',
        'wallet:wallet-b:transaction',
        'wallet:wallet-b:balance',
        'wallet:wallet-b:confirmation',
        'wallet:wallet-b:sync',
      ]);
    });

    it('should maintain stable subscribe callback reference', () => {
      const { result, rerender } = renderHook(() => useWebSocket());

      const firstSubscribe = result.current.subscribe;

      rerender();

      const secondSubscribe = result.current.subscribe;

      expect(firstSubscribe).toBe(secondSubscribe);
    });

    it('should maintain stable unsubscribe callback reference', () => {
      const { result, rerender } = renderHook(() => useWebSocket());

      const firstUnsubscribe = result.current.unsubscribe;

      rerender();

      const secondUnsubscribe = result.current.unsubscribe;

      expect(firstUnsubscribe).toBe(secondUnsubscribe);
    });
  });

  describe('State Management', () => {
    it('should return initial disconnected state', () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(false);
      expect(result.current.state).toBe('disconnected');
    });

    it('should return connecting state', () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('connecting');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(false);
      expect(result.current.state).toBe('connecting');
    });

    it('should return connected state', () => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');

      const { result } = renderHook(() => useWebSocket());

      expect(result.current.connected).toBe(true);
      expect(result.current.state).toBe('connected');
    });
  });
});

describe('useWebSocketEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCallbacks.clear();

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

  it('should register event listener on mount', () => {
    const callback = vi.fn();

    renderHook(() => useWebSocketEvent('transaction', callback));

    expect(mockOn).toHaveBeenCalledWith('transaction', callback);
  });

  it('should unregister event listener on unmount', () => {
    const callback = vi.fn();

    const { unmount } = renderHook(() => useWebSocketEvent('balance', callback));

    unmount();

    expect(mockOff).toHaveBeenCalledWith('balance', callback);
  });

  it('should handle wildcard event type', () => {
    const callback = vi.fn();

    renderHook(() => useWebSocketEvent('*', callback));

    expect(mockOn).toHaveBeenCalledWith('*', callback);
  });

  it('should re-register when event type changes', () => {
    const callback = vi.fn();

    const { rerender } = renderHook<void, { eventType: 'transaction' | 'balance' | 'sync' }>(
      ({ eventType }) => useWebSocketEvent(eventType, callback),
      { initialProps: { eventType: 'transaction' } }
    );

    expect(mockOn).toHaveBeenCalledWith('transaction', callback);

    rerender({ eventType: 'balance' });

    expect(mockOff).toHaveBeenCalledWith('transaction', callback);
    expect(mockOn).toHaveBeenCalledWith('balance', callback);
  });

  it('should re-register when deps change', () => {
    const callback = vi.fn();

    const { rerender } = renderHook(
      ({ deps }) => useWebSocketEvent('sync', callback, deps),
      { initialProps: { deps: ['value1'] } }
    );

    expect(mockOn).toHaveBeenCalledWith('sync', callback);
    const firstCallCount = mockOn.mock.calls.length;

    // Change deps should trigger re-registration
    rerender({ deps: ['value2'] });

    expect(mockOff).toHaveBeenCalledWith('sync', callback);
    expect(mockOn).toHaveBeenCalledTimes(firstCallCount + 1);
    expect(mockOn).toHaveBeenCalledWith('sync', callback);
  });
});

describe('useWalletEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    mockIsConnected.mockReturnValue(true);
    mockGetState.mockReturnValue('connected');

    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

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

  it('should subscribe to wallet on mount', () => {
    const callbacks = {
      onTransaction: vi.fn(),
      onBalance: vi.fn(),
    };

    renderHook(() => useWalletEvents('wallet-123', callbacks));

    expect(mockSubscribeBatch).toHaveBeenCalledWith([
      'wallet:wallet-123',
      'wallet:wallet-123:transaction',
      'wallet:wallet-123:balance',
      'wallet:wallet-123:confirmation',
      'wallet:wallet-123:sync',
    ]);
  });

  it('should unsubscribe from wallet on unmount', () => {
    const callbacks = {
      onTransaction: vi.fn(),
    };

    const { unmount } = renderHook(() => useWalletEvents('wallet-456', callbacks));

    unmount();

    expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
      'wallet:wallet-456',
      'wallet:wallet-456:transaction',
      'wallet:wallet-456:balance',
      'wallet:wallet-456:confirmation',
      'wallet:wallet-456:sync',
    ]);
  });

  it('should not subscribe when walletId is undefined', () => {
    const callbacks = {
      onTransaction: vi.fn(),
    };

    renderHook(() => useWalletEvents(undefined, callbacks));

    expect(mockSubscribeBatch).not.toHaveBeenCalled();
  });

  it('should call onTransaction callback when transaction event is received', async () => {
    const onTransaction = vi.fn();
    const callbacks = { onTransaction };

    renderHook(() => useWalletEvents('wallet-789', callbacks));

    const transactionEvent = {
      event: 'transaction',
      data: { txid: 'tx123', amount: 1000 },
    };

    act(() => {
      eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
    });

    await waitFor(() => {
      expect(onTransaction).toHaveBeenCalledWith(transactionEvent.data);
    });
  });

  it('should call onBalance callback when balance event is received', async () => {
    const onBalance = vi.fn();
    const callbacks = { onBalance };

    renderHook(() => useWalletEvents('wallet-abc', callbacks));

    const balanceEvent = {
      event: 'balance',
      data: { balance: 5000, confirmed: 5000 },
    };

    act(() => {
      eventCallbacks.get('balance')?.forEach(cb => cb(balanceEvent));
    });

    await waitFor(() => {
      expect(onBalance).toHaveBeenCalledWith(balanceEvent.data);
    });
  });

  it('should call onConfirmation callback when confirmation event is received', async () => {
    const onConfirmation = vi.fn();
    const callbacks = { onConfirmation };

    renderHook(() => useWalletEvents('wallet-def', callbacks));

    const confirmationEvent = {
      event: 'confirmation',
      data: { txid: 'tx456', confirmations: 3 },
    };

    act(() => {
      eventCallbacks.get('confirmation')?.forEach(cb => cb(confirmationEvent));
    });

    await waitFor(() => {
      expect(onConfirmation).toHaveBeenCalledWith(confirmationEvent.data);
    });
  });

  it('should call onSync callback when sync event is received', async () => {
    const onSync = vi.fn();
    const callbacks = { onSync };

    renderHook(() => useWalletEvents('wallet-ghi', callbacks));

    const syncEvent = {
      event: 'sync',
      data: { progress: 0.75, status: 'syncing' },
    };

    act(() => {
      eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
    });

    await waitFor(() => {
      expect(onSync).toHaveBeenCalledWith(syncEvent.data);
    });
  });

  it('should ignore sync events when onSync callback is missing', async () => {
    const onTransaction = vi.fn();
    const callbacks = { onTransaction };

    renderHook(() => useWalletEvents('wallet-no-sync', callbacks));

    const syncEvent = {
      event: 'sync',
      data: { progress: 0.25, status: 'syncing' },
    };

    act(() => {
      eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
    });

    await waitFor(() => {
      expect(onTransaction).not.toHaveBeenCalled();
    });
  });

  it('should use latest callbacks without resubscribing', async () => {
    const onTransaction1 = vi.fn();
    const onTransaction2 = vi.fn();

    const { rerender } = renderHook(
      ({ callbacks }) => useWalletEvents('wallet-jkl', callbacks),
      { initialProps: { callbacks: { onTransaction: onTransaction1 } } }
    );

    // Clear subscribe calls from initial mount
    mockSubscribeBatch.mockClear();

    // Update callbacks
    rerender({ callbacks: { onTransaction: onTransaction2 } });

    // Should not resubscribe
    expect(mockSubscribeBatch).not.toHaveBeenCalled();

    const transactionEvent = {
      event: 'transaction',
      data: { txid: 'tx789' },
    };

    act(() => {
      eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
    });

    // Should use new callback
    await waitFor(() => {
      expect(onTransaction1).not.toHaveBeenCalled();
      expect(onTransaction2).toHaveBeenCalledWith(transactionEvent.data);
    });
  });

  it('should resubscribe when walletId changes', () => {
    const callbacks = { onTransaction: vi.fn() };

    const { rerender } = renderHook(
      ({ walletId }) => useWalletEvents(walletId, callbacks),
      { initialProps: { walletId: 'wallet-old' } }
    );

    mockSubscribeBatch.mockClear();
    mockUnsubscribeBatch.mockClear();

    rerender({ walletId: 'wallet-new' });

    // Should unsubscribe from old wallet (batch)
    expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
      'wallet:wallet-old',
      'wallet:wallet-old:transaction',
      'wallet:wallet-old:balance',
      'wallet:wallet-old:confirmation',
      'wallet:wallet-old:sync',
    ]);

    // Should subscribe to new wallet (batch)
    expect(mockSubscribeBatch).toHaveBeenCalledWith([
      'wallet:wallet-new',
      'wallet:wallet-new:transaction',
      'wallet:wallet-new:balance',
      'wallet:wallet-new:confirmation',
      'wallet:wallet-new:sync',
    ]);
  });
});

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

describe('useModelDownloadProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    mockIsConnected.mockReturnValue(true);
    mockGetState.mockReturnValue('connected');

    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

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

  it('should subscribe to system channel when connected', () => {
    mockIsConnected.mockReturnValue(true);

    renderHook(() => useModelDownloadProgress());

    expect(mockSubscribe).toHaveBeenCalledWith('system');
  });

  it('should not subscribe when disconnected', () => {
    mockIsConnected.mockReturnValue(false);

    renderHook(() => useModelDownloadProgress());

    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('should unsubscribe from system channel on unmount', () => {
    mockIsConnected.mockReturnValue(true);

    const { unmount } = renderHook(() => useModelDownloadProgress());

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledWith('system');
  });

  it('should receive modelDownload events and update progress', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const progressEvent = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:1b',
        status: 'downloading' as const,
        completed: 50000000,
        total: 100000000,
        percent: 50,
        digest: 'sha256:abc123',
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(progressEvent));
    });

    await waitFor(() => {
      expect(result.current.progress).toEqual(progressEvent.data);
    });
  });

  it('should call onProgress callback when provided', async () => {
    mockIsConnected.mockReturnValue(true);

    const onProgress = vi.fn();
    renderHook(() => useModelDownloadProgress(onProgress));

    const progressEvent = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:3b',
        status: 'pulling' as const,
        completed: 0,
        total: 200000000,
        percent: 0,
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(progressEvent));
    });

    await waitFor(() => {
      expect(onProgress).toHaveBeenCalledWith(progressEvent.data);
    });
  });

  it('should ignore non-modelDownload events', async () => {
    mockIsConnected.mockReturnValue(true);

    const onProgress = vi.fn();
    const { result } = renderHook(() => useModelDownloadProgress(onProgress));

    const transactionEvent = {
      event: 'transaction',
      data: { txid: 'tx123' },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(transactionEvent));
    });

    // Should not update progress or call callback
    expect(result.current.progress).toBeNull();
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('should handle events for different models', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const model1Event = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:1b',
        status: 'downloading' as const,
        completed: 25000000,
        total: 100000000,
        percent: 25,
      },
    };

    const model2Event = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:3b',
        status: 'complete' as const,
        completed: 200000000,
        total: 200000000,
        percent: 100,
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(model1Event));
    });

    await waitFor(() => {
      expect(result.current.progress?.model).toBe('llama3.2:1b');
    });

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(model2Event));
    });

    await waitFor(() => {
      expect(result.current.progress?.model).toBe('llama3.2:3b');
      expect(result.current.progress?.status).toBe('complete');
    });
  });

  it('should handle error status', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const errorEvent = {
      event: 'modelDownload',
      data: {
        model: 'invalid-model',
        status: 'error' as const,
        completed: 0,
        total: 0,
        percent: 0,
        error: 'Model not found',
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(errorEvent));
    });

    await waitFor(() => {
      expect(result.current.progress?.status).toBe('error');
      expect(result.current.progress?.error).toBe('Model not found');
    });
  });

  it('should handle verifying status', async () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    const verifyingEvent = {
      event: 'modelDownload',
      data: {
        model: 'llama3.2:1b',
        status: 'verifying' as const,
        completed: 100000000,
        total: 100000000,
        percent: 100,
        digest: 'sha256:xyz789',
      },
    };

    act(() => {
      eventCallbacks.get('modelDownload')?.forEach(cb => cb(verifyingEvent));
    });

    await waitFor(() => {
      expect(result.current.progress?.status).toBe('verifying');
      expect(result.current.progress?.digest).toBe('sha256:xyz789');
    });
  });

  it('should return null progress initially', () => {
    mockIsConnected.mockReturnValue(true);

    const { result } = renderHook(() => useModelDownloadProgress());

    expect(result.current.progress).toBeNull();
  });

  it('should subscribe when connection is established', async () => {
    mockIsConnected.mockReturnValue(false);

    renderHook(() => useModelDownloadProgress());

    expect(mockSubscribe).not.toHaveBeenCalled();

    // Simulate connection
    act(() => {
      mockIsConnected.mockReturnValue(true);
      mockGetState.mockReturnValue('connected');
      connectionChangeCallbacks.forEach(cb => cb(true));
    });

    await waitFor(() => {
      expect(mockSubscribe).toHaveBeenCalledWith('system');
    });
  });
});

describe('useWebSocketQueryInvalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectionChangeCallbacks.clear();
    eventCallbacks.clear();

    mockIsConnected.mockReturnValue(true);
    mockGetState.mockReturnValue('connected');

    mockOnConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.add(callback);
    });

    mockOffConnectionChange.mockImplementation((callback: (connected: boolean) => void) => {
      connectionChangeCallbacks.delete(callback);
    });

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

  describe('Global Channel Subscriptions', () => {
    it('should subscribe to global channels when connected', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalledWith([
          'blocks',
          'sync:all',
          'transactions:all',
          'logs:all',
        ]);
      });
    });

    it('should not subscribe when disconnected', () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      renderHook(() => useWebSocketQueryInvalidation());

      expect(mockSubscribeBatch).not.toHaveBeenCalled();
    });

    it('should unsubscribe from global channels on unmount', async () => {
      mockIsConnected.mockReturnValue(true);

      const { unmount } = renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalledWith([
          'blocks',
          'sync:all',
          'transactions:all',
          'logs:all',
        ]);
      });

      unmount();

      expect(mockUnsubscribeBatch).toHaveBeenCalledWith([
        'blocks',
        'sync:all',
        'transactions:all',
        'logs:all',
      ]);
    });

    it('should subscribe when connection is established', async () => {
      mockIsConnected.mockReturnValue(false);
      mockGetState.mockReturnValue('disconnected');

      renderHook(() => useWebSocketQueryInvalidation());

      expect(mockSubscribeBatch).not.toHaveBeenCalled();

      // Simulate connection
      act(() => {
        mockIsConnected.mockReturnValue(true);
        mockGetState.mockReturnValue('connected');
        connectionChangeCallbacks.forEach(cb => cb(true));
      });

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalledWith([
          'blocks',
          'sync:all',
          'transactions:all',
          'logs:all',
        ]);
      });
    });
  });

  describe('Transaction Event Handling', () => {
    it('should invalidate queries on transaction event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      // Wait for subscriptions and event listeners to be set up
      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
        expect(mockOn).toHaveBeenCalledWith('transaction', expect.any(Function));
      });

      const transactionEvent = {
        event: 'transaction',
        data: { txid: 'tx123', amount: 1000 },
      };

      act(() => {
        eventCallbacks.get('transaction')?.forEach(cb => cb(transactionEvent));
      });

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
      });
    });

    it('should invalidate queries on confirmation event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const confirmationEvent = {
        event: 'confirmation',
        data: { txid: 'tx456', confirmations: 3 },
      };

      act(() => {
        eventCallbacks.get('confirmation')?.forEach(cb => cb(confirmationEvent));
      });

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
      });
    });

    it('should invalidate wallets query on balance event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const balanceEvent = {
        event: 'balance',
        data: { balance: 5000, confirmed: 5000 },
      };

      act(() => {
        eventCallbacks.get('balance')?.forEach(cb => cb(balanceEvent));
      });

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['wallets'] });
      });
    });
  });

  describe('New Block Event Handling', () => {
    it('should invalidate all relevant queries on newBlock event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const newBlockEvent = {
        event: 'newBlock',
        data: { height: 800000 },
      };

      act(() => {
        eventCallbacks.get('newBlock')?.forEach(cb => cb(newBlockEvent));
      });

      await waitFor(() => {
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['pendingTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['recentTransactions'] });
        expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['wallets'] });
      });
    });

    it('should ignore non-newBlock events in newBlock handler', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const otherEvent = {
        event: 'transaction',
        data: { txid: 'tx789' },
      };

      // Clear previous calls
      mockInvalidateQueries.mockClear();

      act(() => {
        eventCallbacks.get('newBlock')?.forEach(cb => cb(otherEvent));
      });

      // Should not invalidate from newBlock handler (wrong event type)
      expect(mockInvalidateQueries).not.toHaveBeenCalledWith({ queryKey: ['wallets'] });
    });
  });

  describe('Sync Event Handling', () => {
    it('should update wallet list cache on sync event', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const syncEvent = {
        event: 'sync',
        data: {
          walletId: 'wallet-123',
          inProgress: true,
          status: 'scanning',
        },
      };

      act(() => {
        eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
      });

      await waitFor(() => {
        expect(mockSetQueryData).toHaveBeenCalledWith(
          ['wallets', 'list'],
          expect.any(Function)
        );
        expect(mockSetQueryData).toHaveBeenCalledWith(
          ['wallets', 'detail', 'wallet-123'],
          expect.any(Function)
        );
      });
    });

    it('should ignore sync events without walletId', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const syncEvent = {
        event: 'sync',
        data: {
          inProgress: true,
          status: 'scanning',
        },
      };

      mockSetQueryData.mockClear();

      act(() => {
        eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
      });

      // Should not update cache without walletId
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });

    it('should ignore non-sync events in sync handler', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const otherEvent = {
        event: 'transaction',
        data: { walletId: 'wallet-456' },
      };

      mockSetQueryData.mockClear();

      act(() => {
        eventCallbacks.get('sync')?.forEach(cb => cb(otherEvent));
      });

      // Should not update cache for wrong event type
      expect(mockSetQueryData).not.toHaveBeenCalled();
    });

    it('should update wallet with sync complete status', async () => {
      mockIsConnected.mockReturnValue(true);

      renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockSubscribeBatch).toHaveBeenCalled();
      });

      await flushPromises();

      const syncEvent = {
        event: 'sync',
        data: {
          walletId: 'wallet-789',
          inProgress: false,
          status: 'complete',
        },
      };

      act(() => {
        eventCallbacks.get('sync')?.forEach(cb => cb(syncEvent));
      });

      await waitFor(() => {
        expect(mockSetQueryData).toHaveBeenCalledWith(
          ['wallets', 'list'],
          expect.any(Function)
        );
      });

      // Test the updater function
      const listUpdater = mockSetQueryData.mock.calls.find(
        call => call[0][0] === 'wallets' && call[0][1] === 'list'
      )?.[1];

      const mockWallets = [
        { id: 'wallet-789', name: 'Test Wallet', syncInProgress: true },
        { id: 'wallet-other', name: 'Other Wallet', syncInProgress: false },
      ];

      const result = listUpdater(mockWallets);

      expect(result[0].syncInProgress).toBe(false);
      expect(result[0].lastSyncStatus).toBe('complete');
      expect(result[0].lastSyncedAt).toBeDefined();
      expect(result[1].syncInProgress).toBe(false); // Unchanged
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove all event listeners on unmount', async () => {
      mockIsConnected.mockReturnValue(true);

      const { unmount } = renderHook(() => useWebSocketQueryInvalidation());

      await waitFor(() => {
        expect(mockOn).toHaveBeenCalledWith('transaction', expect.any(Function));
      });

      unmount();

      expect(mockOff).toHaveBeenCalledWith('transaction', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('confirmation', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('balance', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('newBlock', expect.any(Function));
      expect(mockOff).toHaveBeenCalledWith('sync', expect.any(Function));
    });
  });
});
