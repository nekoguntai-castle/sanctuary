import { AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react';
import { getQuorumM } from '../../types';
import { Tooltip } from '../ui/Tooltip';
import { getWalletSyncPresentation } from '../../utils/walletSyncPresentation';
import type { Wallet } from '../../api/wallets';

export function WalletMetadata({ wallet, syncNow }: { wallet: Wallet; syncNow?: number }) {
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
      <SyncStatusIcon wallet={wallet} syncNow={syncNow} />
    </div>
  );
}

function SyncStatusIcon({ wallet, syncNow }: { wallet: Wallet; syncNow?: number }) {
  const presentation = getWalletSyncPresentation(wallet, null, syncNow);

  // States with something to explain get a focusable tooltip carrying the real
  // reason; the healthy ones keep the cheap native title. A grid card is icon
  // only, so without this the reason had nowhere at all to appear.
  if (presentation.reason) {
    return (
      <Tooltip
        content={presentation.reason}
        label={`Sync status: ${presentation.label}`}
        placement="bottom"
      >
        <ReasonIcon tone={presentation.tone} spinning={presentation.spinning} />
      </Tooltip>
    );
  }

  if (presentation.tone === 'syncing') {
    return <span title="Syncing"><RefreshCw className="w-3.5 h-3.5 text-primary-500 animate-spin" /></span>;
  }

  if (presentation.tone === 'success') {
    return <span title="Synced"><CheckCircle className="w-3.5 h-3.5 text-success-500" /></span>;
  }

  return <span title="Pending sync"><Clock className="w-3.5 h-3.5 text-sanctuary-400" /></span>;
}

function ReasonIcon({
  tone,
  spinning,
}: {
  tone: ReturnType<typeof getWalletSyncPresentation>['tone'];
  spinning: boolean;
}) {
  if (tone === 'retrying' || tone === 'resyncing') {
    return (
      <RefreshCw
        className={`w-3.5 h-3.5 text-amber-500 ${spinning ? 'animate-spin' : ''}`}
      />
    );
  }

  if (tone === 'stale' || tone === 'partial' || tone === 'cached') {
    return <Clock className="w-3.5 h-3.5 text-amber-500" />;
  }

  return <AlertCircle className="w-3.5 h-3.5 text-rose-500" />;
}
