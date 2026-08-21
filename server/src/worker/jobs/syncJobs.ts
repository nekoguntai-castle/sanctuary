/**
 * Sync Job Definitions
 *
 * Background jobs for wallet synchronization.
 * These jobs handle:
 * - Individual wallet sync
 * - Stale wallet detection and queueing
 * - Transaction confirmation updates
 */

import type { Job } from 'bullmq';
import type { LockRetryBudgetExhaustedDetail, WorkerJobHandler } from './types';
import type {
  SyncWalletJobData,
  SyncWalletJobResult,
  CheckStaleWalletsJobData,
  CheckStaleWalletsResult,
  UpdateConfirmationsJobData,
  UpdateConfirmationsResult,
} from './types';
import { resyncRepository, walletRepository, transactionRepository } from '../../repositories';
import { syncWallet } from '../../services/bitcoin/blockchain';
import {
  updateTransactionConfirmations,
  populateMissingTransactionFields,
} from '../../services/bitcoin/sync/confirmations';
import {
  setCachedBlockHeight,
  getCachedBlockHeight,
  assertChainReachable,
} from '../../services/bitcoin/blockchain';
import { getConfig } from '../../config';
import { normalizeLegacyBitcoinNetwork } from '../../services/bitcoin/networks';
import { isLocked } from '../../infrastructure';
import {
  broadcastSyncStatus,
  broadcastWalletLog,
} from '../../websocket/notifications/broadcasts';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { SYNC_WALLET_JOB_OPTIONS, getSyncLockTtlMs } from './jobOptions';
import { isFullResyncGeneration } from '../../constants/fullResync';
import {
  clearActiveSyncAttempt,
  recordSyncFailure,
  recordSyncLockContention,
  recordSyncRetry,
  recordSyncSuccess,
  SYNC_ABORT_GRACE_MS,
  runSyncAttemptWithTimeout,
  startSyncAttempt,
} from '../../services/sync/syncAttemptLifecycle';

const log = createLogger('JOB:SYNC');

// Keep lock alive beyond expected sync duration to avoid concurrent sync overlap.
const SYNC_LOCK_TTL_MS = getSyncLockTtlMs();
const FULL_RESYNC_LOCK_RETRY_DELAY_MS = 5_000;
/** Re-delay for a contended ordinary sync; long enough not to spin on Redis. */
const ORDINARY_SYNC_LOCK_RETRY_DELAY_MS = 15_000;
/**
 * Patience for a contended ordinary sync. Deliberately under the stale sweep's
 * own interval so at most one delayed job per wallet is ever outstanding, and a
 * wallet blocked by a leaked lock surfaces one visible failure per sweep rather
 * than accumulating delayed jobs or silently vanishing from the sweep.
 */
const ORDINARY_SYNC_LOCK_RETRY_WINDOW_MS = 4 * 60_000;
function workerRetryDelayMs(job: Job<SyncWalletJobData>): number {
  const configured = (job.opts?.backoff ?? SYNC_WALLET_JOB_OPTIONS.backoff)!;
  if (typeof configured === 'number') return configured;
  const delay = configured.delay ?? 0;
  return configured.type === 'exponential'
    ? delay * (2 ** job.attemptsMade)
    : delay;
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

  // Distinguish the two shapes of contention, because only one is a fault:
  //  - syncInProgress=true: another holder is genuinely mid-sync and will write
  //    its own terminal status. Marking failed here would be a false negative.
  //  - syncInProgress=false: the lock outlived its holder - a tombstone from an
  //    unconfirmed release. Nothing else will ever write a status for this
  //    wallet, so this is the only chance to stop it rendering a green badge.
  let current: { syncInProgress?: boolean } | null;
  try {
    current = await walletRepository.findByIdWithSelect(
      walletId,
      { syncInProgress: true },
    );
  } catch (error) {
    log.warn(`Could not verify sync liveness for wallet ${walletId}; leaving its status alone`, {
      error: getErrorMessage(error),
      lockKey: detail.lockKey,
    });
    return;
  }
  if (current?.syncInProgress !== false) {
    log.warn(`Sync lock for wallet ${walletId} is held by a running sync; leaving its status alone`, {
      lockKey: detail.lockKey,
      retryWindowMs: detail.retryWindowMs,
    });
    return;
  }

  log.error(`Gave up queueing sync for wallet ${walletId}`, {
    lockKey: detail.lockKey,
    retryWindowMs: detail.retryWindowMs,
    holderSyncInProgress: false,
  });

  // Report before the write, so a failing database still reaches the UI.
  runWorkerSideEffect('Lock contention status publication', () => {
    broadcastSyncStatus(walletId, {
      inProgress: false,
      status: detail.isFinalAttempt ? 'failed' : 'retrying',
      error: detail.message,
      retriesExhausted: detail.isFinalAttempt,
    });
  });
  runWorkerSideEffect('Lock contention log publication', () => {
    broadcastWalletLog(walletId, {
      level: detail.isFinalAttempt ? 'error' : 'warn',
      module: 'SYNC',
      message: detail.isFinalAttempt
        ? `Sync abandoned: ${detail.message}`
        : `Sync lock retry pending: ${detail.message}`,
      details: { lockKey: detail.lockKey, retryWindowMs: detail.retryWindowMs },
    });
  });

  await recordSyncLockContention(walletId, {
    error: detail.message,
    isFinalAttempt: detail.isFinalAttempt,
  }, walletRepository);
}

