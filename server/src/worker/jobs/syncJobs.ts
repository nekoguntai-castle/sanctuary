/**
 * Sync Job Definitions
 *
 * Background jobs for wallet synchronization.
 * These jobs handle:
 * - Individual wallet sync
 * - Transaction confirmation updates
 */

import { UnrecoverableError, type Job } from 'bullmq';
import type {
  JobExecutionContext,
  LockRetryBudgetExhaustedDetail,
  WorkerJobHandler,
} from './types';
import type {
  NormalizedSyncWalletJobData,
  SyncWalletJobFields,
  SyncWalletJobData,
  SyncWalletJobResult,
  UpdateAllConfirmationsJobData,
  UpdateConfirmationsJobData,
  UpdateConfirmationsResult,
} from '../../jobs/syncJobContract';
import {
  CONFIRMATIONS_QUEUE_NAME,
  getSyncJobBackoffDelayMs,
  getSyncLockKey,
  getSyncLockRetryDelayMs,
  getSyncLockRetryWindowMs,
  getSyncLockTtlMs,
  hasSupportedSyncJobContractVersion,
  isSyncWalletJobLockData,
  isUpdateAllConfirmationsJobData,
  isUpdateConfirmationsJobData,
  NETWORK_CONFIRMATIONS_JOB_VERSION,
  readSyncWalletJobData,
  readSyncWalletLockContractState,
  SYNC_JOB_CONTRACT_VERSION,
  SYNC_QUEUE_NAME,
  SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
  SYNC_WALLET_JOB_NAME,
  SYNC_WALLET_JOB_OPTIONS,
  UPDATE_ALL_CONFIRMATIONS_JOB_NAME,
  UPDATE_CONFIRMATIONS_JOB_NAME,
} from '../../jobs/syncJobContract';
import { syncIntentRepository, walletRepository } from '../../repositories';
import { syncWallet } from '../../services/bitcoin/blockchain';
import {
  refreshAllPendingConfirmations,
  refreshPendingConfirmations,
  type PendingConfirmationRefreshResult,
} from '../../services/sync/confirmationUpdater';
import { setCachedBlockHeight } from '../../services/bitcoin/blockchain';
import { getConfig } from '../../config';
import { broadcastWalletLog } from '../../websocket/notifications/broadcasts';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { isFullResyncGeneration } from '../../constants/fullResync';
import {
  recordSyncLockContention,
  type PersistedSyncTransition,
} from '../../services/sync/syncAttemptLifecycle';
import { syncLifecyclePublisher } from '../../services/sync/syncLifecyclePublisher';
import { classifyStaleWalletScheduleJob } from '../../jobs/staleWalletJobPolicy';
import {
  executeCanonicalIncrementalSync,
  type CanonicalIncrementalSyncData,
} from './canonicalIncrementalSync';
import { syncIntentAdmission } from '../../services/sync/syncIntentAdmission';

const log = createLogger('JOB:SYNC');

// Keep lock alive beyond expected sync duration to avoid concurrent sync overlap.
const SYNC_LOCK_TTL_MS = getSyncLockTtlMs();
// Tolerate ordinary host-clock drift, but replace a marker farther in the
// future so corrupt data cannot extend the bounded contention window forever.
const SYNC_LOCK_CONTENTION_CLOCK_SKEW_MS = 30_000;

const retiredStaleJobResult = (): SyncWalletJobResult => ({
  version: SYNC_JOB_CONTRACT_VERSION,
  success: false,
  duration: 0,
  error: 'Stale-wallet scheduler work retired',
});

/** Neutralize retained work produced by the removed elapsed-age scheduler. */
function completeRetiredStaleJob(
  job: Job<SyncWalletJobData>,
): SyncWalletJobResult | undefined {
  const classification = classifyStaleWalletScheduleJob({
    name: job.name,
    jobId: job.id,
    data: job.data,
  });
  if (classification === 'preserve') return undefined;
  if (classification === 'indeterminate') {
    throw new UnrecoverableError('Cannot classify retained sync-wallet job identity');
  }
  return retiredStaleJobResult();
}

/** Resolve and durably persist the v2 contention-window start for this attempt. */
export async function resolveSyncLockRetryStartedAt(
  job: Job<SyncWalletJobData>,
): Promise<number> {
  const state = readSyncWalletLockContractState(job.data);
  if (!state || state.version === SYNC_JOB_CONTRACT_VERSION) return job.timestamp;
  const now = Date.now();
  if (
    state.lockContention?.attemptEpoch === job.attemptsMade
    && state.lockContention.firstLockContentionAt <= now + SYNC_LOCK_CONTENTION_CLOCK_SKEW_MS
  ) {
    return state.lockContention.firstLockContentionAt;
  }
  const firstLockContentionAt = now;
  const nextData = {
    ...job.data,
    version: state.version,
    lockContention: {
      firstLockContentionAt,
      attemptEpoch: job.attemptsMade,
    },
  } as SyncWalletJobData;
  await job.updateData(nextData);
  job.data = nextData;
  return firstLockContentionAt;
}

