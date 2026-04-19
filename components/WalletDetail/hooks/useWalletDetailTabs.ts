import { useEffect, useRef, useState } from 'react';
import type { TabType } from '../types';
import {
  DEFAULT_WALLET_DETAIL_TAB,
  canShowWalletDetailTab,
  isWalletDetailTab,
  resolveWalletDetailTab,
} from '../tabDefinitions';

export function useWalletDetailTabs({
  locationState,
  hasWallet,
  walletUserRole,
}: {
  locationState: unknown;
  hasWallet: boolean;
  walletUserRole: string;
}) {
  const requestedInitialTab = (locationState as { activeTab?: unknown } | null)?.activeTab;
  const initialTab = isWalletDetailTab(requestedInitialTab)
    ? requestedInitialTab
    : DEFAULT_WALLET_DETAIL_TAB;
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const appliedLocationStateRef = useRef(locationState);
  const visibleActiveTab = hasWallet && !canShowWalletDetailTab(activeTab, walletUserRole)
    ? DEFAULT_WALLET_DETAIL_TAB
    : activeTab;

  useEffect(() => {
    if (appliedLocationStateRef.current === locationState) return;

    appliedLocationStateRef.current = locationState;
    const stateTab = (locationState as { activeTab?: unknown } | null)?.activeTab;
    if (!isWalletDetailTab(stateTab)) return;

    const nextTab = hasWallet
      ? resolveWalletDetailTab(stateTab, walletUserRole)
      : stateTab;
    setActiveTab((currentTab) => currentTab === nextTab ? currentTab : nextTab);
  }, [locationState, hasWallet, walletUserRole]);

  useEffect(() => {
    if (hasWallet && activeTab !== visibleActiveTab) {
      setActiveTab(visibleActiveTab);
    }
  }, [activeTab, hasWallet, visibleActiveTab]);

  return { setActiveTab, visibleActiveTab };
}
