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
import { withTimeout } from "../../utils/async";
import { getConfig } from "../../config";
import { eventService } from "../eventService";
import { recordSyncFailure } from "../deadLetterQueue";
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
import { formatRetryError, resumeRetryCount } from "./retryLadder";

const log = createLogger("SYNC:SVC_WALLET");

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
 * How long a cancelled sync may take to unwind before the lock is reclaimed
 * anyway. Cancellation is cooperative, so a call blocked below the pipeline's
 * checkpoints would otherwise hold the lock — and the wallet — forever.
 */
const SYNC_ABORT_GRACE_MS = 30_000;

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
      .findByIdWithSelect(walletId, { lastSyncStatus: true, lastSyncError: true })
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

  // Mark sync in progress
  await walletRepository.update(walletId, { syncInProgress: true });

  // Get retry config
  const syncConfig = getConfig().sync;

  // Notify sync starting via WebSocket
  const notificationService = getNotificationService();
  notificationService.broadcastSyncStatus(walletId, {
    inProgress: true,
    retryCount,
    maxRetries: syncConfig.maxRetryAttempts,
  });

  // Emit sync started event
  eventService.emitWalletSyncStarted(walletId, false);

  try {
    const startTime = Date.now();
    log.info(
      `[SYNC] Starting sync for wallet ${walletId}${retryCount > 0 ? ` (retry ${retryCount}/${syncConfig.maxRetryAttempts})` : ""}`,
    );
    walletLog(
      walletId,
      "info",
      "SYNC",
      retryCount > 0
        ? `Sync started (retry ${retryCount}/${syncConfig.maxRetryAttempts})`
        : "Sync started",
    );

    // Get previous balance for comparison
    const previousBalances = await getWalletBalance(walletId);
    const previousTotal =
      previousBalances.confirmed + previousBalances.unconfirmed;

    // Execute sync and keep lock ownership until the underlying promise settles.
    // The timeout cancels rather than merely observing: the lock and the
    // in-memory activeSyncs entry are released in the finally below, which a
    // promise that never settles never reaches. Leaving that entry behind
    // wedges the wallet for the life of the process, because acquireSyncLock
    // short-circuits on it before ever consulting Redis - so every later sync
    // returns "Already syncing" long after the Redis lock TTL has expired.
    const abortController = new AbortController();
    const syncPromise = syncWallet(walletId, 0, abortController.signal);
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timeoutHandle = setTimeout(
        () => resolve({ timedOut: true }),
        syncConfig.maxSyncDurationMs,
      );
    });

    let result: Awaited<ReturnType<typeof syncWallet>>;
    const raced = await Promise.race([
      syncPromise.then((value) => ({ timedOut: false as const, value })),
      timeoutPromise,
    ]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    if (raced.timedOut) {
      const timeoutSeconds = Math.round(syncConfig.maxSyncDurationMs / 1000);
      log.warn(
        `[SYNC] Wallet ${walletId} exceeded configured sync threshold (${timeoutSeconds}s); cancelling`,
      );
      walletLog(
        walletId,
        "warn",
        "SYNC",
        `Sync exceeded the ${timeoutSeconds}s limit and was cancelled`,
      );
      abortController.abort(
        new Error(`Sync exceeded the ${timeoutSeconds}s limit and was cancelled`),
      );
      // Cancellation is cooperative - the pipeline checks the signal at phase
      // boundaries. Bound the wait so a call stuck below those checkpoints
      // cannot hold the lock open indefinitely either. Abandoning the promise
      // risks a late write after the lock is released; that is the lesser evil,
      // because the Redis lock has a TTL while a leaked activeSyncs entry does
      // not and would wedge the wallet for the life of the process.
      // withTimeout keeps the abandoned rejection handled on our behalf.
      result = await withTimeout(
        syncPromise,
        SYNC_ABORT_GRACE_MS,
        `Sync exceeded the ${timeoutSeconds}s limit and did not respond to cancellation`,
      );
    } else {
      result = raced.value;
    }

    // Populate missing fields for any existing transactions
    walletLog(
      walletId,
      "info",
      "SYNC",
      "Completing sync (populating transaction details)...",
    );
    const populateResult = await populateMissingTransactionFields(walletId);
    if (populateResult.updated > 0) {
      log.info(
        `[SYNC] Populated missing fields for ${populateResult.updated} existing transactions`,
      );
      walletLog(
        walletId,
        "info",
        "SYNC",
        `Populated details for ${populateResult.updated} transactions`,
      );
    }

    // Get new balance (confirmed and unconfirmed)
    const newBalances = await getWalletBalance(walletId);
    const newTotal = newBalances.confirmed + newBalances.unconfirmed;

    // Update sync metadata
    await walletRepository.update(walletId, {
      lastSyncedAt: new Date(),
      lastSyncStatus: "success",
      lastSyncError: null,
      syncInProgress: false,
    });

    const duration = Date.now() - startTime;
    log.info(
      `[SYNC] Completed sync for wallet ${walletId}: ${result.transactions} tx, ${result.utxos} utxos`,
    );
    walletLog(
      walletId,
      "info",
      "SYNC",
      `Sync complete (${result.transactions} transactions, ${result.utxos} UTXOs)`,
    );

    // Record sync metrics
    walletSyncsTotal.inc({ status: "success" });
    walletSyncDuration.observe({ walletType: "all" }, duration / 1000);

    // Emit wallet synced event (handles both event bus and WebSocket)
    eventService.emitWalletSynced({
      walletId,
      balance: BigInt(newBalances.confirmed),
      unconfirmedBalance: BigInt(newBalances.unconfirmed),
      transactionCount: result.transactions,
      duration,
    });

    // Always notify sync completion via WebSocket
    notificationService.broadcastSyncStatus(walletId, {
      inProgress: false,
      status: "success",
      lastSyncedAt: new Date(),
    });

    // Notify via WebSocket if balance changed (confirmed or unconfirmed)
    if (
      newTotal !== previousTotal ||
      newBalances.unconfirmed !== previousBalances.unconfirmed
    ) {
      notificationService.broadcastBalanceUpdate({
        walletId,
        balance: newBalances.confirmed,
        unconfirmed: newBalances.unconfirmed,
        previousBalance: previousBalances.confirmed,
        change: newBalances.confirmed - previousBalances.confirmed,
      });
    }

    // Continue processing queue
    /* v8 ignore start -- queue continuation callback is covered by sync queue tests */
    processQueue(state, (wId) => executeSyncJobFn(wId));
    /* v8 ignore stop */

    return {
      success: true,
      ...result,
    };
  } catch (error) {
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

      log.info(
        `[SYNC] Will retry wallet ${walletId} in ${delayMs / 1000}s (attempt ${nextRetry}/${syncConfig.maxRetryAttempts})`,
      );
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

      // Notify that we're retrying
      notificationService.broadcastSyncStatus(walletId, {
        inProgress: true,
        status: "retrying",
        error: errorMessage,
        retryCount: nextRetry,
        maxRetries: syncConfig.maxRetryAttempts,
        retryingIn: delayMs,
      });

      // Update DB to show retrying state
      await walletRepository.update(walletId, {
        lastSyncStatus: "retrying",
        lastSyncError: formatRetryError(errorMessage, nextRetry, syncConfig.maxRetryAttempts),
        syncInProgress: false, // Will be set to true when retry starts
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
    walletLog(walletId, "error", "SYNC", retryFailureMessage);

    // Record sync failure metric
    walletSyncsTotal.inc({ status: "failure" });

    // Record in dead letter queue for visibility
    await recordSyncFailure(
      walletId,
      errorMessage,
      syncConfig.maxRetryAttempts,
      {
        lastError: errorMessage,
      },
    );

    // Emit sync failed event
    eventService.emitWalletSyncFailed(
      walletId,
      errorMessage,
      syncConfig.maxRetryAttempts,
    );

    // Update sync metadata with final error
    await walletRepository.update(walletId, {
      lastSyncStatus: "failed",
      lastSyncError: errorMessage,
      syncInProgress: false,
    });

    // Notify sync failure via WebSocket
    notificationService.broadcastSyncStatus(walletId, {
      inProgress: false,
      status: "failed",
      error: errorMessage,
      retriesExhausted: true,
    });

    // Continue processing queue
    /* v8 ignore start -- queue continuation callback is covered by sync queue tests */
    processQueue(state, (wId) => executeSyncJobFn(wId));
    /* v8 ignore stop */

    return {
      success: false,
      addresses: 0,
      transactions: 0,
      utxos: 0,
      error: errorMessage,
    };
  } finally {
    await releaseSyncLock(state, walletId);
  }
}
