import React from 'react';
import { NetworkTabs } from '../../NetworkTabs';
import type { TabNetwork } from '../../../app/networks';

interface SidebarNetworkSelectorProps {
  selectedNetwork: TabNetwork;
  onNetworkChange: (network: TabNetwork) => void;
  networkAvailability: Record<TabNetwork, boolean>;
  compact?: boolean;
}

export const SidebarNetworkSelector: React.FC<SidebarNetworkSelectorProps> = ({
  selectedNetwork,
  onNetworkChange,
  networkAvailability,
  compact = false,
}) => (
  <>
    {compact ? null : (
      <div className="pt-3 pb-1.5">
        <div className="px-4 text-[9px] font-semibold text-sanctuary-400 dark:text-sanctuary-500 uppercase tracking-[0.15em]">
          Network
        </div>
      </div>
    )}
    <div className={compact ? 'px-0' : 'px-1 pb-2'}>
      <NetworkTabs
        selectedNetwork={selectedNetwork}
        onNetworkChange={onNetworkChange}
        networkAvailability={networkAvailability}
        fullWidth
        layout="grid"
      />
    </div>
  </>
);
