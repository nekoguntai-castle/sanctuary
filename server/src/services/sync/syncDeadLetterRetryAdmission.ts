import { classifyStaleWalletScheduleJob } from '../../jobs/staleWalletJobPolicy';
import { isSyncWalletEnvelope } from '../deadLetterJobEnvelope';
import type { DeadLetterJobEnvelope } from '../deadLetterQueueTypes';
import { syncIntentAdmission } from './syncIntentAdmission';

/**
 * Route every operator retry through durable admission. Legacy stale-schedule
 * children are converted into canonical incremental intent instead of
 * resurrecting their raw v1 payload.
 */
export async function retryDeadLetterSyncJob(
  envelope: DeadLetterJobEnvelope,
  retryEntryId: string,
): Promise<boolean> {
  if (!retryEntryId || !isSyncWalletEnvelope(envelope)) return false;
  const staleClassification = classifyStaleWalletScheduleJob({
    name: envelope.name,
    jobId: envelope.jobId,
    data: envelope.data,
  });
  if (staleClassification === 'stale') {
    const result = await syncIntentAdmission.request(envelope.data.walletId, {
      mode: 'explicit_reopen',
    });
    return result.status === 'requested' || result.status === 'merged';
  }
  if (staleClassification === 'indeterminate') return false;

  if (envelope.data.fullResync === true) {
    const result = await syncIntentAdmission.requestFullResync(envelope.data.walletId, {
      reason: `dead-letter-retry:${retryEntryId}`,
    });
    return result.status === 'requested' || result.status === 'merged';
  }

  const result = await syncIntentAdmission.request(envelope.data.walletId, {
    mode: 'explicit_reopen',
  });
  return result.status === 'requested' || result.status === 'merged';
}