/**
 * Is a sync actually running for this wallet right now?
 *
 * Legacy rows with no `syncStartedAt` have no time bound. The wallet's sync lock
 * is the only liveness signal available cross-process, so probe it before
 * force-clearing anything.
 */
async function isSyncLockHeld(walletId: string): Promise<boolean> {
  try {
    return await isLocked(`sync:wallet:${walletId}`);
  } catch (error) {
    // Fail closed: without a usable lock authority a live sync is
    // indistinguishable from an orphaned flag, and clearing the flag under a
    // running sync is what makes a resync look idle while it is still working.
    log.warn(`Could not probe sync lock for wallet ${walletId}, leaving flag intact`, {
      error: getErrorMessage(error),
    });
    return true;
  }
}

function isFinalAttempt(job: Job<SyncWalletJobData>): boolean {
  const attempts = typeof job.opts?.attempts === 'number' ? job.opts.attempts : 1;
  return job.attemptsMade + 1 >= attempts;
}

async function prepareFullResync(
  job: Job<SyncWalletJobData>,
  walletNetwork: string,
): Promise<void> {
  if (!job.data.fullResync) return;
  const generation = job.data.fullResyncGeneration;
  if (!isFullResyncGeneration(generation)) {
    throw new Error('Full resync job is missing its durable generation');
  }

  // Prove the chain is reachable before deleting anything. The reset drops every
  // transaction for the wallet, and the rebuild that would restore them is the
  // very thing an unreachable node prevents - so without this the wallet is left
  // empty with no way back until the node returns.
  await assertChainReachable(normalizeLegacyBitcoinNetwork(walletNetwork, 'mainnet'));

  const reset = await resyncRepository.resetWalletForFullResync(
    job.data.walletId,
    generation,
  );
  log.info(`Prepared full resync for wallet ${job.data.walletId}`, {
    deletedTransactions: reset.deletedTransactions,
    resetPerformed: reset.resetPerformed,
    jobId: job.id,
  });
}

/**
 * Clear syncInProgress for wallets whose sync is demonstrably not running.
 *
 * Recovers from a crashed worker or a failed error-path write leaving the flag
 * set forever. The lock probe matters: findStuckWithCutoff's
 * `lastSyncedAt IS NULL` arm has no time bound, so a full resync - which nulls
 * that column before it starts - matches within seconds of beginning.
 */
/**
 * Re-enqueue full resyncs that were requested but never carried out.
 *
 * `reserveFullResyncGeneration` commits the request before the job is enqueued,
 * so a job lost between the two - or dropped from the queue afterwards - leaves
 * `requested > processed` with nothing to consume it. Nothing else in the server
 * reads that pair, so the operator's click silently did nothing and the wallet
 * kept a healthy badge. Observed live on 2026-08-20 with drift 1, no queued job
 * and no dedup key.
 */
