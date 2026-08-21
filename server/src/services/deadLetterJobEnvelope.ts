import {
  isSyncWalletJobData,
  SYNC_QUEUE_NAME,
  SYNC_WALLET_JOB_NAME,
  type SyncWalletJobData,
} from '../jobs/syncJobContract';
import type { DeadLetterJobEnvelope } from './deadLetterQueueTypes';
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the only persisted job envelope currently allowed to re-enter BullMQ. */
export function isSyncWalletEnvelope(
  envelope: DeadLetterJobEnvelope,
): envelope is DeadLetterJobEnvelope & { data: SyncWalletJobData } {
  if (!isRecord(envelope.options) || !isRecord(envelope.data)) return false;
  const checks = [
    envelope.version === 1,
    envelope.queue === SYNC_QUEUE_NAME,
    envelope.name === SYNC_WALLET_JOB_NAME,
    isSyncWalletJobData(envelope.data),
  ];
  return checks.every(Boolean);
}
