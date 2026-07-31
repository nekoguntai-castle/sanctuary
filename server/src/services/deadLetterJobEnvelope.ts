import type { SyncWalletJobData } from '../worker/jobs/types';
import type { DeadLetterJobEnvelope } from './deadLetterQueueTypes';
import { isFullResyncGeneration } from '../constants/fullResync';

const SYNC_PRIORITIES = new Set(['low', 'normal', 'high']);
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Validate the only persisted job envelope currently allowed to re-enter BullMQ. */
export function isSyncWalletEnvelope(
  envelope: DeadLetterJobEnvelope,
): envelope is DeadLetterJobEnvelope & { data: SyncWalletJobData } {
  if (!isRecord(envelope.options) || !isRecord(envelope.data)) return false;
  const walletId = envelope.data.walletId;
  const reason = envelope.data.reason;
  const priority = envelope.data.priority;
  const fullResync = envelope.data.fullResync;
  const fullResyncGeneration = envelope.data.fullResyncGeneration;
  const validFullResyncPair = fullResync === true
    ? isFullResyncGeneration(fullResyncGeneration)
    : fullResyncGeneration === undefined;
  const checks = [
    envelope.version === 1,
    envelope.queue === 'sync',
    envelope.name === 'sync-wallet',
    typeof walletId === 'string' && walletId.trim().length > 0,
    reason === undefined || typeof reason === 'string',
    priority === undefined || SYNC_PRIORITIES.has(String(priority)),
    fullResync === undefined || typeof fullResync === 'boolean',
    validFullResyncPair,
  ];
  return checks.every(Boolean);
}
