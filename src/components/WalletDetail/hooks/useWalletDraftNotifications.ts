import { useCallback } from 'react';

export function useWalletDraftNotifications({
  walletId,
  setDraftsCount,
  addAppNotification,
  removeNotificationsByType,
}: {
  walletId: string | undefined;
  setDraftsCount: (count: number) => void;
  addAppNotification: (notification: {
    type: 'pending_drafts';
    scope: 'wallet';
    scopeId: string;
    severity: 'warning';
    title: string;
    message: string;
    count: number;
    actionUrl: string;
    actionLabel: string;
    dismissible: boolean;
    persistent: boolean;
  }) => void;
  removeNotificationsByType: (type: 'pending_drafts', scopeId?: string) => void;
}) {
  return useCallback((count: number) => {
    setDraftsCount(count);

    if (!walletId) return;

    if (count > 0) {
      addAppNotification({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: walletId,
        severity: 'warning',
        title: `${count} pending draft${count > 1 ? 's' : ''}`,
        message: 'Resume or broadcast your draft transactions',
        count,
        actionUrl: `/wallets/${walletId}`,
        actionLabel: 'View Drafts',
        dismissible: true,
        persistent: false,
      });
    } else {
      removeNotificationsByType('pending_drafts', walletId);
    }
  }, [walletId, setDraftsCount, addAppNotification, removeNotificationsByType]);
}
