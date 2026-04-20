import React from 'react';
import { CompactNetworkSyncActions } from './NetworkSyncActions/CompactNetworkSyncActions';
import { FullNetworkSyncActions } from './NetworkSyncActions/FullNetworkSyncActions';
import { useNetworkSyncActions } from './NetworkSyncActions/useNetworkSyncActions';
import type { NetworkSyncActionsProps } from './NetworkSyncActions/types';

export type { NetworkSyncActionsProps } from './NetworkSyncActions/types';

export const NetworkSyncActions: React.FC<NetworkSyncActionsProps> = ({
  network,
  walletCount,
  className = '',
  compact = false,
  onSyncStarted,
}) => {
  const actions = useNetworkSyncActions({
    network,
    walletCount,
    onSyncStarted,
  });

  if (compact) {
    return (
      <CompactNetworkSyncActions
        className={className}
        walletCount={walletCount}
        {...actions}
      />
    );
  }

  return (
    <FullNetworkSyncActions
      className={className}
      walletCount={walletCount}
      {...actions}
    />
  );
};

export default NetworkSyncActions;
