import { useEffect } from 'react';
import {
  type CreateNotificationInput,
  type NotificationType,
} from '../../contexts/AppNotificationContext';
import * as bitcoinApi from '../../src/api/bitcoin';
import { getDrafts } from '../../src/api/drafts';
import type { Wallet } from '../../src/api/wallets';
import type { TabNetwork } from '../../src/app/networks';
import { logError } from '../../utils/errorHandler';
import { createLogger } from '../../utils/logger';

const log = createLogger('Layout');

interface LayoutNotificationUser {
  isAdmin?: boolean;
}

interface NotificationActions {
  addNotification: (input: CreateNotificationInput) => string;
  removeNotificationsByType: (type: NotificationType, scopeId?: string) => void;
}

const getAdminConnectionAction = (isAdmin: boolean) =>
  isAdmin
    ? {
        actionUrl: '/admin/node-config',
        actionLabel: 'Configure Node',
      }
    : {};

const addConnectionErrorNotification = (
  { addNotification }: Pick<NotificationActions, 'addNotification'>,
  isAdmin: boolean,
  title: string,
  message: string,
) => {
  addNotification({
    type: 'connection_error',
    scope: 'global',
    severity: 'critical',
    title,
    message,
    ...getAdminConnectionAction(isAdmin),
    dismissible: false,
    persistent: false,
  });
};

const syncWalletDraftNotification = async (
  wallet: Wallet,
  { addNotification, removeNotificationsByType }: NotificationActions,
) => {
  try {
    const drafts = await getDrafts(wallet.id);

    if (drafts.length > 0) {
      addNotification({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: wallet.id,
        severity: 'warning',
        title: `${drafts.length} pending draft${drafts.length > 1 ? 's' : ''}`,
        message: `${wallet.name}: Resume or broadcast`,
        count: drafts.length,
        actionUrl: `/wallets/${wallet.id}`,
        actionLabel: 'View Drafts',
        dismissible: true,
        persistent: false,
      });
      return;
    }

    removeNotificationsByType('pending_drafts', wallet.id);
  } catch (error) {
    logError(log, error, 'Failed to fetch drafts for wallet', {
      context: { walletId: wallet.id },
    });
  }
};

export const syncDraftNotifications = async (
  wallets: Wallet[],
  notificationActions: NotificationActions,
) => {
  for (const wallet of wallets) {
    await syncWalletDraftNotification(wallet, notificationActions);
  }
};

export const checkBitcoinConnection = async (
  isAdmin: boolean,
  network: TabNetwork,
  notificationActions: NotificationActions,
) => {
  try {
    const status = await bitcoinApi.getStatus(network);
    if (status.connected) {
      notificationActions.removeNotificationsByType('connection_error');
      return;
    }

    addConnectionErrorNotification(
      notificationActions,
      isAdmin,
      'Electrum server unreachable',
      status.error || 'Unable to connect to blockchain. Wallet data may be outdated.',
    );
  } catch {
    addConnectionErrorNotification(
      notificationActions,
      isAdmin,
      'Connection error',
      'Unable to check blockchain status. Server may be unavailable.',
    );
  }
};

export function useLayoutNotifications({
  user,
  wallets,
  selectedNetwork,
  notificationActions,
}: {
  user: LayoutNotificationUser | null;
  wallets: Wallet[];
  selectedNetwork: TabNetwork;
  notificationActions: NotificationActions;
}) {
  useEffect(() => {
    if (!user || wallets.length === 0) return;

    void syncDraftNotifications(wallets, notificationActions);
  }, [user, wallets, notificationActions]);

  useEffect(() => {
    if (!user) return;

    const runConnectionCheck = () => {
      void checkBitcoinConnection(!!user.isAdmin, selectedNetwork, notificationActions);
    };

    runConnectionCheck();
    const interval = setInterval(runConnectionCheck, 60000);

    return () => clearInterval(interval);
  }, [user, selectedNetwork, notificationActions]);
}
