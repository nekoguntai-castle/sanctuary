import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { wrapper } from './AppNotificationContextTestHarness';

export const registerAppNotificationLifecycleCrudContracts = () => {
  describe('useAppNotifications hook', () => {
    it('should throw error when used outside provider', () => {
      expect(() => {
        renderHook(() => useAppNotifications());
      }).toThrow('useAppNotifications must be used within an AppNotificationProvider');
    });

    it('should return context value when used within provider', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current).toBeDefined();
      expect(result.current.notifications).toEqual([]);
      expect(typeof result.current.addNotification).toBe('function');
      expect(typeof result.current.removeNotification).toBe('function');
    });
  });

  describe('addNotification', () => {
    it('should add a notification', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'global',
          title: 'Test Notification',
          severity: 'info',
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Test Notification');
      expect(result.current.notifications[0].type).toBe('pending_drafts');
      expect(result.current.notifications[0].scope).toBe('global');
    });

    it('should add notification with default severity', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.notifications[0].severity).toBe('info');
    });

    it('should add notification with all optional properties', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      const expiresAt = new Date(Date.now() + 3600000);

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          severity: 'warning',
          title: 'Pending Drafts',
          message: 'You have pending drafts',
          count: 3,
          actionUrl: '/wallet/wallet-123/drafts',
          actionLabel: 'View Drafts',
          dismissible: true,
          persistent: true,
          expiresAt,
          metadata: { draftsIds: ['d1', 'd2', 'd3'] },
        });
      });

      const notif = result.current.notifications[0];
      expect(notif.scope).toBe('wallet');
      expect(notif.scopeId).toBe('wallet-123');
      expect(notif.severity).toBe('warning');
      expect(notif.message).toBe('You have pending drafts');
      expect(notif.count).toBe(3);
      expect(notif.actionUrl).toBe('/wallet/wallet-123/drafts');
      expect(notif.actionLabel).toBe('View Drafts');
      expect(notif.dismissible).toBe(true);
      expect(notif.persistent).toBe(true);
      expect(notif.metadata).toEqual({ draftsIds: ['d1', 'd2', 'd3'] });
    });

    it('should update existing notification with same type and scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          title: 'Draft 1',
          count: 1,
        });
      });

      const originalId = result.current.notifications[0].id;

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          title: 'Drafts Updated',
          count: 3,
        });
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].id).toBe(originalId);
      expect(result.current.notifications[0].title).toBe('Drafts Updated');
      expect(result.current.notifications[0].count).toBe(3);
    });

    it('should add separate notifications for different scopeIds', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-1',
          title: 'Wallet 1 Drafts',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-2',
          title: 'Wallet 2 Drafts',
        });
      });

      expect(result.current.notifications).toHaveLength(2);
    });
  });

  describe('updateNotification', () => {
    it('should update notification by id', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'sync_in_progress',
          scope: 'global',
          title: 'Syncing...',
        });
      });

      act(() => {
        result.current.updateNotification(notifId, {
          title: 'Sync Complete',
          severity: 'info',
        });
      });

      expect(result.current.notifications[0].title).toBe('Sync Complete');
    });

    it('should not change scope or type on update', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      act(() => {
        result.current.updateNotification(notifId, {
          type: 'pending_drafts' as any,
          scope: 'wallet' as any,
          title: 'Changed',
        });
      });

      expect(result.current.notifications[0].type).toBe('sync_error');
      expect(result.current.notifications[0].scope).toBe('global');
      expect(result.current.notifications[0].title).toBe('Changed');
    });
  });

  describe('removeNotification', () => {
    it('should remove notification by id', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Alert',
        });
      });

      expect(result.current.notifications).toHaveLength(1);

      act(() => {
        result.current.removeNotification(notifId);
      });

      expect(result.current.notifications).toHaveLength(0);
    });
  });

  describe('removeNotificationsByType', () => {
    it('should remove all notifications of a type', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft 1',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w2',
          title: 'Draft 2',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.notifications).toHaveLength(3);

      act(() => {
        result.current.removeNotificationsByType('pending_drafts');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].type).toBe('sync_error');
    });

    it('should remove notifications by type and scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft 1',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w2',
          title: 'Draft 2',
        });
      });

      act(() => {
        result.current.removeNotificationsByType('pending_drafts', 'w1');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].scopeId).toBe('w2');
    });
  });

  describe('clearAllNotifications', () => {
    it('should clear all notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Alert 1',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.notifications).toHaveLength(2);

      act(() => {
        result.current.clearAllNotifications();
      });

      expect(result.current.notifications).toHaveLength(0);
    });
  });

  describe('clearScopedNotifications', () => {
    it('should clear notifications by scope', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Wallet 1',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Global Error',
        });
      });

      act(() => {
        result.current.clearScopedNotifications('wallet');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].scope).toBe('global');
    });

    it('should clear notifications by scope and scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Wallet 1',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w2',
          title: 'Wallet 2',
        });
      });

      act(() => {
        result.current.clearScopedNotifications('wallet', 'w1');
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].scopeId).toBe('w2');
    });
  });

  describe('dismissNotification', () => {
    it('should dismiss dismissible notification', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          dismissible: true,
        });
      });

      act(() => {
        result.current.dismissNotification(notifId);
      });

      expect(result.current.notifications).toHaveLength(0);
    });

    it('should not dismiss non-dismissible notification', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let notifId: string;
      act(() => {
        notifId = result.current.addNotification({
          type: 'security_alert',
          scope: 'global',
          title: 'Critical Alert',
          dismissible: false,
        });
      });

      act(() => {
        result.current.dismissNotification(notifId);
      });

      expect(result.current.notifications).toHaveLength(1);
    });

    it('should keep non-target notifications when dismissing one item', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      let dismissId: string;
      act(() => {
        dismissId = result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Dismiss Me',
          dismissible: true,
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Keep Me',
          dismissible: true,
        });
      });

      act(() => {
        result.current.dismissNotification(dismissId);
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.notifications[0].title).toBe('Keep Me');
    });
  });
};
