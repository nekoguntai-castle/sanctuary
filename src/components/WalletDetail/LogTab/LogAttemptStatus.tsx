import type {
  WalletSyncControls,
  WalletSyncLifecycleClassification,
} from '../../../utils/walletSyncLifecycle';
import { formatSyncProgressDetails } from './logPresentation';
import type { SyncProgressCheckpoint } from './logPresentation';

export function LogAttemptStatus({
  checkpoint,
  lifecycle,
  controls,
}: {
  checkpoint: SyncProgressCheckpoint | null;
  lifecycle: WalletSyncLifecycleClassification;
  controls: WalletSyncControls;
}) {
  const currentCheckpoint = lifecycle.state === 'running'
    && lifecycle.leaseClaimedAt !== undefined
    && checkpoint
    && checkpoint.timestamp >= lifecycle.leaseClaimedAt;
  if (currentCheckpoint) {
    return (
      <div className="px-4 py-2 border-b border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-950/20 text-xs text-primary-700 dark:text-primary-300" role="status">
        Current attempt: {formatSyncProgressDetails(checkpoint.details)}
      </div>
    );
  }
  if (lifecycle.attentionReason === 'lease_evidence_expired') {
    return (
      <div className="px-4 py-2 border-b border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/20 text-xs text-rose-700 dark:text-rose-300" role="status">
        Lease evidence expired{checkpoint ? '. Last checkpoint is from a prior attempt.' : '.'}
      </div>
    );
  }
  if (controls.requestPending) {
    return (
      <div className="px-4 py-2 border-b border-warning-200 dark:border-warning-800 bg-warning-50 dark:bg-warning-950/20 text-xs text-warning-700 dark:text-warning-600" role="status">
        Attempt stopped; sync request pending{checkpoint ? '. Last checkpoint is from a prior attempt.' : '.'}
      </div>
    );
  }
  if (!checkpoint) return null;
  return (
    <div className="px-4 py-2 border-b border-sanctuary-200 dark:border-sanctuary-800 surface-muted text-xs text-sanctuary-500" role="status">
      Last checkpoint is from a prior attempt: {formatSyncProgressDetails(checkpoint.details)}
    </div>
  );
}
