/**
 * Lock Coordination
 *
 * Distributed lock acquisition, refresh, and release for ensuring
 * only one process owns Electrum subscriptions at a time.
 */

import { createLogger } from '../../utils/logger';
import { acquireLock, extendLock, releaseLock, type DistributedLock } from '../../infrastructure';
import {
  ELECTRUM_SUBSCRIPTION_LOCK_KEY,
  ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS,
  ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS,
} from './types';

const log = createLogger('WORKER:ELECTRUM_LOCK');

/**
 * Attempt to acquire the Electrum subscription lock.
 * Returns the lock if acquired, null otherwise.
 */
export async function acquireSubscriptionLock(): Promise<DistributedLock | null> {
  const lock = await acquireLock(ELECTRUM_SUBSCRIPTION_LOCK_KEY, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
  if (lock) {
    log.info('Acquired Electrum subscription ownership');
  } else {
    log.warn('Electrum subscriptions already owned by another process, skipping startup');
  }
  return lock;
}

/**
 * Start periodic lock refresh. Calls onLockLost if the lock cannot be extended.
 */
export function startLockRefresh(
  getLock: () => DistributedLock | null,
  setLock: (lock: DistributedLock | null) => void,
  onLockLost: () => Promise<void>
): NodeJS.Timeout {
  let refreshInFlight = false;
  const timer = setInterval(async () => {
    if (refreshInFlight) return;
    const lock = getLock();
    if (!lock) return;

    refreshInFlight = true;
    try {
      let refreshed: DistributedLock | null;
      try {
        refreshed = await extendLock(lock, ELECTRUM_SUBSCRIPTION_LOCK_TTL_MS);
      } catch (error) {
        log.error('Electrum subscription lock refresh failed; stopping manager', {
          error: error instanceof Error ? error.message : String(error),
        });
        refreshed = null;
      }

      const currentLock = getLock();
      const stillOwnsRefreshEpoch = currentLock?.key === lock.key
        && currentLock.token === lock.token;
      if (!stillOwnsRefreshEpoch) return;

      if (!refreshed) {
        log.warn('Lost Electrum subscription lock, stopping manager');
        setLock(null);
        clearInterval(timer);
        await onLockLost();
        return;
      }

      setLock(refreshed);
    } finally {
      refreshInFlight = false;
    }
  }, ELECTRUM_SUBSCRIPTION_LOCK_REFRESH_MS);

  timer.unref?.();
  return timer;
}

/**
 * Release the subscription lock and stop refresh timer.
 */
export async function releaseSubscriptionLock(
  lock: DistributedLock | null,
  refreshTimer: NodeJS.Timeout | null
): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }
  if (lock) {
    await releaseLock(lock);
  }
}