async function reconcileStrandedFullResyncs(): Promise<void> {
  let stranded: Awaited<ReturnType<typeof resyncRepository.findStrandedFullResyncWallets>>;
  try {
    stranded = await resyncRepository.findStrandedFullResyncWallets();
  } catch (error) {
    log.error('Could not look for stranded full resyncs', { error: getErrorMessage(error) });
    return;
  }
  if (stranded.length === 0) return;

  log.warn(`Re-enqueueing ${stranded.length} full resyncs that were requested but never ran`, {
    walletIds: stranded.map(wallet => wallet.id),
  });

  try {
    const { enqueueFullResyncBatch } = await import('../../services/workerSyncQueue');
    const result = await enqueueFullResyncBatch(
      stranded.map(wallet => wallet.id),
      { reason: 'reconcile-stranded-full-resync' },
    );
    log.info('Stranded full-resync reconciliation finished', {
      accepted: result.acceptedWalletIds.length,
      deduplicated: result.deduplicatedWalletIds.length,
      indeterminate: result.indeterminateWallets.length,
    });
  } catch (error) {
    // Reconciliation is best-effort; the stale sweep must still run.
    log.error('Could not re-enqueue stranded full resyncs', { error: getErrorMessage(error) });
  }
}

async function resetStuckSyncFlags(maxSyncDurationMs: number): Promise<void> {
  const stuckCutoff = new Date(Date.now() - maxSyncDurationMs);
  const stuckWallets = await walletRepository.findStuckWithCutoff(stuckCutoff);
  if (stuckWallets.length === 0) return;

  let resetCount = 0;
  for (const wallet of stuckWallets) {
    if (await isSyncLockHeld(wallet.id)) {
      /* v8 ignore next -- fallback id is defensive logging metadata */
      log.debug(`Sync still running for wallet ${wallet.name || wallet.id}, leaving flag set`);
      continue;
    }
    await walletRepository.updateSyncState(wallet.id, {
      syncInProgress: false,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    });
    resetCount++;
    // Serialise the Date explicitly. The logger renders a bare Date as `{}`;
    // logging the authoritative start clock makes the measured age auditable
    // and distinguishes legacy rows that have no start timestamp.
    /* v8 ignore next 4 -- fallback id/null stale timestamp are defensive logging metadata */
    log.warn(`Reset stuck syncInProgress flag for wallet ${wallet.name || wallet.id}`, {
      syncStartedAt: wallet.syncStartedAt?.toISOString() ?? null,
      stuckForMs: wallet.syncStartedAt ? Date.now() - wallet.syncStartedAt.getTime() : null,
      missingStartTime: wallet.syncStartedAt === null || wallet.syncStartedAt === undefined,
    });
  }
  if (resetCount > 0) {
    log.info(`Reset ${resetCount} stuck sync flags`);
  }
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
export const syncWalletJob: WorkerJobHandler<SyncWalletJobData, SyncWalletJobResult> = {
  name: 'sync-wallet',
  queue: 'sync',
  options: SYNC_WALLET_JOB_OPTIONS,
  lockOptions: {
    lockKey: (data) => `sync:wallet:${data.walletId}`,
    lockTtlMs: SYNC_LOCK_TTL_MS,
    // No sync may complete as a lock-contention no-op. Returning null here put
    // every ordinary and stale sync on the silent-skip branch: the job resolved
    // successfully having done nothing, wrote no row, and left a green badge -
    // which is how a leaked lock stranded a wallet for 14.5 hours.
    retryDelayMsIfUnavailable: data => (
      data.fullResync === true
        ? FULL_RESYNC_LOCK_RETRY_DELAY_MS
        : ORDINARY_SYNC_LOCK_RETRY_DELAY_MS
    ),
    // A full resync waits out a whole sync (the lock TTL). An ordinary sync
    // gives up sooner than the stale sweep's own interval, so a wallet under
    // sustained contention resolves into one visible failure per sweep instead
    // of stacking a delayed job per sweep forever.
    maxLockRetryWindowMs: data => (
      data.fullResync === true ? SYNC_LOCK_TTL_MS : ORDINARY_SYNC_LOCK_RETRY_WINDOW_MS
    ),
    onLockRetryBudgetExhausted: recordLockRetryBudgetExhausted,
  },
  handler: async (job: Job<SyncWalletJobData>, execution): Promise<SyncWalletJobResult> => {
    const { walletId, reason } = job.data;
    const startTime = Date.now();
    execution?.throwIfAborted();

    log.info(`Syncing wallet ${walletId}`, { reason, jobId: job.id });

    // Get wallet network for block height tracking
    const wallet = await walletRepository.findByIdWithSelect(walletId, { network: true });
    execution?.throwIfAborted();

    if (!wallet) {
      log.warn(`Wallet ${walletId} not found, skipping sync`);
      return { success: false, duration: 0, error: 'Wallet not found' };
    }

    // Announce the pickup before any work: the worker has no WebSocket clients
    // of its own, so this event (routed over the Redis bridge) is the only way
    // the UI learns a queued sync actually started.
    runWorkerSideEffect('Sync start status publication', () => {
      broadcastSyncStatus(walletId, { inProgress: true });
    });
    runWorkerSideEffect('Sync start log publication', () => {
      broadcastWalletLog(walletId, {
        level: 'info',
        module: 'SYNC',
        message: job.data.fullResync === true ? 'Full resync started' : 'Sync started',
        details: { reason, jobId: job.id },
      });
    });

    let syncFlagSet = false;
    let flagCleared = false;
    let preparingFullResync = job.data.fullResync === true;
    try {
      await prepareFullResync(job, wallet.network);
      if (job.data.fullResync === true) {
        // Reset preparation commits syncInProgress=true. Arm cleanup before the
        // first abort checkpoint so shutdown cannot strand that durable state.
        syncFlagSet = true;
      }
      preparingFullResync = false;
      execution?.throwIfAborted();

      // Keep the mark and the abort checkpoint inside the cleanup guard. If
      // cooperative shutdown arrives while the write is in flight, the flag is
      // reset before the handler settles and its lock is released.
      await startSyncAttempt(walletId, {
        owner: 'worker',
        retryCount: job.attemptsMade,
        startedAt: new Date(startTime),
      }, walletRepository);
      syncFlagSet = true;
      execution?.throwIfAborted();

      // Execute sync
      const result = await runSyncAttemptWithTimeout(
        async (signal) => {
          const syncResult = await syncWallet(walletId, 0, signal);
          await populateMissingTransactionFields(walletId, signal);
          return syncResult;
        },
        getConfig().sync.maxSyncDurationMs,
        SYNC_ABORT_GRACE_MS,
        execution?.signal,
      );
      execution?.throwIfAborted();

      // Get current block height for this network
      const network = normalizeLegacyBitcoinNetwork(wallet.network, 'mainnet');
      const currentBlockHeight = getCachedBlockHeight(network);

      const syncedAt = new Date();
      await recordSyncSuccess(walletId, {
        syncedAt,
        lastSyncedBlockHeight: currentBlockHeight,
      }, walletRepository);
      flagCleared = true;
      // Publish the timestamp we persisted rather than letting the client invent
      // one, so the list and the detail view cannot disagree.
      runWorkerSideEffect('Sync success status publication', () => {
        broadcastSyncStatus(walletId, {
          inProgress: false,
          status: 'success',
          lastSyncedAt: syncedAt,
        });
      });

      const duration = Date.now() - startTime;

      log.info(`Wallet ${walletId} synced successfully`, {
        duration,
        transactions: result.transactions,
        utxos: result.utxos,
        jobId: job.id,
      });
      runWorkerSideEffect('Sync completion log publication', () => {
        broadcastWalletLog(walletId, {
          level: 'info',
          module: 'SYNC',
          message: 'Sync completed',
          details: {
            duration,
            transactions: result.transactions,
            utxos: result.utxos,
          },
        });
      });

      return {
        success: true,
        duration,
        transactionsFound: result.transactions,
        utxosUpdated: result.utxos,
      };
    } catch (caughtError) {
      let error = caughtError;
      try {
        execution?.throwIfAborted();
      } catch (abortError) {
        error = abortError;
      }
      const duration = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);
      const finalAttempt = isFinalAttempt(job);

      // Report before touching the database. The row write can itself fail, and
      // then this event is the only account of the failure the user ever gets.
      runWorkerSideEffect('Sync failure status publication', () => {
        broadcastSyncStatus(walletId, {
          inProgress: false,
          status: finalAttempt ? 'failed' : 'retrying',
          error: errorMsg,
          retriesExhausted: finalAttempt,
        });
      });
      runWorkerSideEffect('Sync failure log publication', () => {
        broadcastWalletLog(walletId, {
          level: 'error',
          module: 'SYNC',
          message: `Sync failed: ${errorMsg}`,
          details: { duration, jobId: job.id, attemptsMade: job.attemptsMade },
        });
      });

      if (preparingFullResync) {
        flagCleared = finalAttempt
          ? await recordSyncFailure(walletId, { error }, walletRepository)
          : await recordSyncRetry(walletId, {
            owner: 'worker',
            ...workerRetryState(job),
            error,
          }, walletRepository);
        log.warn(`Full resync preparation will retry for wallet ${walletId}`, {
          error: errorMsg,
          jobId: job.id,
          finalAttempt,
        });
        throw error;
      }

      flagCleared = finalAttempt
        ? await recordSyncFailure(walletId, { error }, walletRepository)
        : await recordSyncRetry(walletId, {
          owner: 'worker',
          ...workerRetryState(job),
          error,
        }, walletRepository);

      log.error(`Wallet ${walletId} sync failed`, {
        error: errorMsg,
        duration,
        jobId: job.id,
        attemptsMade: job.attemptsMade,
      });

      throw error;
    } finally {
      // Safety net: if neither try nor catch managed to clear the flag,
      // force-reset it so the wallet doesn't stay stuck forever.
      if (syncFlagSet && !flagCleared) {
        try {
          await clearActiveSyncAttempt(walletId, walletRepository);
          // Stop the UI spinner even on a path that never reached a terminal
          // status, otherwise the wallet appears to sync forever.
          runWorkerSideEffect('Sync safety-net status publication', () => {
            broadcastSyncStatus(walletId, { inProgress: false });
          });
          log.warn(`Safety-net reset syncInProgress for wallet ${walletId}`);
        } catch (cleanupError) {
          log.error(`Failed to safety-net reset syncInProgress for wallet ${walletId}`, {
            error: getErrorMessage(cleanupError),
          });
        }
      }
    }
  },
};