function workerRetryDelayMs(job: Job<SyncWalletJobData>): number {
  return getSyncJobBackoffDelayMs(job.attemptsMade, job.opts?.backoff);
}

function workerRetryState(job: Job<SyncWalletJobData>): {
  retryCount: number;
  nextRetryAt: Date;
} {
  return {
    retryCount: job.attemptsMade + 1,
    nextRetryAt: new Date(Date.now() + workerRetryDelayMs(job)),
  };
}

function workerMaxRetries(job: Job<SyncWalletJobData>): number {
  const totalAttempts = job.opts?.attempts ?? SYNC_WALLET_JOB_OPTIONS.attempts!;
  return Math.max(0, totalAttempts - 1);
}

async function publishWorkerAttemptTransition(
  job: Job<SyncWalletJobData>,
  transition: PersistedSyncTransition,
): Promise<void> {
  if (transition.transition === 'retrying') {
    await syncLifecyclePublisher.publish(transition, {
      maxRetries: workerMaxRetries(job),
    });
    return;
  }
  await syncLifecyclePublisher.publish(transition);
}

function runWorkerSideEffect(description: string, effect: () => unknown): void {
  try {
    effect();
  } catch (error) {
    log.error(`${description} failed`, { error: getErrorMessage(error) });
  }
}

/**
 * Record that the queue gave up waiting for a wallet's sync lock.
 *
 * The re-delay budget is spent before the handler runs, so without this the job
 * fails with nothing written: the wallet keeps whatever badge it had and the
 * only account of the give-up is a worker log the user cannot read.
 *
 * `syncInProgress` is deliberately untouched. It belongs to whoever holds the
 * lock, and clearing it here would false-idle a sync that is genuinely running.
 */
async function recordLockRetryBudgetExhausted(
  data: unknown,
  detail: LockRetryBudgetExhaustedDetail,
): Promise<void> {
  const walletId = (data as SyncWalletJobData | undefined)?.walletId;
  if (typeof walletId !== 'string' || walletId.length === 0) return;

  if (!detail.isFinalAttempt) return;

  // Only one shape of contention is a fault. If another holder is mid-sync it
  // will write its own terminal status, and marking failed would be a false
  // negative. If the lock outlived its holder (a tombstone from an unconfirmed
  // release) nothing else will ever write a status, so record the failure. The
  // write is a CAS on "no sync holds the row", so a sync that claims while this
  // runs keeps its state instead of losing a read-then-write race.
  const transition = await recordSyncLockContention(walletId, {
    error: detail.message,
    isFinalAttempt: detail.isFinalAttempt,
  }, syncIntentRepository.recordLockContentionIfIdle);
  if (!transition) {
    // Either a running sync owns the row (the CAS missed) or the write failed
    // after retries, which persistLifecycleWrite has already logged as an error.
    log.warn(`Did not record lock contention for wallet ${walletId}; a running sync holds it or the write failed`, {
      lockKey: detail.lockKey,
      retryWindowMs: detail.retryWindowMs,
    });
    return;
  }

  log.error(`Gave up queueing sync for wallet ${walletId}`, {
    lockKey: detail.lockKey,
    retryWindowMs: detail.retryWindowMs,
  });

  await syncLifecyclePublisher.publish(transition);
  runWorkerSideEffect('Lock contention log publication', () => {
    broadcastWalletLog(walletId, {
      level: 'error',
      module: 'SYNC',
      message: `Sync abandoned: ${detail.message}`,
      details: { lockKey: detail.lockKey, retryWindowMs: detail.retryWindowMs },
    });
  });
}

function isFinalAttempt(job: Job<SyncWalletJobData>): boolean {
  const attempts = typeof job.opts?.attempts === 'number'
    ? job.opts.attempts
    : SYNC_WALLET_JOB_OPTIONS.attempts!;
  return job.attemptsMade + 1 >= attempts;
}

function hasDeferredFullResyncGenerationError(data: SyncWalletJobData): boolean {
  if (data.fullResync !== true || isFullResyncGeneration(data.fullResyncGeneration)) {
    return false;
  }
  return readSyncWalletJobData({ ...data, fullResyncGeneration: 1 }) !== null;
}

function isCanonicalIncrementalSyncData(
  data: NormalizedSyncWalletJobData | null,
): data is CanonicalIncrementalSyncData {
  return data !== null
    && (
      data.version === 2
      || data.version === SYNC_WALLET_MUTATION_FENCE_JOB_VERSION
    )
    && 'incrementalSyncGeneration' in data;
}

