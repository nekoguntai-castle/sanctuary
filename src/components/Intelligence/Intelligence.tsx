import React, { useMemo, useState } from 'react';
import { useActiveNetwork } from '../../contexts/ActiveNetworkContext';
import { useWallets } from '../../hooks/queries/useWallets';
import { filterByNetwork } from '../../app/networks';
import { IntelligenceHeader } from './IntelligenceShell/IntelligenceHeader';
import { IntelligenceEmptyState, IntelligenceLoadingState } from './IntelligenceShell/IntelligenceStates';
import { TabNavigation } from './IntelligenceShell/TabNavigation';
import { TabPanel } from './IntelligenceShell/TabPanel';
import { useWalletSelection } from './IntelligenceShell/useWalletSelection';
import type { TabId } from './IntelligenceShell/types';

export const Intelligence: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('insights');
  const { selectedNetwork } = useActiveNetwork();
  const { data: wallets = [], isLoading: loading } = useWallets();
  const networkWallets = useMemo(
    () => filterByNetwork(wallets, selectedNetwork),
    [selectedNetwork, wallets]
  );
  const walletSelection = useWalletSelection(networkWallets);

  if (loading) {
    return <IntelligenceLoadingState />;
  }

  if (networkWallets.length === 0) {
    return <IntelligenceEmptyState />;
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <IntelligenceHeader wallets={networkWallets} walletSelection={walletSelection} />
      <TabNavigation activeTab={activeTab} onSelectTab={setActiveTab} />
      <TabPanel
        key={walletSelection.selectedWalletId}
        activeTab={activeTab}
        walletId={walletSelection.selectedWalletId}
      />
    </div>
  );
};
