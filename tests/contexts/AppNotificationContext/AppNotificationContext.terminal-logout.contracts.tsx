import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { triggerLogout } from '../../../src/api/refresh';
import { useAppNotifications } from '../../../src/contexts/AppNotificationContext';
import { wrapper } from './AppNotificationContextTestHarness';

export const registerAppNotificationTerminalLogoutContracts = () => {
  describe('terminal logout', () => {
    it('clears notifications, closes the panel, and removes the storage key on terminal logout', () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });

      act(() => {
        result.current.addNotification({
          type: 'backup_reminder',
          scope: 'global',
          title: 'Backup Reminder',
          persistent: true,
        });
        result.current.openPanel();
      });

      expect(result.current.notifications).toHaveLength(1);
      expect(result.current.isPanelOpen).toBe(true);

      act(() => {
        triggerLogout();
      });

      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.isPanelOpen).toBe(false);
      // The global test setup stubs localStorage (tests/setup.ts), so getItem is
      // always empty; assert the removal call itself instead of a vacuous read.
      expect(localStorage.removeItem).toHaveBeenCalledWith('sanctuary_app_notifications');
    });

    it('still clears notifications on terminal logout when removing the storage key fails', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const removeItemSpy = vi.spyOn(localStorage, 'removeItem').mockImplementation(() => {
        throw new Error('removeItem failed');
      });

      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });

        act(() => {
          result.current.addNotification({
            type: 'backup_reminder',
            scope: 'global',
            title: 'Backup Reminder',
            persistent: true,
          });
        });

        act(() => {
          triggerLogout();
        });

        expect(result.current.notifications).toHaveLength(0);
        expect(
          consoleErrorSpy.mock.calls.some(([message]) =>
            String(message).includes('Failed to clear stored notifications')
          )
        ).toBe(true);
      } finally {
        removeItemSpy.mockRestore();
        consoleErrorSpy.mockRestore();
      }
    });
  });
};
