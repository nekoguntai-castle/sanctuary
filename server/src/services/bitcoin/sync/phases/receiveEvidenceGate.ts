import type { SyncContext } from '../types';
import { ReceiveEvidenceRetryableError } from '../types';
import { summariseRejectedEvidence } from '../rejectedEvidence';

/**
 * Runs after accepted transaction/UTXO siblings have been persisted. A remote
 * contradiction remains retryable and must not be reported as a healthy sync.
 *
 * The thrown message carries the rejection reasons, because this error is the
 * only part of the failure that crosses the process boundary into
 * `wallets.lastSyncError`. The per-rejection warn logs live in whichever
 * process ran the sync, and for a worker-run sync the API's log endpoint cannot
 * reach them at all.
 */
export async function receiveEvidenceGatePhase(ctx: SyncContext): Promise<SyncContext> {
  if (ctx.rejectedEvidenceCount > 0) {
    throw new ReceiveEvidenceRetryableError(
      ctx.rejectedEvidenceCount,
      summariseRejectedEvidence(ctx.rejectedEvidenceReasons),
    );
  }
  return ctx;
}
