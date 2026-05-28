import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUser } from '../../contexts/UserContext';
import { useAppNotifications } from '../../contexts/AppNotificationContext';
import { useDevices } from '../../hooks/queries/useDevices';
import { useWallets } from '../../hooks/queries/useWallets';
import { useAppCapabilities } from '../../hooks/useAppCapabilities';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import { filterByNetwork } from '../../src/app/networks';
import { filterDevicesByNetwork } from '../../utils/networkScopedDevices';
import type { ExpandedState } from './types';
import { useLayoutChromeState } from './useLayoutChromeState';
import { useLayoutNotifications } from './useLayoutNotifications';
import {
  getSidebarNetworkAvailability,
  useSidebarNetworkAvailability,
} from './useSidebarNetworkAvailability';

type LayoutSection = keyof ExpandedState;

export { getSidebarNetworkAvailability };

export const getExpandedState = (pathname: string): ExpandedState => ({
  wallets: /^\/wallets\/[^/]+/.test(pathname),
  devices: /^\/devices\/[^/]+/.test(pathname),
  admin: pathname.startsWith('/admin/'),
});

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
  const { data: wallets = [] } = useWallets();
  const { data: devices = [] } = useDevices();
  const capabilities = useAppCapabilities();
  const [expanded, setExpanded] = useState<ExpandedState>(() => getExpandedState(location.pathname));
  const notificationActions = useMemo(
    () => ({ addNotification, removeNotificationsByType }),
    [addNotification, removeNotificationsByType],
  );
  const networkAvailability = useSidebarNetworkAvailability({
    enabled: !!user,
    selectedNetwork,
    setSelectedNetwork,
  });
  const chrome = useLayoutChromeState({ capabilities, user });

  const activeWallets = useMemo(
    () => filterByNetwork(wallets, selectedNetwork),
    [selectedNetwork, wallets],
  );
  const activeDevices = useMemo(
    () => filterDevicesByNetwork(devices, selectedNetwork),
    [devices, selectedNetwork],
  );

  useEffect(() => {
    setExpanded(getExpandedState(location.pathname));
  }, [location.pathname]);

  useLayoutNotifications({
    user,
    wallets,
    selectedNetwork,
    notificationActions,
  });

  const toggleSection = useCallback((section: LayoutSection) => {
    setExpanded((previous) => ({ ...previous, [section]: !previous[section] }));
  }, []);

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
    isMobileMenuOpen: chrome.isMobileMenuOpen,
    isConsoleOpen: chrome.isConsoleOpen,
    showVersionModal: chrome.showVersionModal,
    showKeyboardShortcutsModal: chrome.showKeyboardShortcutsModal,
    versionInfo: chrome.versionInfo,
    versionLoading: chrome.versionLoading,
    copiedAddress: chrome.copiedAddress,
    getWalletCount,
    getDeviceCount,
    setIsMobileMenuOpen: chrome.setIsMobileMenuOpen,
    setShowVersionModal: chrome.setShowVersionModal,
    openConsole: chrome.openConsole,
    closeConsole: chrome.closeConsole,
    openKeyboardShortcuts: chrome.openKeyboardShortcuts,
    closeKeyboardShortcuts: chrome.closeKeyboardShortcuts,
    toggleSection,
    handleVersionClick: chrome.handleVersionClick,
    copyToClipboard: chrome.copyToClipboard,
  };
};

export type LayoutController = ReturnType<typeof useLayoutController>;
