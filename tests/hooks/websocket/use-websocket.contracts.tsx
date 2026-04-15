import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connectionChangeCallbacks,
  eventCallbacks,
  mockConnect,
  mockGetState,
  mockIsConnected,
  mockOff,
  mockOffConnectionChange,
  mockOn,
  mockOnConnectionChange,
  mockSubscribe,
  mockSubscribeBatch,
  mockUnsubscribe,
  mockUnsubscribeBatch,
} from './useWebSocketTestHarness';
import {
  useWebSocket,
} from '../../../hooks/websocket';

export function registerUseWebSocketTests(): void {
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
}
