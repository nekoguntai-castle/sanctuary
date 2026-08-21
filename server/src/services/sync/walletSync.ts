/**
 * Wallet Sync Execution
 *
 * Handles per-wallet sync orchestration including:
 * - Distributed lock acquisition/release
 * - Sync execution with timeout
 * - Retry logic with exponential backoff
 * - Balance comparison and WebSocket notifications
 * - Dead letter queue for permanently failed syncs
 */

import { walletRepository, utxoRepository } from "../../repositories";
import {
  syncWallet,
  populateMissingTransactionFields,
} from "../bitcoin/blockchain";
import {
  getNotificationService,
  walletLog,
} from "../../websocket/notifications";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import { getConfig } from "../../config";
import { recordSyncFailure as recordDeadLetterSyncFailure } from "../deadLetterQueue";
import {
  acquireLock,
  LockAuthorityUnavailableError,
  releaseLock,
} from "../../infrastructure";
import {
  walletSyncsTotal,
  walletSyncDuration,
} from "../../observability/metrics";
import type { SyncState, SyncResult } from "./types";
import { processQueue } from "./syncQueue";
import { isNetworkDisabledError } from "../bitcoin/errors";
import { scheduleWalletLockAuthorityRetry } from "./lockAuthorityRecovery";
import { resumeRetryCount } from "./retryLadder";
import {
  recordSyncFailure,
  recordSyncRetry,
  recordSyncSuccess,
  SYNC_ABORT_GRACE_MS,
  runSyncAttemptWithTimeout,
  startSyncAttempt,
  clearActiveSyncAttempt,
} from "./syncAttemptLifecycle";
import { syncLifecyclePublisher } from "./syncLifecyclePublisher";

const log = createLogger("SYNC:SVC_WALLET");

async function runSyncSideEffect(
  description: string,
  effect: () => unknown | Promise<unknown>,
): Promise<void> {
  try {
    await effect();
  } catch (error) {
    log.error(`[SYNC] ${description} failed`, {
      error: getErrorMessage(error),
    });
  }
}

function shouldRetrySyncError(error: unknown): boolean {
  return !isNetworkDisabledError(error);
}

/**
 * Acquire a distributed lock for a wallet sync.
 *
 * Uses the process's explicitly initialized lock authority. Production requires
 * Redis and propagates authority loss so the caller can retry safely.
 */
export async function acquireSyncLock(
  state: SyncState,
  walletId: string,
): Promise<boolean> {
  // Quick check if we already have the lock locally
  if (state.activeSyncs.has(walletId)) {
    return false;
  }

  const syncConfig = getConfig().sync;
  // Lock TTL should be slightly longer than max sync duration to prevent premature expiration
  const lockTtlMs = syncConfig.maxSyncDurationMs + 60000; // +1 minute buffer

  // Try to acquire distributed lock
  const lock = await acquireLock(`sync:wallet:${walletId}`, {
    ttlMs: lockTtlMs,
    waitTimeMs: 0, // Don't wait - if locked, skip
  });

  if (!lock) {
    log.debug(
      `[SYNC] Could not acquire lock for wallet ${walletId} (already syncing)`,
    );
    return false;
  }

  // Store lock for later release
  state.activeLocks.set(walletId, lock);
  state.activeSyncs.add(walletId);
  return true;
}

/**
 * Release a distributed wallet sync lock.
 */
export async function releaseSyncLock(
  state: SyncState,
  walletId: string,
): Promise<void> {
  const lock = state.activeLocks.get(walletId);
  if (lock) {
    await releaseLock(lock);
    state.activeLocks.delete(walletId);
  }
  state.activeSyncs.delete(walletId);
}

/**
 * Get wallet balance from UTXOs, separated into confirmed and unconfirmed.
 */
export async function getWalletBalance(
  walletId: string,
): Promise<{ confirmed: number; unconfirmed: number }> {
  return utxoRepository.getConfirmedUnconfirmedBalance(walletId);
}