// =============================================================================
// Check Stale Wallets Job
// =============================================================================

/**
 * Check for stale wallets and queue sync jobs
 *
 * This is a scheduled job that runs periodically to find wallets
 * that haven't been synced recently and queue them for sync.
 * Limited to a configured batch size to prevent queue flooding.
 */
export const checkStaleWalletsJob: WorkerJobHandler<CheckStaleWalletsJobData, CheckStaleWalletsResult> = {
  name: 'check-stale-wallets',
  queue: 'sync',
  options: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
  },
  handler: async (job: Job<CheckStaleWalletsJobData>): Promise<CheckStaleWalletsResult> => {
    const config = getConfig();
    const staleThresholdMs = job.data.staleThresholdMs ?? config.sync.staleThresholdMs;
    const maxWallets = job.data.maxWallets ?? config.sync.staleBatchSize;
    const priority = job.data.priority ?? 'low';
    const staggerDelayMs = job.data.staggerDelayMs ?? config.sync.syncStaggerDelayMs;
    const reason = job.data.reason ?? 'stale';
    const cutoffTime = new Date(Date.now() - staleThresholdMs);

    log.debug('Checking for stale wallets', {
      staleThresholdMs,
      cutoffTime,
      maxWallets,
      priority,
      staggerDelayMs,
      reason,
    });

    await resetStuckSyncFlags(config.sync.maxSyncDurationMs);
    await reconcileStrandedFullResyncs();

    // Find stale wallets, prioritizing those never synced, then oldest first
    // Limited to prevent queue flooding
    const staleWallets = await walletRepository.findStale({
      staleThresholdMs: staleThresholdMs,
      maxResults: maxWallets,
      orderBy: [{ lastSyncedAt: { sort: 'asc', nulls: 'first' } }],
    });

    if (staleWallets.length === 0) {
      log.debug('No stale wallets found');
      return {
        staleWalletIds: [],
        queued: 0,
        priority,
        staggerDelayMs,
        reason,
        maxWallets,
      };
    }

    log.info(`Found ${staleWallets.length} stale wallets (max: ${maxWallets})`, {
      priority,
      reason,
    });

    // Return the wallet IDs - the worker will queue them
    // This is done in the worker entry point to avoid circular dependencies
    const staleWalletIds = staleWallets.map(w => w.id);

    return {
      staleWalletIds,
      queued: staleWalletIds.length,
      priority,
      staggerDelayMs,
      reason,
      maxWallets,
    };
  },
};

