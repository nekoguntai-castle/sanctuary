import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  eventCallbacks,
  mockOff,
  mockOn,
} from './useWebSocketTestHarness';
import {
  useWebSocketEvent,
} from '../../../hooks/websocket';

export function registerUseWebSocketEventTests(): void {
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
}
