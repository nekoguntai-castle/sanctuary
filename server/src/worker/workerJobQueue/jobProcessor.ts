/**
 * Processes jobs with optional distributed-lock ownership.
 *
 * A cooperative AbortSignal lets handlers stop at safe boundaries. Definitive
 * ownership loss is stronger: the process terminates synchronously because an
 * arbitrary JavaScript promise cannot be cancelled safely.
 */

import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import {
  acquireLock,
  extendLock,
  releaseLock,
  type DistributedLock,
} from '../../infrastructure/distributedLock';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { JobExecutionContext } from '../../jobs/types';
import { hardTerminateProcess, type HardTerminate } from './hardTermination';
import {
  repeatedlyStalledJobMessage,
  stalledLockHeldJobMessage,
  unrecoverableJobPayloadMessage,
} from './jobFailureClassification';
import type { RegisteredHandler } from './types';

const log = createLogger('WORKER:QUEUE_PROCESSOR');
const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1000;
/** Consecutive stalled deliveries after which a job is treated as a crash loop. */
export const MAX_UNFINISHED_DELIVERIES = 2;
// BullMQ never advances attemptsMade for a DelayedError, so the queue itself
// remembers nothing about how long a job has been bouncing off a held lock.
// The job's own enqueue timestamp is the honest clock: it needs no payload
// mutation, survives DLQ replay, and cannot be left stale by a later attempt.

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

class LockRetryBudgetExhaustedError extends Error {
  constructor(handlerKey: string, lockKey: string, retryWindowMs: number) {
    super(
      `Lock ${lockKey} for ${handlerKey} stayed held for the whole ${retryWindowMs}ms ` +
      'retry budget; failing the job so it can finalize.'
    );
    this.name = 'LockRetryBudgetExhaustedError';
  }
}