async function bridgeRetainedSyncWalletJob(
  job: Job<SyncWalletJobData>,
  data: SyncWalletJobFields,
): Promise<SyncWalletJobResult> {
  const result = await syncIntentAdmission.bridgeRetained(data.walletId, {
    fullResync: data.fullResync === true,
    reason: data.reason,
  });
  const accepted = result.status === 'requested' || result.status === 'merged';
  log.info(`Bridged retained sync-wallet job for ${data.walletId}`, {
    fullResync: data.fullResync === true,
    admissionStatus: result.status,
  });
  return {
    version: SYNC_JOB_CONTRACT_VERSION,
    success: accepted,
    duration: 0,
    ...(!accepted && { error: `Retained sync admission ${result.status}` }),
  };
}

class ConfirmationUpdateAggregateError extends Error {
  readonly errors: unknown[];

  constructor(failures: Array<{ walletId: string; error: unknown }>) {
    super(
      `Failed to update confirmations for wallets: ${failures
        .map(({ walletId }) => walletId)
        .join(', ')}`,
    );
    this.name = 'AggregateError';
    this.errors = failures.map(({ error }) => error);
  }
}

// =============================================================================
// Sync Wallet Job
// =============================================================================

/**
 * Sync a single wallet
 *
 * This job:
 * 1. Acquires a distributed lock for the wallet
 * 2. Marks wallet as syncing
 * 3. Executes the full sync pipeline
 * 4. Populates missing transaction fields
 * 5. Updates wallet metadata
 */
export interface SyncJobsRuntimeDependencies {
  enrollWalletSubscriptions: (
    walletId: string,
    network: string,
    signal: AbortSignal,
  ) => Promise<void>;
}

const unavailableRuntimeDependencies: SyncJobsRuntimeDependencies = {
  enrollWalletSubscriptions: async () => {
    throw new Error('Subscription checkpoint runtime dependency is required');
  },
};

export function createSyncWalletJob(
  runtimeDependencies: SyncJobsRuntimeDependencies,
): WorkerJobHandler<SyncWalletJobData, SyncWalletJobResult> {
  return {
  name: SYNC_WALLET_JOB_NAME,
  queue: SYNC_QUEUE_NAME,
  options: SYNC_WALLET_JOB_OPTIONS,
  validateData: isSyncWalletJobLockData,
  lockOptions: {
    lockKey: getSyncLockKey,
    lockTtlMs: SYNC_LOCK_TTL_MS,
    beforeLockAttempt: async (job) => {
      const result = completeRetiredStaleJob(job);
      return result ? { complete: true, result } : undefined;
    },
    // No sync may complete as a lock-contention no-op. Returning null here put
    // every ordinary and stale sync on the silent-skip branch: the job resolved
    // successfully having done nothing, wrote no row, and left a green badge -
    // which is how a leaked lock stranded a wallet for 14.5 hours.
    retryDelayMsIfUnavailable: getSyncLockRetryDelayMs,
    // A full resync waits out a whole sync (the lock TTL). An ordinary sync
    // gives up after a bounded window, so a wallet under sustained contention
    // resolves into one visible failure instead of stacking delayed jobs.
    maxLockRetryWindowMs: getSyncLockRetryWindowMs,
    resolveLockRetryStartedAt: resolveSyncLockRetryStartedAt,
    onLockRetryBudgetExhausted: recordLockRetryBudgetExhausted,
  },
  handler: async (job: Job<SyncWalletJobData>, execution): Promise<SyncWalletJobResult> => {
    const normalizedData = readSyncWalletJobData(job.data);
    if (!normalizedData && (
      !isSyncWalletJobLockData(job.data)
      || !hasDeferredFullResyncGenerationError(job.data)
    )) {
      throw new Error('Unsupported sync-wallet job contract version');
    }
    // Full-resync generation validation deliberately remains inside the
    // lifecycle guard below. Every otherwise-valid v1/v2 payload uses the
    // canonical reader output so v2 metadata is neither cast away nor mistaken
    // for another contract's version.
    const data = normalizedData ?? job.data;
    const { walletId, reason } = data;
    const startTime = Date.now();
    execution?.throwIfAborted();

    // Checked again here so the handler never runs retired stale work, even
    // when invoked without the pre-lock hook.
    const retiredResult = completeRetiredStaleJob(job);
    if (retiredResult) {
      log.warn(`Neutralizing retained stale-wallet sync for ${walletId}`, {
        jobId: job.id,
        reason,
      });
      return retiredResult;
    }

    log.info(`Syncing wallet ${walletId}`, { reason, jobId: job.id });

    // Get wallet network for block height tracking
    const wallet = await walletRepository.findByIdWithSelect(walletId, { network: true });
    execution?.throwIfAborted();

    if (!wallet) {
      log.warn(`Wallet ${walletId} not found, skipping sync`);
      return {
        version: SYNC_JOB_CONTRACT_VERSION,
        success: false,
        duration: 0,
        error: 'Wallet not found',
      };
    }

    if (isCanonicalIncrementalSyncData(normalizedData)) {
      return executeCanonicalIncrementalSync(
        job,
        normalizedData,
        execution,
        wallet.network,
        startTime,
        {
          isFinalAttempt,
          lockTtlMs: SYNC_LOCK_TTL_MS,
          publishAttemptTransition: publishWorkerAttemptTransition,
          retryState: workerRetryState,
          enrollWalletSubscriptions: runtimeDependencies.enrollWalletSubscriptions,
        },
      );
    }

    return bridgeRetainedSyncWalletJob(job, data);
  },
  };
}

