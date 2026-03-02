/**
 * Job Processor
 *
 * Processes individual jobs with optional distributed locking support.
 * When a distributed lock is configured, the lock is refreshed periodically.
 * If the lock is lost (Redis blip, TTL expiry), the job is aborted and will
 * be retried by BullMQ, preventing two workers from running the same job.
 */

import type { Job } from 'bullmq';
import {
  acquireLock,
  extendLock,
  releaseLock,
  type DistributedLock,
} from '../../infrastructure/distributedLock';
import { createLogger } from '../../utils/logger';
import type { RegisteredHandler } from './types';

const log = createLogger('WorkerQueue');

/**
 * Process a job with optional distributed locking.
 */
export async function processJobWithLock(
  handlerKey: string,
  registered: RegisteredHandler,
  job: Job,
): Promise<unknown> {
  let lock: DistributedLock | null = null;
  let lockRefreshTimer: NodeJS.Timeout | null = null;
  // When the lock is lost, this callback rejects the handler promise
  let onLockLost: (() => void) | null = null;

  const stopLockRefresh = () => {
    if (lockRefreshTimer) {
      clearInterval(lockRefreshTimer);
      lockRefreshTimer = null;
    }
  };

  const startLockRefresh = (lockTtlMs: number) => {
    // Refresh well before expiry to prevent lock loss during long-running jobs.
    const refreshIntervalMs = Math.max(1000, Math.floor(lockTtlMs / 3));

    lockRefreshTimer = setInterval(async () => {
      if (!lock) {
        return;
      }

      const currentLockKey = lock.key;

      try {
        const refreshed = await extendLock(lock, lockTtlMs);
        if (refreshed) {
          lock = refreshed;
          return;
        }

        log.warn(`Lost distributed lock, aborting job: ${handlerKey}`, {
          jobId: job.id,
          lockKey: currentLockKey,
        });
        lock = null; // Prevent release in finally block
        stopLockRefresh();
        onLockLost?.();
      } catch (error) {
        log.warn(`Failed to refresh distributed lock, aborting job: ${handlerKey}`, {
          jobId: job.id,
          lockKey: currentLockKey,
          error: error instanceof Error ? error.message : String(error),
        });
        lock = null;
        stopLockRefresh();
        onLockLost?.();
      }
    }, refreshIntervalMs);

    lockRefreshTimer.unref?.();
  };

  try {
    // Acquire lock if configured
    if (registered.lockOptions) {
      const lockKey = registered.lockOptions.lockKey(job.data);
      const lockTtlMs = registered.lockOptions.lockTtlMs ?? 5 * 60 * 1000; // 5 min default

      lock = await acquireLock(lockKey, { ttlMs: lockTtlMs });

      if (!lock) {
        log.debug(`Skipping job - lock held: ${handlerKey}`, {
          jobId: job.id,
          lockKey,
        });
        // Return without error - another worker is handling this
        return { skipped: true, reason: 'lock_held' };
      }

      startLockRefresh(lockTtlMs);

      // Race the handler against lock loss
      const lockLostPromise = new Promise<never>((_, reject) => {
        onLockLost = () => reject(new Error(`Lock lost for ${handlerKey} (job ${job.id}). Job will be retried.`));
      });

      return await Promise.race([
        registered.handler(job),
        lockLostPromise,
      ]);
    }

    // No lock configured — just run the handler
    return await registered.handler(job);
  } finally {
    stopLockRefresh();
    onLockLost = null; // Prevent stale rejection after handler completes

    // Always release lock if we still hold one
    if (lock) {
      await releaseLock(lock);
    }
  }
}
