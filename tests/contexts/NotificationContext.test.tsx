/**
 * NotificationContext Tests
 *
 * Tests for the notification toast context.
 * Covers adding, removing, auto-dismissal, and deduplication of notifications.
 */

import { act,renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { NotificationProvider,useNotifications } from '../../src/contexts/NotificationContext';

// Mock the generateNotificationId function
vi.mock('../../src/components/NotificationToast', () => ({
  generateNotificationId: vi.fn(() => `id-${Math.random().toString(36).substr(2, 9)}`),
}));

describe('NotificationContext', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  const wrapper = ({ children }: { children: ReactNode }) => (
    <NotificationProvider>{children}</NotificationProvider>
  );

  describe('NotificationProvider', () => {
    it('should provide empty notifications array initially', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      expect(result.current.notifications).toEqual([]);
    });

    it('should provide all context methods', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      expect(typeof result.current.addNotification).toBe('function');
      expect(typeof result.current.removeNotification).toBe('function');
      expect(typeof result.current.clearAll).toBe('function');
    });
  });

  describe('useNotifications', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useNotifications());
      }).toThrow('useNotifications must be used within NotificationProvider');
    });
  });

  describe('addNotification', () => {
    it('should add a notification', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'info',
          title: 'Test Title',
          message: 'Test Message',
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0]).toMatchObject({
        type: 'info',
        title: 'Test Title',
        message: 'Test Message',
      });
    });

    it('should assign unique ids to notifications', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({ type: 'info', title: 'First' });
        result.current.addNotification({ type: 'info', title: 'Second' });
      });

      const ids = result.current.notifications.map((n) => n.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('should auto-remove notification after duration', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'info',
          title: 'Auto Remove',
          duration: 3000,
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should not auto-remove notification without duration', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'info',
          title: 'Persistent',
        });
      });

      act(() => {
        vi.advanceTimersByTime(10000);
      });

      expect(result.current.notifications).toHaveLength(1);
    });
  });

  describe('removeNotification', () => {
    it('should remove a specific notification', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({ type: 'info', title: 'First' });
        result.current.addNotification({ type: 'info', title: 'Second' });
      });

      const firstId = result.current.notifications[0].id;

      act(() => {
        result.current.removeNotification(firstId);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Second');
    });

    it('should cancel auto-remove timer when manually removed', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'info',
          title: 'With Duration',
          duration: 5000,
        });
      });

      const id = result.current.notifications[0].id;

      act(() => {
        result.current.removeNotification(id);
      });

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('should handle removing non-existent notification', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({ type: 'info', title: 'Test' });
      });

      act(() => {
        result.current.removeNotification('non-existent-id');
      });

      expect(result.current.notifications).toHaveLength(1);
    });
  });

  describe('clearAll', () => {
    it('should remove all notifications', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({ type: 'info', title: 'First' });
        result.current.addNotification({ type: 'warning', title: 'Second' });
        result.current.addNotification({ type: 'error', title: 'Third' });
      });

      expect(result.current.notifications).toHaveLength(3);

      act(() => {
        result.current.clearAll();
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should cancel all pending timeouts', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({ type: 'info', title: 'A', duration: 1000 });
        result.current.addNotification({ type: 'info', title: 'B', duration: 2000 });
      });

      act(() => {
        result.current.clearAll();
      });

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('Deduplication', () => {
    it('should deduplicate transaction notifications with same txid', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'transaction',
          title: 'Transaction 1',
          data: { txid: 'abc123', confirmations: 0 },
        });
        result.current.addNotification({
          type: 'transaction',
          title: 'Transaction 1 Duplicate',
          data: { txid: 'abc123', confirmations: 0 },
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Transaction 1');
    });

    it('should allow same txid with different confirmation counts', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'confirmation',
          title: '1 confirmation',
          data: { txid: 'abc123', confirmations: 1 },
        });
        result.current.addNotification({
          type: 'confirmation',
          title: '2 confirmations',
          data: { txid: 'abc123', confirmations: 2 },
        });
      });

      expect(result.current.notifications).toHaveLength(2);
    });

    it('should allow same notification after dedupe timeout (30s)', () => {
      const { result } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'transaction',
          title: 'First',
          data: { txid: 'abc123', confirmations: 0 },
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      // Advance past 30 second dedupe window
      act(() => {
        vi.advanceTimersByTime(31000);
      });

      act(() => {
        result.current.addNotification({
          type: 'transaction',
          title: 'Second (same txid)',
          data: { txid: 'abc123', confirmations: 0 },
        });
      });

      expect(result.current.notifications).toHaveLength(2);
    });
  });

  describe('Cleanup', () => {
    it('should clean up all timeouts on unmount', () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');

      const { result, unmount } = renderHook(() => useNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({ type: 'info', title: 'A', duration: 5000 });
        result.current.addNotification({
          type: 'transaction',
          title: 'B',
          data: { txid: 'tx1', confirmations: 0 },
        });
      });

      unmount();

      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });
});