/** Best-effort: job payloads are only conventionally wallet-scoped. */
function readWalletId(data: unknown): string | undefined {
  const walletId = (data as { walletId?: unknown } | null | undefined)?.walletId;
  return typeof walletId === 'string' ? walletId : undefined;
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

function createExecutionContext(
  controller: AbortController,
  resolveAcquiredLock?: () => JobExecutionContext['acquiredLock'],
): JobExecutionContext {
  const context: JobExecutionContext = {
    signal: controller.signal,
    throwIfAborted: () => controller.signal.throwIfAborted(),
  };
  if (resolveAcquiredLock) {
    Object.defineProperty(context, 'acquiredLock', {
      enumerable: true,
      get: resolveAcquiredLock,
    });
  }
  return context;
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
 * How many deliveries before this one started but never finished.
 *
 * BullMQ counts a start on every delivery but an attempt only when one ends
 * (fails or completes), so each delivery whose worker died leaves starts one
 * further ahead. `stalledCounter` alone cannot tell this: BullMQ never resets
 * it, so a job that stalled once and later failed normally still carries it.
 *
 * Only exact for jobs that never re-delay themselves on lock contention:
 * `job.moveToDelayed` skips the attempt count, so callers must exclude jobs
 * with `retryDelayMsIfUnavailable`.
 */
function unfinishedPriorDeliveries(job: Job): number {
  if (!(job.stalledCounter > 0)) return 0;
  const started = job.attemptsStarted;
  const made = job.attemptsMade;
  if (!Number.isInteger(started) || !Number.isInteger(made)) return 0;
  return Math.max(0, started - made - 1);
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
  if (registered.validateData && !registered.validateData(job.data)) {
    throw new UnrecoverableError(unrecoverableJobPayloadMessage(handlerKey));
  }
  // Jobs that re-delay on lock contention skew the delivery count; they wait
  // for their lock instead, and BullMQ fails them at its own stall limit.
  const unfinishedDeliveries = registered.lockOptions?.retryDelayMsIfUnavailable
    ? 0
    : unfinishedPriorDeliveries(job);
  if (unfinishedDeliveries >= MAX_UNFINISHED_DELIVERIES) {
    // BullMQ never fails a repeatable job at its stall limit, so a job that
    // crashes its worker would otherwise be re-run after every restart.
    log.error(`Job stalled on consecutive deliveries - failing it: ${handlerKey}`, {
      jobId: job.id,
      unfinishedDeliveries,
    });
    throw new UnrecoverableError(repeatedlyStalledJobMessage(handlerKey, unfinishedDeliveries));
  }
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

  if (registered.lockOptions.beforeLockAttempt) {
    const preLockCompletion = await registered.lockOptions.beforeLockAttempt(job);
    if (preLockCompletion?.complete) return preLockCompletion.result;
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
    const walletId = readWalletId(job.data);
    const retryDelayMs = registered.lockOptions.retryDelayMsIfUnavailable?.(job.data);
    if (retryDelayMs !== null && retryDelayMs !== undefined) {
      const configuredWindow = registered.lockOptions.maxLockRetryWindowMs;
      const retryWindowMs = typeof configuredWindow === 'function'
        ? configuredWindow(job.data)
        : configuredWindow ?? lockTtlMs;
      // Measured from when the job was enqueued, not from a counter in the
      // payload: a counter is never reset once the lock is finally acquired, so
      // a job that contends, runs, fails and is retried would start its next
      // attempt with a spent budget - and it would ride into the DLQ and back.
      const retryStartedAt = registered.lockOptions.resolveLockRetryStartedAt
        ? await registered.lockOptions.resolveLockRetryStartedAt(job)
        : job.timestamp;
      const waitedMs = Math.max(0, Date.now() - retryStartedAt);
      if (waitedMs >= retryWindowMs) {
        log.error(`Lock retry budget exhausted - failing job: ${handlerKey}`, {
          jobId: job.id,
          lockKey,
          walletId,
          waitedMs,
          retryWindowMs,
        });
        const exhausted = new LockRetryBudgetExhaustedError(handlerKey, lockKey, retryWindowMs);
        try {
          const attempts = typeof job.opts.attempts === 'number' ? job.opts.attempts : 1;
          await registered.lockOptions.onLockRetryBudgetExhausted?.(job.data, {
            lockKey,
            retryWindowMs,
            message: exhausted.message,
            isFinalAttempt: job.attemptsMade + 1 >= attempts,
          });
        } catch (error) {
          // Recording the outcome is bookkeeping. Failing the job is what
          // releases the deduplication key, so it happens either way.
          log.error(`Failed to record lock retry budget exhaustion: ${handlerKey}`, {
            jobId: job.id,
            lockKey,
            walletId,
            error: getErrorMessage(error),
          });
        }
        throw exhausted;
      }
      log.debug(`Delaying job - lock held: ${handlerKey}`, {
        jobId: job.id,
        lockKey,
        walletId,
        waitedMs,
        retryWindowMs,
      });
      await job.moveToDelayed(Date.now() + retryDelayMs, job.token);
      throw new DelayedError();
    }
    if (unfinishedDeliveries > 0) {
      // BullMQ redelivered this job because the previous delivery's worker
      // stopped renewing it, and that attempt still holds the lock: its worker
      // crashed, or blocked its event loop past the job lock. Skipping would
      // mark the job completed and erase the failure; re-running one that
      // crashed its worker would crash it again. Fail it terminally so the
      // failure is recorded in the dead-letter queue. A recurring job's next
      // scheduled run proceeds normally once the lock expires.
      log.error(`Stalled job found its lock still held - failing it: ${handlerKey}`, {
        jobId: job.id,
        lockKey,
        walletId,
        unfinishedDeliveries,
      });
      throw new UnrecoverableError(stalledLockHeldJobMessage(handlerKey, lockKey));
    }
    // The job resolves having done nothing, so this is the only record that the
    // wallet was passed over.
    log.warn(`Skipping job - lock held: ${handlerKey}`, { jobId: job.id, lockKey, walletId });
    return { skipped: true, reason: 'lock_held' };
  }

  const executionController = createExecutionController(dependencies.shutdownSignal);
  const { controller } = executionController;
  const fatal = createFatalSignal();
  const hardTerminate = dependencies.hardTerminate ?? hardTerminateProcess;
  // Refresh near one-third of the TTL, clamped strictly below even very short
  // test TTLs so the first refresh cannot be scheduled at or after expiry.
  const refreshIntervalMs = Math.max(1, Math.min(lockTtlMs - 1, Math.floor(lockTtlMs / 3)));
  let state: OwnershipState = 'owned';
  let refreshTimer: NodeJS.Timeout | null = null;
  let refreshInFlight: Promise<void> | null = null;
  const acquiredLockProof = Object.freeze({ key: lockKey, token: lock.token });
  const execution = createExecutionContext(
    controller,
    () => state === 'owned' && lock !== null ? acquiredLockProof : undefined,
  );

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