/** Fail-closed metadata export retained for lock-policy consumers and tests. */
export const syncWalletJob = createSyncWalletJob(unavailableRuntimeDependencies);

// =============================================================================
// Update Confirmations Job
// =============================================================================

function summarizeConfirmationRefresh(
  result: PendingConfirmationRefreshResult,
): UpdateConfirmationsResult {
  if (result.walletIds.length === 0) {
    log.debug('No wallets with pending transactions');
    return { version: SYNC_JOB_CONTRACT_VERSION, updated: 0, notified: 0 };
  }

  log.debug(`Updating confirmations for ${result.walletIds.length} wallets`);
  for (const failure of result.failures) {
    log.error(`Failed to update confirmations for wallet ${failure.walletId}`, {
      error: getErrorMessage(failure.error),
    });
  }
  for (const failure of result.publicationFailures) {
    log.error(`Failed to publish confirmation update for wallet ${failure.walletId}`, {
      error: getErrorMessage(failure.error),
      txid: failure.txid,
    });
  }

  if (result.confirmationUpdateCount > 0) {
    log.info(`Updated ${result.confirmationUpdateCount} transaction confirmations`, {
      wallets: result.walletIds.length,
    });
  }

  if (result.failures.length > 0) {
    throw new ConfirmationUpdateAggregateError(result.failures);
  }

  return {
    version: SYNC_JOB_CONTRACT_VERSION,
    updated: result.confirmationUpdateCount,
    notified: result.milestoneCount,
  };
}

/**
 * Update confirmations for pending transactions
 *
 * This job runs:
 * - When triggered by a new block event (with height/hash)
 * - Periodically as a scheduled job
 */
export const updateConfirmationsJob: WorkerJobHandler<UpdateConfirmationsJobData, UpdateConfirmationsResult> = {
  name: UPDATE_CONFIRMATIONS_JOB_NAME,
  queue: CONFIRMATIONS_QUEUE_NAME,
  options: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
  },
  validateData: isUpdateConfirmationsJobData,
  handler: async (job: Job<UpdateConfirmationsJobData>): Promise<UpdateConfirmationsResult> => {
    if (!isUpdateConfirmationsJobData(job.data)) {
      throw new Error('Unsupported or invalid update-confirmations job payload');
    }
    const { height, hash } = job.data;
    const network = job.data.version === NETWORK_CONFIRMATIONS_JOB_VERSION
      ? job.data.network
      : getConfig().bitcoin.network;

    // Update cached block height if provided
    if (height !== undefined) {
      setCachedBlockHeight(height, network);
      log.info(`Block height updated to ${height}`, { hash: hash?.slice(0, 16), network });
    }

    return summarizeConfirmationRefresh(await refreshPendingConfirmations(network));
  },
};

/**
 * Scheduled job to update all confirmations
 * This runs on a cron schedule as a fallback to real-time updates
 */
export const updateAllConfirmationsJob: WorkerJobHandler<
  UpdateAllConfirmationsJobData,
  UpdateConfirmationsResult
> = {
  name: UPDATE_ALL_CONFIRMATIONS_JOB_NAME,
  queue: CONFIRMATIONS_QUEUE_NAME,
  options: {
    attempts: 1,
  },
  validateData: isUpdateAllConfirmationsJobData,
  handler: async (job: Job<UpdateAllConfirmationsJobData>): Promise<UpdateConfirmationsResult> => {
    if (!isUpdateAllConfirmationsJobData(job.data)) {
      throw new Error('Unsupported or invalid update-all-confirmations job payload');
    }
    return summarizeConfirmationRefresh(await refreshAllPendingConfirmations());
  },
};

// =============================================================================
// Export all sync jobs
// =============================================================================

export function createSyncJobs(
  runtimeDependencies: SyncJobsRuntimeDependencies,
): WorkerJobHandler<unknown, unknown>[] {
  return [
    createSyncWalletJob(runtimeDependencies) as WorkerJobHandler<unknown, unknown>,
    updateConfirmationsJob as WorkerJobHandler<unknown, unknown>,
    updateAllConfirmationsJob as WorkerJobHandler<unknown, unknown>,
  ];
}
