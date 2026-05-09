import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import {
  type CreateNotificationInput,
  type NotificationType,
  useAppNotifications,
} from '../../contexts/AppNotificationContext';
import { useDevices } from '../../hooks/queries/useDevices';
import { useWallets } from '../../hooks/queries/useWallets';
import { useAppShortcuts } from '../../hooks/useAppShortcuts';
import { useAppCapabilities } from '../../hooks/useAppCapabilities';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import * as adminApi from '../../src/api/admin';
import * as bitcoinApi from '../../src/api/bitcoin';
import { getDrafts } from '../../src/api/drafts';
import type { Wallet } from '../../src/api/wallets';
import { filterByNetwork, type TabNetwork } from '../../src/app/networks';
import { createLogger } from '../../utils/logger';
import { logError } from '../../utils/errorHandler';
import { filterDevicesByNetwork } from '../../utils/networkScopedDevices';
import type { ExpandedState } from './types';

const log = createLogger('Layout');

type LayoutSection = keyof ExpandedState;
type NetworkAvailability = Record<TabNetwork, boolean>;

const DEFAULT_NETWORK_AVAILABILITY: NetworkAvailability = {
  mainnet: true,
  testnet3: true,
  testnet4: true,
  signet: true,
};

const NODE_CONFIG_DISABLED_MESSAGE = 'sync is off in Node Configuration';

const isSameNetworkAvailability = (
  first: NetworkAvailability,
  second: NetworkAvailability,
): boolean => (
  first.mainnet === second.mainnet &&
  first.testnet3 === second.testnet3 &&
  first.testnet4 === second.testnet4 &&
  first.signet === second.signet
);

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
  network: TabNetwork,
  notificationActions: NotificationActions
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

const isNodeConfigurationDisabledStatus = (
  status: bitcoinApi.BitcoinStatus | null,
): boolean => (
  status?.connected === false &&
  typeof status.error === 'string' &&
  status.error.includes(NODE_CONFIG_DISABLED_MESSAGE)
);

const getStatusForAvailability = async (
  network: Exclude<TabNetwork, 'mainnet'>,
): Promise<bitcoinApi.BitcoinStatus | null> => {
  try {
    return await bitcoinApi.getStatus(network);
  } catch {
    return null;
  }
};

export const getSidebarNetworkAvailability = async (): Promise<NetworkAvailability> => {
  const [testnet3Status, testnet4Status, signetStatus] = await Promise.all([
    getStatusForAvailability('testnet3'),
    getStatusForAvailability('testnet4'),
    getStatusForAvailability('signet'),
  ]);

  return {
    mainnet: true,
    testnet3: !isNodeConfigurationDisabledStatus(testnet3Status),
    testnet4: !isNodeConfigurationDisabledStatus(testnet4Status),
    signet: !isNodeConfigurationDisabledStatus(signetStatus),
  };
};

export const useLayoutController = () => {
  const { user, logout } = useUser();
  const { selectedNetwork, setSelectedNetwork } = useActiveNetwork();
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
  const [showKeyboardShortcutsModal, setShowKeyboardShortcutsModal] =
    useState(false);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [versionInfo, setVersionInfo] = useState<adminApi.VersionInfo | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);
  const [networkAvailability, setNetworkAvailability] = useState<NetworkAvailability>(
    DEFAULT_NETWORK_AVAILABILITY
  );
  const networkAvailabilityRef = useRef<NetworkAvailability>(DEFAULT_NETWORK_AVAILABILITY);
  const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: wallets = [] } = useWallets();
  const { data: devices = [] } = useDevices();
  const capabilities = useAppCapabilities();
  const activeWallets = useMemo(
    () => filterByNetwork(wallets, selectedNetwork),
    [selectedNetwork, wallets]
  );
  const activeDevices = useMemo(
    () => filterDevicesByNetwork(devices, selectedNetwork),
    [devices, selectedNetwork]
  );
  const applyNetworkAvailability = useCallback((availability: NetworkAvailability) => {
    if (isSameNetworkAvailability(networkAvailabilityRef.current, availability)) return;

    networkAvailabilityRef.current = availability;
    setNetworkAvailability(availability);
  }, []);

  useEffect(() => {
    setExpanded(getExpandedState(location.pathname));
  }, [location.pathname]);

  useEffect(() => {
    if (!user) {
      applyNetworkAvailability(DEFAULT_NETWORK_AVAILABILITY);
      return;
    }

    let cancelled = false;

    const refreshNetworkAvailability = async () => {
      const availability = await getSidebarNetworkAvailability();
      /* v8 ignore next -- async unmount race guard; cleanup path prevents setting state after unmount. */
      if (cancelled) return;
      applyNetworkAvailability(availability);
    };

    void refreshNetworkAvailability();
    const interval = setInterval(refreshNetworkAvailability, 60000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [user, applyNetworkAvailability]);

  useEffect(() => {
    if (networkAvailability[selectedNetwork]) return;
    setSelectedNetwork('mainnet');
  }, [
    networkAvailability,
    selectedNetwork,
    setSelectedNetwork,
  ]);

  useEffect(() => {
    if (!user || wallets.length === 0) return;

    void syncDraftNotifications(wallets, { addNotification, removeNotificationsByType });
  }, [user, wallets, addNotification, removeNotificationsByType]);

  useEffect(() => {
    if (!user) return;

    const runConnectionCheck = () => {
      void checkBitcoinConnection(user.isAdmin, selectedNetwork, { addNotification, removeNotificationsByType });
    };

    runConnectionCheck();
    const interval = setInterval(runConnectionCheck, 60000);

    return () => clearInterval(interval);
  }, [user, selectedNetwork, addNotification, removeNotificationsByType]);

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

  const openConsole = useCallback(() => {
    if (!capabilities.console) return;
    setIsMobileMenuOpen(false);
    setIsConsoleOpen(true);
  }, [capabilities.console]);

  const closeConsole = useCallback(() => {
    setIsConsoleOpen(false);
  }, []);

  const openKeyboardShortcuts = useCallback(() => {
    setIsMobileMenuOpen(false);
    setShowKeyboardShortcutsModal(true);
  }, []);

  const toggleKeyboardShortcuts = useCallback(() => {
    setIsMobileMenuOpen(false);
    setShowKeyboardShortcutsModal((isOpen) => !isOpen);
  }, []);

  const closeKeyboardShortcuts = useCallback(() => {
    setShowKeyboardShortcutsModal(false);
  }, []);

  const shortcutBindings = useMemo(
    () => [
      {
        id: 'console.open' as const,
        enabled: !!user && !!capabilities.console,
        handler: openConsole,
      },
      {
        id: 'shortcuts.open' as const,
        enabled: !!user,
        handler: toggleKeyboardShortcuts,
      },
    ],
    [capabilities.console, openConsole, toggleKeyboardShortcuts, user]
  );

  useAppShortcuts(shortcutBindings);

  return {
    user,
    logout,
    wallets,
    activeWallets,
    devices,
    activeDevices,
    selectedNetwork,
    setSelectedNetwork,
    networkAvailability,
    capabilities,
    expanded,
    isMobileMenuOpen,
    isConsoleOpen,
    showVersionModal,
    showKeyboardShortcutsModal,
    versionInfo,
    versionLoading,
    copiedAddress,
    getWalletCount,
    getDeviceCount,
    setIsMobileMenuOpen,
    setShowVersionModal,
    openConsole,
    closeConsole,
    openKeyboardShortcuts,
    closeKeyboardShortcuts,
    toggleSection,
    handleVersionClick,
    copyToClipboard,
  };
};

export type LayoutController = ReturnType<typeof useLayoutController>;
