import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAppNotifications } from '../../../src/contexts/AppNotificationContext';
import { wrapper } from './AppNotificationContextTestHarness';

export const registerAppNotificationPersistenceExpirationContracts = () => {
  describe('localStorage persistence', () => {
    // Note: These tests verify the logic but may have timing issues with fake timers
    // The actual localStorage persistence is tested through component behavior

    it('should create notifications with persistent flag', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'backup_reminder',
          scope: 'global',
          title: 'Backup Reminder',
          persistent: true,
        });
      });

      expect(result.current.notifications[0].persistent).toBe(true);
    });

    it('should create notifications without persistent flag', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_in_progress',
          scope: 'global',
          title: 'Syncing',
          persistent: false,
        });
      });

      expect(result.current.notifications[0].persistent).toBe(false);
    });

    it('should default persistent to false', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          // No persistent flag
        });
      });

      expect(result.current.notifications[0].persistent).toBe(false);
    });

    it('handles JSON parse errors when loading notifications', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const getItemSpy = vi
        .spyOn(localStorage, 'getItem')
        .mockImplementation((key: string) =>
          key === 'sanctuary_app_notifications' ? '{bad-json' : null
        );

      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        await act(async () => {
          await Promise.resolve();
        });

        expect(getItemSpy).toHaveBeenCalledWith('sanctuary_app_notifications');
        expect(result.current.notifications).toHaveLength(0);
        expect(
          consoleErrorSpy.mock.calls.some(([message]) =>
            String(message).includes('Failed to load notifications')
          )
        ).toBe(true);
      } finally {
        getItemSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    it('handles localStorage read exceptions when loading notifications', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        expect(result.current.notifications).toHaveLength(0);
        expect(
          consoleErrorSpy.mock.calls.some(([message]) =>
            String(message).includes('Failed to load notifications')
          )
        ).toBe(true);
      } finally {
        getItemSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });

    it('handles serialization errors when saving notifications', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
        throw new Error('serialization failed');
      });

      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        act(() => {
          result.current.addNotification({
            type: 'backup_reminder',
            scope: 'global',
            title: 'Save Fallback',
            persistent: true,
          });
        });
        await act(async () => {
          await Promise.resolve();
        });
        expect(result.current.notifications).toHaveLength(1);
        expect(
          consoleErrorSpy.mock.calls.some(([message]) =>
            String(message).includes('Failed to save notifications')
          )
        ).toBe(true);
      } finally {
        stringifySpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('expiration', () => {
    it('should load persisted notifications and keep only non-expired entries', async () => {
      const now = Date.now();
      const persisted = [
        {
          id: 'persist-no-expiry',
          type: 'update_available',
          scope: 'global',
          severity: 'info',
          title: 'No Expiry',
          dismissible: true,
          persistent: true,
          createdAt: new Date(now - 1000).toISOString(),
        },
        {
          id: 'persist-future-expiry',
          type: 'sync_error',
          scope: 'global',
          severity: 'warning',
          title: 'Future Expiry',
          dismissible: true,
          persistent: true,
          createdAt: new Date(now - 1000).toISOString(),
          expiresAt: new Date(now + 3600000).toISOString(),
        },
        {
          id: 'persist-expired',
          type: 'backup_reminder',
          scope: 'global',
          severity: 'info',
          title: 'Expired',
          dismissible: true,
          persistent: true,
          createdAt: new Date(now - 7200000).toISOString(),
          expiresAt: new Date(now - 3600000).toISOString(),
        },
      ];

      const getItemSpy = vi
        .spyOn(localStorage, 'getItem')
        .mockImplementation((key: string) =>
          key === 'sanctuary_app_notifications'
            ? JSON.stringify({ v: 1, userId: 'user-1', items: persisted })
            : null
        );

      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });

        await act(async () => {
          await Promise.resolve();
        });

        expect(getItemSpy).toHaveBeenCalledWith('sanctuary_app_notifications');
        expect(result.current.notifications).toHaveLength(2);
        expect(result.current.notifications.map(n => n.id).sort()).toEqual([
          'persist-future-expiry',
          'persist-no-expiry',
        ]);
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it('should filter out expired notifications on load', () => {
      const expiredNotif = {
        id: 'expired-id',
        type: 'update_available',
        scope: 'global',
        severity: 'info',
        title: 'Expired',
        dismissible: true,
        persistent: true,
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        expiresAt: new Date(Date.now() - 3600000).toISOString(),
      };

      localStorage.setItem(
        'sanctuary_app_notifications',
        JSON.stringify({ v: 1, userId: 'user-1', items: [expiredNotif] }),
      );

      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should clean up expired notifications periodically', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      const expiresAt = new Date(Date.now() + 30000);

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Will Expire',
          expiresAt,
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      // Advance time past expiration
      act(() => {
        vi.advanceTimersByTime(60000);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should keep non-expired notifications during periodic cleanup', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Still Valid',
          expiresAt: new Date(Date.now() + 300000),
        });
      });

      act(() => {
        vi.advanceTimersByTime(60000);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Still Valid');
    });
  });

  describe('cross-tab storage synchronization', () => {
    it('reconciles persistent notifications from another tab when owner matches while keeping ephemeral ones', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_in_progress',
          scope: 'global',
          title: 'Local Ephemeral',
          persistent: false,
        });
      });

      const remoteItem = {
        id: 'remote-1',
        type: 'backup_reminder',
        scope: 'global',
        severity: 'warning',
        title: 'From Peer Tab',
        dismissible: true,
        persistent: true,
        createdAt: new Date().toISOString(),
      };

      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'sanctuary_app_notifications',
          newValue: JSON.stringify({ v: 1, userId: 'user-1', items: [remoteItem] }),
        }));
      });

      expect(result.current.notifications.map(n => n.title)).toEqual([
        'Local Ephemeral',
        'From Peer Tab',
      ]);

      // Ignore unrelated storage keys
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'other_key',
          newValue: null,
        }));
      });
      expect(result.current.notifications).toHaveLength(2);

      // Ignore another user's notifications
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'sanctuary_app_notifications',
          newValue: JSON.stringify({ v: 1, userId: 'user-other', items: [] }),
        }));
      });
      expect(result.current.notifications).toHaveLength(2);

      // Clear persistent notifications when key is removed (newValue === null)
      act(() => {
        window.dispatchEvent(new StorageEvent('storage', {
          key: 'sanctuary_app_notifications',
          newValue: null,
        }));
      });
      expect(result.current.notifications.map(n => n.title)).toEqual(['Local Ephemeral']);
    });

    it('updates only the targeted notification when multiple notifications exist', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });
      let firstId = '';

      act(() => {
        firstId = result.current.addNotification({
          type: 'sync_in_progress',
          scope: 'global',
          title: 'First',
        });
        result.current.addNotification({
          type: 'backup_reminder',
          scope: 'global',
          title: 'Second',
        });
      });

      act(() => {
        result.current.updateNotification(firstId, { title: 'Updated First' });
      });

      expect(result.current.notifications.map(n => n.title)).toEqual([
        'Updated First',
        'Second',
      ]);
    });
  });
};
