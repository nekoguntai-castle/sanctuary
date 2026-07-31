/**
 * Processes jobs with optional distributed-lock ownership.
 *
 * A cooperative AbortSignal lets handlers stop at safe boundaries. Definitive
 * ownership loss is stronger: the process terminates synchronously because an
 * arbitrary JavaScript promise cannot be cancelled safely.
 */

import { DelayedError, type Job } from 'bullmq';
import {
  acquireLock,
  extendLock,
  releaseLock,
  type DistributedLock,
} from '../../infrastructure/distributedLock';
import { createLogger } from '../../utils/logger';
import type { JobExecutionContext } from '../jobs/types';
import { hardTerminateProcess, type HardTerminate } from './hardTermination';
import type { RegisteredHandler } from './types';

const log = createLogger('WORKER:QUEUE_PROCESSOR');
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;

// Legal paths are owned -> settling -> settled for normal completion and
// owned -> lost for fatal ownership loss. Only settling may release a token.
type OwnershipState = 'owned' | 'settling' | 'lost' | 'settled';

export interface JobProcessorDependencies {
  hardTerminate?: HardTerminate;
  shutdownSignal?: AbortSignal;
  lockOperations?: {
    acquire: typeof acquireLock;
    extend: typeof extendLock;
    release: typeof releaseLock;
  };
}

class LockOwnershipLostError extends Error {
  constructor(handlerKey: string, jobId: string | undefined, cause?: unknown) {
    super(`Lock lost for ${handlerKey} (job ${jobId}). Worker is terminating.`);
    this.name = 'LockOwnershipLostError';
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}

interface FatalSignal {
  promise: Promise<never>;
  reject: (error: Error) => void;
}

function createFatalSignal(): FatalSignal {
  let rejectFatal: ((error: Error) => void) | undefined;
  const promise = new Promise<never>((_, reject) => {
    rejectFatal = reject;
  });
  return {
    promise,
    reject: (error) => rejectFatal?.(error),
  };
}

function createExecutionContext(controller: AbortController): JobExecutionContext {
  return {
    signal: controller.signal,
    throwIfAborted: () => controller.signal.throwIfAborted(),
  };
}

function createExecutionController(shutdownSignal?: AbortSignal): {
  controller: AbortController;
  detach: () => void;
} {
  const controller = new AbortController();
  if (!shutdownSignal) {
    return { controller, detach: () => undefined };
  }

  const abortForShutdown = () => controller.abort(shutdownSignal.reason);
  if (shutdownSignal.aborted) {
    abortForShutdown();
    return { controller, detach: () => undefined };
  }
  shutdownSignal.addEventListener('abort', abortForShutdown, { once: true });
  return {
    controller,
    detach: () => shutdownSignal.removeEventListener('abort', abortForShutdown),
  };
}

/**
 * Process a job with optional distributed locking.
 */
export async function processJobWithLock(
  handlerKey: string,
  registered: RegisteredHandler,
  job: Job,
  dependencies: JobProcessorDependencies = {},
): Promise<unknown> {
  if (!registered.lockOptions) {
    const executionController = createExecutionController(dependencies.shutdownSignal);
    const { controller } = executionController;
    try {
      return await Promise.resolve().then(
        () => registered.handler(job, createExecutionContext(controller))
      );
    } finally {
      executionController.detach();
    }
  }

  const lockKey = registered.lockOptions.lockKey(job.data);
  const lockTtlMs = registered.lockOptions.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  if (!Number.isInteger(lockTtlMs) || lockTtlMs < 2) {
    throw new Error(`Lock TTL for ${handlerKey} must be an integer of at least 2ms`);
  }
  const lockOperations = dependencies.lockOperations ?? {
    acquire: acquireLock,
    extend: extendLock,
    release: releaseLock,
  };
  let lock = await lockOperations.acquire(lockKey, { ttlMs: lockTtlMs });
  if (!lock) {
    log.debug(`Skipping job - lock held: ${handlerKey}`, { jobId: job.id, lockKey });
    const retryDelayMs = registered.lockOptions.retryDelayMsIfUnavailable?.(job.data);
    if (retryDelayMs !== null && retryDelayMs !== undefined) {
      await job.moveToDelayed(Date.now() + retryDelayMs, job.token);
      throw new DelayedError();
    }
    return { skipped: true, reason: 'lock_held' };
  }

  const executionController = createExecutionController(dependencies.shutdownSignal);
  const { controller } = executionController;
  const execution = createExecutionContext(controller);
  const fatal = createFatalSignal();
  const hardTerminate = dependencies.hardTerminate ?? hardTerminateProcess;
  // Refresh near one-third of the TTL, clamped strictly below even very short
  // test TTLs so the first refresh cannot be scheduled at or after expiry.
  const refreshIntervalMs = Math.max(1, Math.min(lockTtlMs - 1, Math.floor(lockTtlMs / 3)));
  let state: OwnershipState = 'owned';
  let refreshTimer: NodeJS.Timeout | null = null;
  let refreshInFlight: Promise<void> | null = null;

  const stopRefreshTimer = (): void => {
    if (!refreshTimer) return;
    clearTimeout(refreshTimer);
    refreshTimer = null;
  };

  const loseOwnership = (cause?: unknown): never => {
    const error = new LockOwnershipLostError(handlerKey, job.id, cause);
    state = 'lost';
    lock = null;
    stopRefreshTimer();
    controller.abort(error);
    fatal.reject(error);
    log.error(`Lost distributed lock; terminating worker: ${handlerKey}`, {
      jobId: job.id,
      lockKey,
      error: cause instanceof Error ? cause.message : cause === undefined ? undefined : String(cause),
    });
    hardTerminate(1);
    throw error;
  };

  const refreshOwnership = async (): Promise<void> => {
    let refreshed: DistributedLock | null = null;
    try {
      // A refresh is only started while ownership and a lock token are present.
      const ownedLock = lock as DistributedLock;
      refreshed = await lockOperations.extend(ownedLock, lockTtlMs);
    } catch (error) {
      if (state === 'owned') {
        loseOwnership(error);
      }
      lock = null;
      return;
    }

    if (!refreshed) {
      if (state === 'owned') {
        loseOwnership();
      }
      lock = null;
      return;
    }
    lock = refreshed;
  };

  const scheduleRefresh = (): void => {
    if (state !== 'owned') return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (state !== 'owned' || refreshInFlight) return;
      refreshInFlight = refreshOwnership();
      void refreshInFlight
        .catch(() => undefined)
        .finally(() => {
          refreshInFlight = null;
          scheduleRefresh();
        });
    }, refreshIntervalMs);
    refreshTimer.unref?.();
  };

  scheduleRefresh();
  const handlerPromise = Promise.resolve().then(() => registered.handler(job, execution));

  try {
    return await Promise.race([handlerPromise, fatal.promise]);
  } finally {
    try {
      stopRefreshTimer();

      if (state === 'owned') {
        state = 'settling';
      }

      if (state === 'settling' && refreshInFlight) {
        await refreshInFlight;
      }

      if (state === 'settling' && lock) {
        const ownedLock = lock;
        state = 'settled';
        lock = null;
        await lockOperations.release(ownedLock);
      }
    } finally {
      executionController.detach();
    }
  }
}
