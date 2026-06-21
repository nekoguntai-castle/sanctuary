import React from 'react';
import { SanctuaryLogo } from '../../ui/CustomIcons';
import { SidebarNetworkSelector } from './SidebarNetworkSelector';
import type { TabNetwork } from '../../../src/app/networks';

interface SidebarHeaderProps {
  selectedNetwork: TabNetwork;
  onNetworkChange: (network: TabNetwork) => void;
  networkAvailability: Record<TabNetwork, boolean>;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({
  selectedNetwork,
  onNetworkChange,
  networkAvailability,
}) => (
  <div className="flex flex-col flex-shrink-0 px-5 md:px-2 lg:px-5 pt-5 pb-4 border-b border-sanctuary-200 dark:border-sanctuary-800">
    <div className="flex items-center md:justify-center lg:justify-start pb-4">
      <SanctuaryLogo className="h-8 w-8 text-primary-700 dark:text-primary-500 mr-3 md:mr-0 lg:mr-3" />
      <span className="text-xl font-semibold tracking-tight text-sanctuary-800 dark:text-sanctuary-200 md:hidden lg:inline">
        Sanctuary
      </span>
    </div>
    <div className="md:hidden lg:block">
      <SidebarNetworkSelector
        selectedNetwork={selectedNetwork}
        onNetworkChange={onNetworkChange}
        networkAvailability={networkAvailability}
        compact
      />
    </div>
  </div>
);
