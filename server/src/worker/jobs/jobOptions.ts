import type { JobsOptions } from 'bullmq';
import { getConfig } from '../../config';

export const SYNC_WALLET_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

/**
 * Lock TTL for a wallet sync: one full sync plus a minute of slack. It also
 * bounds every key that must not outlive a single sync attempt.
 */
export function getSyncLockTtlMs(): number {
  return getConfig().sync.maxSyncDurationMs + 60_000;
}
