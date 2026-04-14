import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAppNotifications } from '../../../contexts/AppNotificationContext';
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
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it('handles serialization errors when saving notifications', async () => {
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
      } finally {
        stringifySpy.mockRestore();
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
          key === 'sanctuary_app_notifications' ? JSON.stringify(persisted) : null
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

      localStorage.setItem('sanctuary_app_notifications', JSON.stringify([expiredNotif]));

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
};
