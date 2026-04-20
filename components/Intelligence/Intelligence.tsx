import React, { useState } from 'react';
import { useWallets } from '../../hooks/queries/useWallets';
import { IntelligenceHeader } from './IntelligenceShell/IntelligenceHeader';
import { IntelligenceEmptyState, IntelligenceLoadingState } from './IntelligenceShell/IntelligenceStates';
import { TabNavigation } from './IntelligenceShell/TabNavigation';
import { TabPanel } from './IntelligenceShell/TabPanel';
import { useWalletSelection } from './IntelligenceShell/useWalletSelection';
import type { TabId } from './IntelligenceShell/types';

export const Intelligence: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('insights');
  const { data: wallets = [], isLoading: loading } = useWallets();
  const walletSelection = useWalletSelection(wallets);

  if (loading) {
    return <IntelligenceLoadingState />;
  }

  if (wallets.length === 0) {
    return <IntelligenceEmptyState />;
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <IntelligenceHeader wallets={wallets} walletSelection={walletSelection} />
      <TabNavigation activeTab={activeTab} onSelectTab={setActiveTab} />
      <TabPanel activeTab={activeTab} walletId={walletSelection.selectedWalletId} />
    </div>
  );
};
