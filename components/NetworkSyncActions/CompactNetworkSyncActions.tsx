import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ResyncConfirmationDialog } from './ResyncConfirmationDialog';
import {
  getCompactResyncButtonClassName,
  getCompactSyncButtonClassName,
  getResyncIconClassName,
  getSyncIconClassName,
} from './networkSyncStyles';
import type { NetworkSyncActionState } from './types';

interface CompactNetworkSyncActionsProps extends NetworkSyncActionState {
  className: string;
  walletCount: number;
}

export const CompactNetworkSyncActions: React.FC<CompactNetworkSyncActionsProps> = ({
  className,
  walletCount,
  networkLabel,
  syncing,
  resyncing,
  showResyncDialog,
  isDisabled,
  handleSyncAll,
  handleResyncAll,
  openResyncDialog,
  closeResyncDialog,
}) => (
  <div className={`flex items-center gap-1 ${className}`}>
    <button
      type="button"
      onClick={handleSyncAll}
      disabled={isDisabled || syncing || resyncing}
      title={syncing ? 'Syncing...' : `Sync all ${networkLabel} wallets`}
      className={getCompactSyncButtonClassName({ isDisabled, syncing })}
    >
      <RefreshCw className={getSyncIconClassName(syncing)} />
    </button>
    <button
      type="button"
      onClick={openResyncDialog}
      disabled={isDisabled || syncing || resyncing}
      title={resyncing ? 'Resyncing...' : `Full resync all ${networkLabel} wallets`}
      className={getCompactResyncButtonClassName({ isDisabled, resyncing })}
    >
      <AlertTriangle className={getResyncIconClassName(resyncing)} />
    </button>

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