// =============================================================================
// Update Confirmations Job
// =============================================================================

/**
 * Update confirmations for pending transactions
 *
 * This job runs:
 * - When triggered by a new block event (with height/hash)
 * - Periodically as a scheduled job
 */
export const updateConfirmationsJob: WorkerJobHandler<UpdateConfirmationsJobData, UpdateConfirmationsResult> = {
  name: 'update-confirmations',
  queue: 'confirmations',
  options: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 3000 },
  },
  handler: async (job: Job<UpdateConfirmationsJobData>): Promise<UpdateConfirmationsResult> => {
    const { height, hash } = job.data;

    // Update cached block height if provided
    if (height) {
      const config = getConfig();
      const network = config.bitcoin.network;
      setCachedBlockHeight(height, network);
      log.info(`Block height updated to ${height}`, { hash: hash?.slice(0, 16) });
    }

    // Find all wallets with pending transactions (< 6 confirmations)
    const walletIds = await transactionRepository.findWalletIdsWithPendingConfirmations(6);
    const walletsWithPending = [...new Set(walletIds)].sort();

    if (walletsWithPending.length === 0) {
      log.debug('No wallets with pending transactions');
      return { updated: 0, notified: 0 };
    }

    log.debug(`Updating confirmations for ${walletsWithPending.length} wallets`);

    let totalUpdated = 0;
    let totalNotified = 0;

    const failures: Array<{ walletId: string; error: unknown }> = [];
    for (const walletId of walletsWithPending) {
      try {
        const updates = await updateTransactionConfirmations(walletId);
        totalUpdated += updates.length;

        // Track milestone confirmations for notifications
        // Notifications are handled by the notification jobs
        for (const update of updates) {
          if ([1, 3, 6].includes(update.newConfirmations)) {
            totalNotified++;
            // Note: Actual notification sending is done by queueing notification jobs
            // This is handled in the worker entry point
          }
        }
      } catch (error) {
        failures.push({ walletId, error });
        log.error(`Failed to update confirmations for wallet ${walletId}`, {
          error: getErrorMessage(error),
        });
      }
    }

    if (totalUpdated > 0) {
      log.info(`Updated ${totalUpdated} transaction confirmations`, {
        wallets: walletsWithPending.length,
      });
    }

    if (failures.length > 0) {
      throw new ConfirmationUpdateAggregateError(failures);
    }

    return { updated: totalUpdated, notified: totalNotified };
  },
};

/**
 * Scheduled job to update all confirmations
 * This runs on a cron schedule as a fallback to real-time updates
 */
export const updateAllConfirmationsJob: WorkerJobHandler<void, UpdateConfirmationsResult> = {
  name: 'update-all-confirmations',
  queue: 'confirmations',
  options: {
    attempts: 1,
  },
  handler: async (): Promise<UpdateConfirmationsResult> => {
    // Delegate to the main update confirmations job with no block data
    const mockJob = { data: {} } as Job<UpdateConfirmationsJobData>;
    return updateConfirmationsJob.handler(mockJob);
  },
};

// =============================================================================
// Export all sync jobs
// =============================================================================

export const syncJobs: WorkerJobHandler<unknown, unknown>[] = [
  syncWalletJob as WorkerJobHandler<unknown, unknown>,
  checkStaleWalletsJob as WorkerJobHandler<unknown, unknown>,
  updateConfirmationsJob as WorkerJobHandler<unknown, unknown>,
  updateAllConfirmationsJob as WorkerJobHandler<unknown, unknown>,
];
