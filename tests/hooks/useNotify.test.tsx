/**
 * useNotify Hook Tests
 *
 * Tests for the unified notification facade that wraps both
 * toast (transient) and app (persistent) notification systems.
 */

import { act, renderHook } from '@testing-library/react';
import { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotifications } from '../../contexts/NotificationContext';
import { AppNotificationProvider, useAppNotifications } from '../../contexts/AppNotificationContext';
import { useNotify } from '../../hooks/useNotify';

const createWrapper = () => {
  return ({ children }: { children: ReactNode }) => (
    <NotificationProvider>
      <AppNotificationProvider>{children}</AppNotificationProvider>
    </NotificationProvider>
  );
};

describe('useNotify', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
  });

  describe('toast notifications', () => {
    it('success adds a success toast notification', () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          notify: useNotify(),
          notifications: useNotifications(),
        }),
        { wrapper }
      );

      act(() => {
        result.current.notify.success('Wallet created');
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: 'success',
        title: 'Wallet created',
        duration: 5000,
      });
    });

    it('error adds an error toast notification', () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          notify: useNotify(),
          notifications: useNotifications(),
        }),
        { wrapper }
      );

      act(() => {
        result.current.notify.error('Connection failed', 'Please check your network');
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: 'error',
        title: 'Connection failed',
        message: 'Please check your network',
        duration: 8000,
      });
    });

    it('info adds an info toast notification', () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          notify: useNotify(),
          notifications: useNotifications(),
        }),
        { wrapper }
      );

      act(() => {
        result.current.notify.info('Syncing...');
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: 'info',
        title: 'Syncing...',
        duration: 5000,
      });
    });

    it('warning adds a warning toast notification', () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          notify: useNotify(),
          notifications: useNotifications(),
        }),
        { wrapper }
      );

      act(() => {
        result.current.notify.warning('Low balance', 'Consider adding funds');
      });

      expect(result.current.notifications.notifications).toHaveLength(1);
      expect(result.current.notifications.notifications[0]).toMatchObject({
        type: 'warning',
        title: 'Low balance',
        message: 'Consider adding funds',
        duration: 6000,
      });
    });
  });

  describe('app notifications', () => {
    it('badge calls addNotification on appNotifications', () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          notify: useNotify(),
          appNotifications: useAppNotifications(),
        }),
        { wrapper }
      );

      act(() => {
        result.current.notify.badge({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          title: '3 pending',
          count: 3,
        });
      });

      expect(result.current.appNotifications.notifications).toHaveLength(1);
      expect(result.current.appNotifications.notifications[0]).toMatchObject({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: 'wallet-123',
        title: '3 pending',
        count: 3,
      });
    });

    it('removeBadge calls removeNotificationsByType on appNotifications', () => {
      const wrapper = createWrapper();

      const { result } = renderHook(
        () => ({
          notify: useNotify(),
          appNotifications: useAppNotifications(),
        }),
        { wrapper }
      );

      // Add a badge first
      act(() => {
        result.current.notify.badge({
          type: 'pending_drafts',
          scope: 'wallet',
          scopeId: 'wallet-123',
          title: '3 pending',
        });
      });

      expect(result.current.appNotifications.notifications).toHaveLength(1);

      // Remove it
      act(() => {
        result.current.notify.removeBadge('pending_drafts', 'wallet-123');
      });

      expect(result.current.appNotifications.notifications).toHaveLength(0);
    });
  });

  describe('memoization', () => {
    it('return value is a stable reference across rerenders', () => {
      const wrapper = createWrapper();

      const { result, rerender } = renderHook(() => useNotify(), { wrapper });

      const firstRef = result.current;
      rerender();

      expect(result.current).toBe(firstRef);
    });
  });
});
