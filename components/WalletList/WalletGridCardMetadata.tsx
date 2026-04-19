import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { getQuorumM } from '../../types';
import type { Wallet } from '../../src/api/wallets';

export function WalletMetadata({ wallet }: { wallet: Wallet }) {
  const deviceCount = wallet.deviceCount ?? 0;

  return (
    <div className="flex items-center justify-between text-xs border-t border-sanctuary-100 dark:border-sanctuary-800 pt-3 mt-2">
      <div className="flex items-center text-sanctuary-500">
        <span className="text-sanctuary-400 capitalize">{(wallet.scriptType ?? '').replace('_', ' ')}</span>
        <span className="mx-2 text-sanctuary-300">•</span>
        <span className="text-sanctuary-400">{deviceCount} device{deviceCount !== 1 ? 's' : ''}</span>
        {wallet.quorum && wallet.totalSigners && (
          <>
            <span className="mx-2 text-sanctuary-300">•</span>
            <span className="text-sanctuary-400">{getQuorumM(wallet.quorum)} of {wallet.totalSigners}</span>
          </>
        )}
      </div>
      <SyncStatusIcon wallet={wallet} />
    </div>
  );
}

function SyncStatusIcon({ wallet }: { wallet: Wallet }) {
  if (wallet.syncInProgress) {
    return <span title="Syncing"><RefreshCw className="w-3.5 h-3.5 text-primary-500 animate-spin" /></span>;
  }

  if (wallet.lastSyncStatus === 'success') {
    return <span title="Synced"><CheckCircle className="w-3.5 h-3.5 text-success-500" /></span>;
  }

  if (wallet.lastSyncStatus === 'failed') {
    return <span title="Sync failed"><AlertCircle className="w-3.5 h-3.5 text-rose-500" /></span>;
  }

  if (wallet.lastSyncStatus === 'retrying') {
    return <span title="Retrying"><RefreshCw className="w-3.5 h-3.5 text-amber-500" /></span>;
  }

  return <span title="Pending sync"><Clock className="w-3.5 h-3.5 text-sanctuary-400" /></span>;
}
