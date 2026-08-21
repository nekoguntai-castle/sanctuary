import type { SyncExecutionOwner } from '@sanctuary/shared/constants/sync';

export interface PersistedRetryState {
  lastSyncStatus?: string | null;
  syncExecutionOwner?: SyncExecutionOwner | null;
  syncRetryCount?: number | null;
}

/**
 * Return the retry count consumed by an interrupted inline retry ladder.
 * Worker retries are durable in BullMQ and must never be resumed by the API
 * process. Invalid legacy values fail closed to a fresh ladder.
 */
export function resumeRetryCount(
  wallet: PersistedRetryState | null | undefined,
  maxAttempts: number,
): number {
  if (
    !wallet
    || wallet.lastSyncStatus !== 'retrying'
    || wallet.syncExecutionOwner !== 'inline'
  ) {
    return 0;
  }

  const count = wallet.syncRetryCount;
  if (!Number.isInteger(count) || count === undefined || count === null || count < 1) {
    return 0;
  }
  return Math.min(count, Math.max(0, maxAttempts));
}
