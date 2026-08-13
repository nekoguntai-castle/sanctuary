import type { SyncContext } from '../types';
import { ReceiveEvidenceRetryableError } from '../types';

/**
 * Runs after accepted transaction/UTXO siblings have been persisted. A remote
 * contradiction remains retryable and must not be reported as a healthy sync.
 */
export async function receiveEvidenceGatePhase(ctx: SyncContext): Promise<SyncContext> {
  if (ctx.rejectedEvidenceCount > 0) {
    throw new ReceiveEvidenceRetryableError(ctx.rejectedEvidenceCount);
  }
  return ctx;
}
