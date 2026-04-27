import { Check, AlertTriangle, RefreshCw } from 'lucide-react';
import type { Wallet } from '../../types';
import type { SyncRetryInfo } from './types';

interface WalletSyncStatusBadgeProps {
  wallet: Wallet;
  syncing: boolean;
  syncRetryInfo: SyncRetryInfo | null;
}

export function WalletSyncStatusBadge({
  wallet,
  syncing,
  syncRetryInfo,
}: WalletSyncStatusBadgeProps) {
  if (wallet.lastSyncStatus === 'retrying' || syncRetryInfo) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20" title={syncRetryInfo?.error || 'Sync failed, retrying...'}>
        <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Retrying {syncRetryInfo?.retryCount || 1}/{syncRetryInfo?.maxRetries || 3}
      </span>
    );
  }

  if (syncing || wallet.syncInProgress) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-500/20 dark:text-amber-200 dark:border-amber-400/30">
        <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> Syncing
      </span>
    );
  }

  if (wallet.lastSyncStatus === 'success') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-700 border border-success-200 dark:bg-success-500/10 dark:text-success-300 dark:border-success-500/20" title={wallet.lastSyncedAt ? `Last synced: ${new Date(wallet.lastSyncedAt).toLocaleString()}` : ''}>
        <Check className="w-3 h-3 mr-1" /> Synced
      </span>
    );
  }

  if (wallet.lastSyncStatus === 'failed') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/20" title="Last sync failed">
        <AlertTriangle className="w-3 h-3 mr-1" /> Failed
      </span>
    );
  }

  if (wallet.lastSyncedAt) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-sanctuary-100 text-sanctuary-600 border border-sanctuary-200 dark:bg-sanctuary-800 dark:text-sanctuary-400 dark:border-sanctuary-700" title={`Last synced: ${new Date(wallet.lastSyncedAt).toLocaleString()}`}>
        <Check className="w-3 h-3 mr-1" /> Cached
      </span>
    );
  }

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning-100 text-warning-700 border border-warning-200 dark:bg-warning-500/10 dark:text-warning-300 dark:border-warning-500/20" title="Never synced">
      <AlertTriangle className="w-3 h-3 mr-1" /> Not Synced
    </span>
  );
}
