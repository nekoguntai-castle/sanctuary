import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useAppNotifications } from '../../../src/contexts/AppNotificationContext';
import { setSessionUserId, wrapper } from './AppNotificationContextTestHarness';

const STORAGE_KEY = 'sanctuary_app_notifications';

const persistedWarning = {
  id: 'restore-warning',
  type: 'restore_warning',
  scope: 'global',
  severity: 'warning',
  title: 'Restore Warning',
  dismissible: true,
  persistent: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
};

function stubStored(value: unknown) {
  return vi
    .spyOn(localStorage, 'getItem')
    .mockImplementation((key: string) => (key === STORAGE_KEY ? JSON.stringify(value) : null));
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * Non-regression: the persisted notifications had no owner. A session that
 * ended without a terminal logout (cookie expiry, or another tab logging in as
 * someone else) left the previous user's persistent warnings in localStorage,
 * and the next user to log in on that browser saw them.
 */
export const registerAppNotificationSessionOwnerContracts = () => {
  describe('session ownership', () => {
    it('loads notifications stored by the signed-in user', async () => {
      const getItemSpy = stubStored({ v: 1, userId: 'user-1', items: [persistedWarning] });
      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        await settle();

        expect(result.current.notifications.map((n) => n.id)).toEqual(['restore-warning']);
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it("discards another user's stored notifications instead of showing them", async () => {
      const getItemSpy = stubStored({ v: 1, userId: 'admin-1', items: [persistedWarning] });
      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        await settle();

        expect(result.current.notifications).toHaveLength(0);
        expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it.each([
      ['a legacy unowned array', [persistedWarning]],
      ['an unknown version', { v: 2, userId: 'user-1', items: [persistedWarning] }],
      ['a record without an item list', { v: 1, userId: 'user-1', items: 'nope' }],
      ['a non-object value', 7],
      ['null', null],
    ])('discards %s', async (_label, stored) => {
      const getItemSpy = stubStored(stored);
      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        await settle();

        expect(result.current.notifications).toHaveLength(0);
        expect(localStorage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it('neither loads nor saves while nobody is signed in', async () => {
      setSessionUserId(null);
      const getItemSpy = stubStored({ v: 1, userId: 'user-1', items: [persistedWarning] });
      try {
        const { result } = renderHook(() => useAppNotifications(), { wrapper });
        await settle();

        expect(result.current.notifications).toHaveLength(0);
        expect(getItemSpy).not.toHaveBeenCalledWith(STORAGE_KEY);
        expect(localStorage.setItem).not.toHaveBeenCalledWith(STORAGE_KEY, expect.anything());
        // Kept for the owner: an expired cookie is not a logout.
        expect(localStorage.removeItem).not.toHaveBeenCalledWith(STORAGE_KEY);
      } finally {
        getItemSpy.mockRestore();
      }
    });

    it('saves notifications tagged with their owner', async () => {
      const { result } = renderHook(() => useAppNotifications(), { wrapper });
      act(() => {
        result.current.addNotification({
          type: 'backup_reminder',
          scope: 'global',
          title: 'Backup Reminder',
          persistent: true,
        });
      });
      await settle();

      const calls = vi.mocked(localStorage.setItem).mock.calls.filter(([key]) => key === STORAGE_KEY);
      const saved = JSON.parse(calls[calls.length - 1][1]);
      expect(saved).toMatchObject({ v: 1, userId: 'user-1' });
      expect(saved.items.map((n: { title: string }) => n.title)).toEqual(['Backup Reminder']);
    });

    it('drops in-memory notifications and closes the panel when the session changes user', async () => {
      const { result, rerender } = renderHook(() => useAppNotifications(), { wrapper });
      act(() => {
        result.current.addNotification({ type: 'sync_error', scope: 'global', title: 'For user 1' });
        result.current.openPanel();
      });
      expect(result.current.notifications).toHaveLength(1);

      // Another tab logged in as someone else: no terminal logout fires here.
      setSessionUserId('user-2');
      rerender();
      await settle();

      expect(result.current.notifications).toHaveLength(0);
      expect(result.current.isPanelOpen).toBe(false);
    });

    it('empties the list when the session ends without a terminal logout, keeping the stored copy', async () => {
      const { result, rerender } = renderHook(() => useAppNotifications(), { wrapper });
      act(() => {
        result.current.addNotification({
          type: 'backup_reminder',
          scope: 'global',
          title: 'Backup Reminder',
          persistent: true,
        });
      });
      await settle();
      vi.mocked(localStorage.removeItem).mockClear();

      // Cookie expiry: the user is gone but no logout event fired.
      setSessionUserId(null);
      rerender();
      await settle();

      expect(result.current.notifications).toHaveLength(0);
      expect(localStorage.removeItem).not.toHaveBeenCalledWith(STORAGE_KEY);
    });
  });
};
