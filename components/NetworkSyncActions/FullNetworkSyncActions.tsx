import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { NetworkSyncResult } from './NetworkSyncResult';
import { ResyncConfirmationDialog } from './ResyncConfirmationDialog';
import {
  getFullResyncButtonClassName,
  getFullSyncButtonClassName,
  getResyncIconClassName,
  getSyncIconClassName,
} from './networkSyncStyles';
import type { NetworkSyncActionState } from './types';

interface FullNetworkSyncActionsProps extends NetworkSyncActionState {
  className: string;
  walletCount: number;
}

export const FullNetworkSyncActions: React.FC<FullNetworkSyncActionsProps> = ({
  className,
  walletCount,
  networkLabel,
  syncing,
  resyncing,
  showResyncDialog,
  result,
  isDisabled,
  handleSyncAll,
  handleResyncAll,
  openResyncDialog,
  closeResyncDialog,
}) => (
  <div className={className}>
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={handleSyncAll}
        disabled={isDisabled || syncing || resyncing}
        className={getFullSyncButtonClassName({ isDisabled, syncing })}
      >
        <RefreshCw className={getSyncIconClassName(syncing, 'mr-2')} />
        {syncing ? 'Syncing...' : `Sync All ${networkLabel}`}
      </button>

      <button
        type="button"
        onClick={openResyncDialog}
        disabled={isDisabled || syncing || resyncing}
        className={getFullResyncButtonClassName({ isDisabled, resyncing })}
      >
        <AlertTriangle className={getResyncIconClassName(resyncing, 'mr-2')} />
        {resyncing ? 'Resyncing...' : `Full Resync All ${networkLabel}`}
      </button>

      <NetworkSyncResult result={result} />
    </div>

    {showResyncDialog && (
      <ResyncConfirmationDialog
        networkLabel={networkLabel}
        walletCount={walletCount}
        onCancel={closeResyncDialog}
        onConfirm={handleResyncAll}
      />
    )}
  </div>
);