/**
 * Execute a sync job for a wallet with retry support.
 *
 * @param executeSyncJobFn - Self-reference for retry scheduling (avoids circular dependency).
 */
export async function executeSyncJob(
  state: SyncState,
  walletId: string,
  executeSyncJobFn: (
    walletId: string,
    retryCount?: number,
  ) => Promise<SyncResult>,
  retryCount: number = 0,
): Promise<SyncResult> {
  // An externally-triggered attempt (manual Sync, queue drain, stale sweep) has
  // no ladder position on its call stack, so it used to restart at 0 and rewrite
  // "(retrying 1/3)" forever - the terminal `failed` write needs
  // retryCount >= maxRetryAttempts and was therefore unreachable. Recover the
  // position the wallet had actually reached.
  if (retryCount === 0) {
    const persisted = await walletRepository
      .findSyncState(walletId)
      .catch(() => null);
    retryCount = resumeRetryCount(persisted, getConfig().sync.maxRetryAttempts);
  }

  // Try to acquire distributed lock - prevents race conditions across instances
  let acquired: boolean;
  try {
    acquired = await acquireSyncLock(state, walletId);
  } catch (error) {
    if (!(error instanceof LockAuthorityUnavailableError)) throw error;
    return scheduleWalletLockAuthorityRetry(
      state,
      walletId,
      retryCount,
      executeSyncJobFn,
    );
  }
  if (!acquired) {
    // Do not drop a ladder here. The retry timer deletes its own pendingRetries
    // entry before calling, so returning silently leaves nothing armed and no
    // DB write - which is how a 31-minute lock turned into a 14.5-hour stall.
    // Re-arm at the same position; the lock always carries a TTL, so this
    // cannot wait forever, and the ladder itself is still bounded.
    if (retryCount > 0 && !state.pendingRetries.has(walletId)) {
      const timer = setTimeout(() => {
        state.pendingRetries.delete(walletId);
        executeSyncJobFn(walletId, retryCount).catch((err) => {
          log.error(`[SYNC] Lock-contention retry failed for wallet ${walletId}`, {
            error: getErrorMessage(err),
          });
        });
      }, getConfig().sync.lockContentionRetryDelayMs);
      timer.unref?.();
      state.pendingRetries.set(walletId, timer);
      log.warn(`[SYNC] Wallet ${walletId} is locked; retry ${retryCount} re-armed rather than dropped`);
    }
    return {
      success: false,
      addresses: 0,
      transactions: 0,
      utxos: 0,
      error: "Already syncing",
    };
  }
  const pendingRetry = state.pendingRetries.get(walletId);
  if (pendingRetry) {
    clearTimeout(pendingRetry);
    state.pendingRetries.delete(walletId);
  }

  const syncConfig = getConfig().sync;
  const notificationService = getNotificationService();
  let attemptStarted = false;
  let stateCleared = false;
  try {
    // Mark this structured attempt before doing any wallet work. The inline
    // owner distinguishes its heap-timer retry from BullMQ's durable retries.
    const startedTransition = await startSyncAttempt(walletId, {
      owner: "inline",
      retryCount,
      startedAt: new Date(),
    }, walletRepository);
    attemptStarted = true;
    await syncLifecyclePublisher.publish(startedTransition);

    const startTime = Date.now();
    log.info(
      `[SYNC] Starting sync for wallet ${walletId}${retryCount > 0 ? ` (retry ${retryCount}/${syncConfig.maxRetryAttempts})` : ""}`,
    );
    await runSyncSideEffect("sync start wallet log publication", () => {
      walletLog(
        walletId,
        "info",
        "SYNC",
        retryCount > 0
          ? `Sync started (retry ${retryCount}/${syncConfig.maxRetryAttempts})`
          : "Sync started",
      );
    });

    // Execute sync and keep lock ownership until the underlying promise settles.
    // The timeout cancels rather than merely observing: the lock and the
    // in-memory activeSyncs entry are released in the finally below, which a
    // promise that never settles never reaches. Leaving that entry behind
    // wedges the wallet for the life of the process, because acquireSyncLock
    // short-circuits on it before ever consulting Redis - so every later sync
    // returns "Already syncing" long after the Redis lock TTL has expired.
    const {
      result,
      populateResult,
      previousBalances,
      newBalances,
    } = await runSyncAttemptWithTimeout(
      async (signal) => {
        const balancesBeforeSync = await getWalletBalance(walletId);
        const syncResult = await syncWallet(walletId, 0, signal);

        await runSyncSideEffect("sync completion-progress wallet log publication", () => {
          walletLog(
            walletId,
            "info",
            "SYNC",
            "Completing sync (populating transaction details)...",
          );
        });
        const populated = await populateMissingTransactionFields(walletId, signal);
        const balances = await getWalletBalance(walletId);
        return {
          result: syncResult,
          populateResult: populated,
          previousBalances: balancesBeforeSync,
          newBalances: balances,
        };
      },
      syncConfig.maxSyncDurationMs,
      SYNC_ABORT_GRACE_MS,
    );

    const previousTotal =
      previousBalances.confirmed + previousBalances.unconfirmed;
    if (populateResult.updated > 0) {
      log.info(
        `[SYNC] Populated missing fields for ${populateResult.updated} existing transactions`,
      );
      await runSyncSideEffect("sync population wallet log publication", () => {
        walletLog(
          walletId,
          "info",
          "SYNC",
          `Populated details for ${populateResult.updated} transactions`,
        );
      });
    }

    const newTotal = newBalances.confirmed + newBalances.unconfirmed;

    // Update sync metadata
    const syncedAt = new Date();
    const successTransition = await recordSyncSuccess(
      walletId,
      { syncedAt },
      walletRepository,
    );
    stateCleared = true;
    await syncLifecyclePublisher.publish(successTransition);

    const duration = Date.now() - startTime;
    log.info(
      `[SYNC] Completed sync for wallet ${walletId}: ${result.transactions} tx, ${result.utxos} utxos`,
    );
    await runSyncSideEffect("sync completion wallet log publication", () => {
      walletLog(
        walletId,
        "info",
        "SYNC",
        `Sync complete (${result.transactions} transactions, ${result.utxos} UTXOs)`,
      );
    });

    // Record sync metrics
    await runSyncSideEffect("sync success metrics", () => {
      walletSyncsTotal.inc({ status: "success" });
      walletSyncDuration.observe({ walletType: "all" }, duration / 1000);
    });

    // Notify via WebSocket if balance changed (confirmed or unconfirmed)
    if (
      newTotal !== previousTotal ||
      newBalances.unconfirmed !== previousBalances.unconfirmed
    ) {
      await runSyncSideEffect("balance update publication", () => {
        notificationService.broadcastBalanceUpdate({
          walletId,
          balance: newBalances.confirmed,
          unconfirmed: newBalances.unconfirmed,
          previousBalance: previousBalances.confirmed,
          change: newBalances.confirmed - previousBalances.confirmed,
        });
      });
    }

    // Continue processing queue
    /* v8 ignore start -- queue continuation callback is covered by sync queue tests */
    await runSyncSideEffect("queue continuation", () => {
      processQueue(state, (wId) => executeSyncJobFn(wId));
    });
    /* v8 ignore stop */

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    if (!attemptStarted) throw error;
    const errorMessage = getErrorMessage(error, "Unknown error");
    log.error(`[SYNC] Sync failed for wallet ${walletId}:`, {
      error: errorMessage,
    });

    // Check if we should retry
    if (
      retryCount < syncConfig.maxRetryAttempts &&
      shouldRetrySyncError(error)
    ) {
      const nextRetry = retryCount + 1;
      const delayMs =
        syncConfig.retryDelaysMs[retryCount] ||
        syncConfig.retryDelaysMs[syncConfig.retryDelaysMs.length - 1];
      const nextRetryAt = new Date(Date.now() + delayMs);

      log.info(
        `[SYNC] Will retry wallet ${walletId} in ${delayMs / 1000}s (attempt ${nextRetry}/${syncConfig.maxRetryAttempts})`,
      );
      const retryTransition = await recordSyncRetry(walletId, {
        owner: "inline",
        retryCount: nextRetry,
        nextRetryAt,
        error,
      }, walletRepository);
      if (!retryTransition) {
        log.error(`[SYNC] Retry state could not be persisted for wallet ${walletId}; not arming an in-memory retry`);
        return {
          success: false,
          addresses: 0,
          transactions: 0,
          utxos: 0,
          error: errorMessage,
        };
      }
      stateCleared = true;
      await syncLifecyclePublisher.publish(retryTransition, {
        maxRetries: syncConfig.maxRetryAttempts,
      });
      await runSyncSideEffect("sync retry wallet log publication", () => {
        walletLog(
          walletId,
          "warn",
          "SYNC",
          `Sync failed: ${errorMessage}. Retrying in ${delayMs / 1000}s...`,
          {
            attempt: nextRetry,
            maxAttempts: syncConfig.maxRetryAttempts,
          },
        );
      });

      // Release distributed lock so retry can acquire it fresh
      await releaseSyncLock(state, walletId);

      // Schedule retry with delay (track timer for cleanup on shutdown)
      const retryTimer = setTimeout(() => {
        state.pendingRetries.delete(walletId);
        executeSyncJobFn(walletId, nextRetry).catch((err) => {
          log.error(`[SYNC] Retry failed for wallet ${walletId}`, {
            error: getErrorMessage(err),
          });
        });
      }, delayMs);
      state.pendingRetries.set(walletId, retryTimer);

      return {
        success: false,
        addresses: 0,
        transactions: 0,
        utxos: 0,
        error: `${errorMessage} - retrying...`,
      };
    }

    // Final failure: retries exhausted or a non-retryable configuration error.
    const retryFailureMessage =
      retryCount > 0
        ? `Sync failed after ${syncConfig.maxRetryAttempts} attempts: ${errorMessage}`
        : `Sync failed: ${errorMessage}`;
    log.error(`[SYNC] Final sync failure for wallet ${walletId}`);
    const failureTransition = await recordSyncFailure(
      walletId,
      { error },
      walletRepository,
    );
    if (!failureTransition) {
      log.error(`[SYNC] Terminal failure state could not be persisted for wallet ${walletId}`);
    } else {
      stateCleared = true;
      await syncLifecyclePublisher.publish(failureTransition);
    }

    await runSyncSideEffect("sync failure wallet log publication", () => {
      walletLog(walletId, "error", "SYNC", retryFailureMessage);
    });

    await runSyncSideEffect("sync failure metrics", () => {
      walletSyncsTotal.inc({ status: "failure" });
    });

    await runSyncSideEffect("dead-letter recording", () => recordDeadLetterSyncFailure(
      walletId,
      errorMessage,
      syncConfig.maxRetryAttempts,
      { lastError: errorMessage },
    ));

    // Continue processing queue
    /* v8 ignore start -- queue continuation callback is covered by sync queue tests */
    await runSyncSideEffect("queue continuation", () => {
      processQueue(state, (wId) => executeSyncJobFn(wId));
    });
    /* v8 ignore stop */

    return {
      success: false,
      addresses: 0,
      transactions: 0,
      utxos: 0,
      error: errorMessage,
    };
  } finally {
    if (attemptStarted && !stateCleared) {
      try {
        const clearedTransition = await clearActiveSyncAttempt(
          walletId,
          walletRepository,
        );
        await syncLifecyclePublisher.publish(clearedTransition);
      } catch (cleanupError) {
        log.error(`[SYNC] Failed to safety-net reset sync state for wallet ${walletId}`, {
          error: getErrorMessage(cleanupError),
        });
      }
    }
    await releaseSyncLock(state, walletId);
  }
}
