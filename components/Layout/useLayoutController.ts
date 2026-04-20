import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import {
  type CreateNotificationInput,
  type NotificationType,
  useAppNotifications,
} from '../../contexts/AppNotificationContext';
import { useDevices } from '../../hooks/queries/useDevices';
import { useWallets } from '../../hooks/queries/useWallets';
import { useAppCapabilities } from '../../hooks/useAppCapabilities';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { getDrafts } from '../../src/api/drafts';
import type { Wallet } from '../../src/api/wallets';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import type { ExpandedState } from './types';

const log = createLogger('Layout');

type LayoutSection = keyof ExpandedState;

interface NotificationActions {
  addNotification: (input: CreateNotificationInput) => string;
  removeNotificationsByType: (type: NotificationType, scopeId?: string) => void;
}

export const getExpandedState = (pathname: string): ExpandedState => ({
  wallets: /^\/wallets\/[^/]+/.test(pathname),
  devices: /^\/devices\/[^/]+/.test(pathname),
  admin: pathname.startsWith('/admin/'),
});

const getAdminConnectionAction = (isAdmin: boolean) =>
  isAdmin
    ? {
        actionUrl: '/admin/node',
        actionLabel: 'Configure Node',
      }
    : {};

const addConnectionErrorNotification = (
  { addNotification }: Pick<NotificationActions, 'addNotification'>,
  isAdmin: boolean,
  title: string,
  message: string
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
  { addNotification, removeNotificationsByType }: NotificationActions
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

const syncDraftNotifications = async (
  wallets: Wallet[],
  notificationActions: NotificationActions
) => {
  for (const wallet of wallets) {
    await syncWalletDraftNotification(wallet, notificationActions);
  }
};

const checkBitcoinConnection = async (
  isAdmin: boolean,
  notificationActions: NotificationActions
) => {
  try {
    const status = await bitcoinApi.getStatus();
    if (status.connected) {
      notificationActions.removeNotificationsByType('connection_error');
      return;
    }

    addConnectionErrorNotification(
      notificationActions,
      isAdmin,
      'Electrum server unreachable',
      status.error || 'Unable to connect to blockchain. Wallet data may be outdated.'
    );
  } catch (error) {
    addConnectionErrorNotification(
      notificationActions,
      isAdmin,
      'Connection error',
      'Unable to check blockchain status. Server may be unavailable.'
    );
  }
};

export const useLayoutController = () => {
  const { user, logout } = useUser();
  const location = useLocation();
  const {
    getWalletCount,
    getDeviceCount,
    addNotification,
    removeNotificationsByType,
  } = useAppNotifications();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<ExpandedState>(() => getExpandedState(location.pathname));
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionInfo, setVersionInfo] = useState<adminApi.VersionInfo | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: wallets = [] } = useWallets();
  const { data: devices = [] } = useDevices();
  const capabilities = useAppCapabilities();

  useEffect(() => {
    setExpanded(getExpandedState(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (!user || wallets.length === 0) return;

    void syncDraftNotifications(wallets, { addNotification, removeNotificationsByType });
  }, [user, wallets, addNotification, removeNotificationsByType]);

  useEffect(() => {
    if (!user) return;

    const runConnectionCheck = () => {
      void checkBitcoinConnection(user.isAdmin, { addNotification, removeNotificationsByType });
    };

    runConnectionCheck();
    const interval = setInterval(runConnectionCheck, 60000);

    return () => clearInterval(interval);
  }, [user, addNotification, removeNotificationsByType]);

  useEffect(() => () => {
    if (copyFeedbackTimeoutRef.current) {
      clearTimeout(copyFeedbackTimeoutRef.current);
    }
  }, []);

  const handleVersionClick = useCallback(async () => {
    setShowVersionModal(true);
    if (versionInfo) return;

    setVersionLoading(true);
    try {
      const info = await adminApi.checkVersion();
      setVersionInfo(info);
    } catch (error) {
      logError(log, error, 'Failed to check version');
    } finally {
      setVersionLoading(false);
    }
  }, [versionInfo]);

  const copyToClipboard = useCallback(async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (copyFeedbackTimeoutRef.current) {
        clearTimeout(copyFeedbackTimeoutRef.current);
      }
      setCopiedAddress(type);
      copyFeedbackTimeoutRef.current = setTimeout(() => {
        setCopiedAddress(null);
        copyFeedbackTimeoutRef.current = null;
      }, 2000);
    } catch (error) {
      logError(log, error, 'Failed to copy to clipboard');
    }
  }, []);

  const toggleSection = useCallback((section: LayoutSection) => {
    setExpanded((previous) => ({ ...previous, [section]: !previous[section] }));
  }, []);

  return {
    user,
    logout,
    wallets,
    devices,
    capabilities,
    expanded,
    isMobileMenuOpen,
    showVersionModal,
    versionInfo,
    versionLoading,
    copiedAddress,
    getWalletCount,
    getDeviceCount,
    setIsMobileMenuOpen,
    setShowVersionModal,
    toggleSection,
    handleVersionClick,
    copyToClipboard,
  };
};

export type LayoutController = ReturnType<typeof useLayoutController>;
