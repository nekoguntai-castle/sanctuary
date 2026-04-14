import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { wrapper } from './AppNotificationContextTestHarness';

export const registerAppNotificationSelectorsPanelContracts = () => {
  describe('filtered getters', () => {
    it('should get global notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft',
        });
      });

      const global = result.current.getGlobalNotifications();
      expect(global).toHaveLength(1);
      expect(global[0].scope).toBe('global');
    });

    it('should get wallet notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-1',
          title: 'W1 Draft',
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-2',
          title: 'W2 Draft',
        });
      });

      const w1Notifs = result.current.getWalletNotifications('wallet-1');
      expect(w1Notifs).toHaveLength(1);
      expect(w1Notifs[0].title).toBe('W1 Draft');
    });

    it('should get device notifications', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'connection_error',
          scope: 'device',
          scopeId: 'device-1',
          title: 'Device Error',
        });
      });

      const deviceNotifs = result.current.getDeviceNotifications('device-1');
      expect(deviceNotifs).toHaveLength(1);
      expect(deviceNotifs[0].scopeId).toBe('device-1');
    });

    it('should get notifications by type', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error 1',
        });
        result.current.addNotification({
          type: 'sync_error',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Error 2',
        });
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
      });

      const syncErrors = result.current.getNotificationsByType('sync_error');
      expect(syncErrors).toHaveLength(2);
    });
  });

  describe('count functions', () => {
    it('should return global count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          count: 1,
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'global',
          title: 'Drafts',
          count: 3,
        });
      });

      expect(result.current.getGlobalCount()).toBe(4);
    });

    it('should return wallet count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Drafts',
          count: 5,
        });
      });

      expect(result.current.getWalletCount('w1')).toBe(5);
      expect(result.current.getWalletCount('w2')).toBe(0);
    });

    it('should return device count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'connection_error',
          scope: 'device',
          scopeId: 'd1',
          title: 'Error',
        });
      });

      expect(result.current.getDeviceCount('d1')).toBe(1);
    });

    it('should return total count', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
          count: 1,
        });
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Drafts',
          count: 2,
        });
        result.current.addNotification({
          type: 'connection_error',
          scope: 'device',
          scopeId: 'd1',
          title: 'Error',
        });
      });

      expect(result.current.getTotalCount()).toBe(4);
    });

    it('should default to 1 when count is not specified', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Update',
        });
      });

      expect(result.current.getTotalCount()).toBe(1);
    });

    it('should default global count to 1 when global notification count is missing', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'update_available',
          scope: 'global',
          title: 'Global Update',
        });
      });

      expect(result.current.getGlobalCount()).toBe(1);
    });
  });

  describe('hasNotificationType', () => {
    it('should check if notification type exists', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current.hasNotificationType('sync_error')).toBe(false);

      act(() => {
        result.current.addNotification({
          type: 'sync_error',
          scope: 'global',
          title: 'Error',
        });
      });

      expect(result.current.hasNotificationType('sync_error')).toBe(true);
      expect(result.current.hasNotificationType('update_available')).toBe(false);
    });

    it('should check for type with scopeId', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'w1',
          title: 'Draft',
        });
      });

      expect(result.current.hasNotificationType('pending_drafts', 'w1')).toBe(true);
      expect(result.current.hasNotificationType('pending_drafts', 'w2')).toBe(false);
    });
  });

  describe('panel state', () => {
    it('should toggle panel', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      expect(result.current.isPanelOpen).toBe(false);

      act(() => {
        result.current.togglePanel();
      });

      expect(result.current.isPanelOpen).toBe(true);

      act(() => {
        result.current.togglePanel();
      });

      expect(result.current.isPanelOpen).toBe(false);
    });

    it('should open panel', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.openPanel();
      });

      expect(result.current.isPanelOpen).toBe(true);

      act(() => {
        result.current.openPanel();
      });

      expect(result.current.isPanelOpen).toBe(true);
    });

    it('should close panel', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.openPanel();
      });

      act(() => {
        result.current.closePanel();
      });

      expect(result.current.isPanelOpen).toBe(false);
    });
  });
};
