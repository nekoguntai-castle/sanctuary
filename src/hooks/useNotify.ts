/**
 * useNotify - Unified notification facade
 *
 * Single entry point to both toast (transient) and app (persistent) notification systems.
 * Simplifies the most common notification patterns into terse helper functions.
 *
 * Toast notifications use the Notification type from NotificationToast (title required, message optional).
 * App notifications use CreateNotificationInput from AppNotificationContext (scoped, persistent).
 *
 * @example
 * const notify = useNotify();
 *
 * // Toast shortcuts
 * notify.success('Wallet created');
 * notify.error('Connection failed', 'Please check your network');
 * notify.info('Syncing...', undefined, 3000);
 *
 * // App (persistent/scoped) notifications
 * notify.badge({ type: 'pending_drafts', scope: 'wallet', scopeId: walletId, title: '3 pending' });
 * notify.removeBadge('pending_drafts', walletId);
 */

import { useCallback, useMemo } from 'react';
import { useNotifications } from '../contexts/NotificationContext';
import { useAppNotifications, type CreateNotificationInput } from '../contexts/AppNotificationContext';

export function useNotify() {
  const { addNotification: addToast, removeNotification: removeToast, clearAll: clearToasts } = useNotifications();
  const appNotifications = useAppNotifications();

  // --- Toast shortcuts (transient) ---

  const success = useCallback((title: string, message?: string, duration = 5000) => {
    addToast({ type: 'success', title, message, duration });
  }, [addToast]);

  const error = useCallback((title: string, message?: string, duration = 8000) => {
    addToast({ type: 'error', title, message, duration });
  }, [addToast]);

  const info = useCallback((title: string, message?: string, duration = 5000) => {
    addToast({ type: 'info', title, message, duration });
  }, [addToast]);

  const warning = useCallback((title: string, message?: string, duration = 6000) => {
    addToast({ type: 'warning', title, message, duration });
  }, [addToast]);

  // --- App notification shortcuts (persistent/scoped) ---

  const badge = useCallback((input: CreateNotificationInput) => {
    return appNotifications.addNotification(input);
  }, [appNotifications]);

  const removeBadge = useCallback((type: string, scopeId?: string) => {
    appNotifications.removeNotificationsByType(type, scopeId);
  }, [appNotifications]);

  return useMemo(() => ({
    // Toast (transient)
    success,
    error,
    info,
    warning,
    removeToast,
    clearToasts,

    // App (persistent/scoped)
    badge,
    removeBadge,
    appNotifications,
  }), [success, error, info, warning, removeToast, clearToasts, badge, removeBadge, appNotifications]);
}
