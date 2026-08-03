import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import type { WalletCellProps, WalletWithPending } from './types';

function SyncStatusIndicator({ wallet }: { wallet: WalletWithPending }) {
  if (wallet.syncInProgress) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-primary-600 dark:text-primary-400">
        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
        Syncing
      </span>
    );
  }
  if (wallet.lastSyncStatus === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success-600 dark:text-success-400">
        <CheckCircle className="w-3.5 h-3.5" />
        Synced
      </span>
    );
  }
  if (wallet.lastSyncStatus === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-rose-600 dark:text-rose-400">
        <AlertCircle className="w-3.5 h-3.5" />
        Failed
      </span>
    );
  }
  if (wallet.lastSyncStatus === 'retrying') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
        <RefreshCw className="w-3.5 h-3.5" />
        Retrying
      </span>
    );
  }
  if (wallet.lastSyncStatus === 'partial') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-warning-600 dark:text-warning-400">
        <Clock className="w-3.5 h-3.5" />
        Partial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-sanctuary-400">
      <Clock className="w-3.5 h-3.5" />
      Pending
    </span>
  );
}

export function SyncCell({ item: wallet }: WalletCellProps) {
  return <SyncStatusIndicator wallet={wallet} />;
}
