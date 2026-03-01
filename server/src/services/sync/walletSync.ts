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

import { db as prisma } from '../../repositories/db';
import { syncWallet, populateMissingTransactionFields } from '../bitcoin/blockchain';
import { getNotificationService, walletLog } from '../../websocket/notifications';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getConfig } from '../../config';
import { eventService } from '../eventService';
import { recordSyncFailure } from '../deadLetterQueue';
import { acquireLock, releaseLock } from '../../infrastructure';
import { walletSyncsTotal, walletSyncDuration } from '../../observability/metrics';
import type { SyncState, SyncResult } from './types';
import { processQueue } from './syncQueue';

const log = createLogger('SYNC:WALLET');

/**
 * Acquire a distributed lock for a wallet sync.
 *
 * Uses Redis for distributed locking across multiple server instances.
 * Falls back to in-memory locks when Redis is unavailable.
 */
export async function acquireSyncLock(state: SyncState, walletId: string): Promise<boolean> {
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
    log.debug(`[SYNC] Could not acquire lock for wallet ${walletId} (already syncing)`);
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
export async function releaseSyncLock(state: SyncState, walletId: string): Promise<void> {
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
export async function getWalletBalance(walletId: string): Promise<{ confirmed: number; unconfirmed: number }> {
  const [confirmedResult, unconfirmedResult] = await Promise.all([
    // Confirmed: UTXOs with a block height
    prisma.uTXO.aggregate({
      where: {
        walletId,
        spent: false,
        blockHeight: { not: null },
      },
      _sum: {
        amount: true,
      },
    }),
    // Unconfirmed: UTXOs without a block height (still in mempool)
    prisma.uTXO.aggregate({
      where: {
        walletId,
        spent: false,
        blockHeight: null,
      },
      _sum: {
        amount: true,
      },
    }),
  ]);

  return {
    confirmed: Number(confirmedResult._sum.amount || 0),
    unconfirmed: Number(unconfirmedResult._sum.amount || 0),
  };
}

/**
 * Execute a sync job for a wallet with retry support.
 *
 * @param executeSyncJobFn - Self-reference for retry scheduling (avoids circular dependency).
 */
export async function executeSyncJob(
  state: SyncState,
  walletId: string,
  executeSyncJobFn: (walletId: string, retryCount?: number) => Promise<SyncResult>,
  retryCount: number = 0,
): Promise<SyncResult> {
  // Try to acquire distributed lock - prevents race conditions across instances
  if (!await acquireSyncLock(state, walletId)) {
    return { success: false, addresses: 0, transactions: 0, utxos: 0, error: 'Already syncing' };
  }

  // Mark sync in progress
  await prisma.wallet.update({
    where: { id: walletId },
    data: { syncInProgress: true },
  });

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
    log.info(`[SYNC] Starting sync for wallet ${walletId}${retryCount > 0 ? ` (retry ${retryCount}/${syncConfig.maxRetryAttempts})` : ''}`);
    walletLog(walletId, 'info', 'SYNC', retryCount > 0
      ? `Sync started (retry ${retryCount}/${syncConfig.maxRetryAttempts})`
      : 'Sync started');

    // Get previous balance for comparison
    const previousBalances = await getWalletBalance(walletId);
    const previousTotal = previousBalances.confirmed + previousBalances.unconfirmed;

    // Execute sync and keep lock ownership until the underlying promise settles.
    // Important: Promise.race timeouts do not cancel syncWallet(), which could otherwise
    // keep mutating DB after lock release and race with retries/other workers.
    const syncPromise = syncWallet(walletId);
    let timeoutHandle: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<{ timedOut: true }>((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ timedOut: true }), syncConfig.maxSyncDurationMs);
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
      log.warn(
        `[SYNC] Wallet ${walletId} exceeded configured sync threshold (${syncConfig.maxSyncDurationMs / 1000}s); waiting for completion`
      );
      walletLog(
        walletId,
        'warn',
        'SYNC',
        `Sync is taking longer than expected (${Math.round(syncConfig.maxSyncDurationMs / 1000)}s), continuing...`
      );
      result = await syncPromise;
    } else {
      result = raced.value;
    }

    // Populate missing fields for any existing transactions
    walletLog(walletId, 'info', 'SYNC', 'Completing sync (populating transaction details)...');
    const populateResult = await populateMissingTransactionFields(walletId);
    if (populateResult.updated > 0) {
      log.info(`[SYNC] Populated missing fields for ${populateResult.updated} existing transactions`);
      walletLog(walletId, 'info', 'SYNC', `Populated details for ${populateResult.updated} transactions`);
    }

    // Get new balance (confirmed and unconfirmed)
    const newBalances = await getWalletBalance(walletId);
    const newTotal = newBalances.confirmed + newBalances.unconfirmed;

    // Update sync metadata
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        lastSyncedAt: new Date(),
        lastSyncStatus: 'success',
        lastSyncError: null,
        syncInProgress: false,
      },
    });

    const duration = Date.now() - startTime;
    log.info(`[SYNC] Completed sync for wallet ${walletId}: ${result.transactions} tx, ${result.utxos} utxos`);
    walletLog(walletId, 'info', 'SYNC', `Sync complete (${result.transactions} transactions, ${result.utxos} UTXOs)`);

    // Record sync metrics
    walletSyncsTotal.inc({ status: 'success' });
    walletSyncDuration.observe({ walletType: 'all' }, duration / 1000);

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
      status: 'success',
      lastSyncedAt: new Date(),
    });

    // Notify via WebSocket if balance changed (confirmed or unconfirmed)
    if (newTotal !== previousTotal || newBalances.unconfirmed !== previousBalances.unconfirmed) {
      notificationService.broadcastBalanceUpdate({
        walletId,
        balance: newBalances.confirmed,
        unconfirmed: newBalances.unconfirmed,
        previousBalance: previousBalances.confirmed,
        change: newBalances.confirmed - previousBalances.confirmed,
      });
    }

    // Continue processing queue
    processQueue(state, (wId) => executeSyncJobFn(wId));

    return {
      success: true,
      ...result,
    };
  } catch (error) {
    const errorMessage = getErrorMessage(error, 'Unknown error');
    log.error(`[SYNC] Sync failed for wallet ${walletId}:`, { error: errorMessage });

    // Check if we should retry
    if (retryCount < syncConfig.maxRetryAttempts) {
      const nextRetry = retryCount + 1;
      const delayMs = syncConfig.retryDelaysMs[retryCount] || syncConfig.retryDelaysMs[syncConfig.retryDelaysMs.length - 1];

      log.info(`[SYNC] Will retry wallet ${walletId} in ${delayMs / 1000}s (attempt ${nextRetry}/${syncConfig.maxRetryAttempts})`);
      walletLog(walletId, 'warn', 'SYNC', `Sync failed: ${errorMessage}. Retrying in ${delayMs / 1000}s...`, {
        attempt: nextRetry,
        maxAttempts: syncConfig.maxRetryAttempts,
      });

      // Notify that we're retrying
      notificationService.broadcastSyncStatus(walletId, {
        inProgress: true,
        status: 'retrying',
        error: errorMessage,
        retryCount: nextRetry,
        maxRetries: syncConfig.maxRetryAttempts,
        retryingIn: delayMs,
      });

      // Update DB to show retrying state
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          lastSyncStatus: 'retrying',
          lastSyncError: `${errorMessage} (retrying ${nextRetry}/${syncConfig.maxRetryAttempts})`,
          syncInProgress: false, // Will be set to true when retry starts
        },
      });

      // Release distributed lock so retry can acquire it fresh
      await releaseSyncLock(state, walletId);

      // Schedule retry with delay (track timer for cleanup on shutdown)
      const retryTimer = setTimeout(() => {
        state.pendingRetries.delete(walletId);
        executeSyncJobFn(walletId, nextRetry).catch(err => {
          log.error(`[SYNC] Retry failed for wallet ${walletId}`, { error: getErrorMessage(err) });
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

    // All retries exhausted - final failure
    log.error(`[SYNC] All retries exhausted for wallet ${walletId}`);
    walletLog(walletId, 'error', 'SYNC', `Sync failed after ${syncConfig.maxRetryAttempts} attempts: ${errorMessage}`);

    // Record sync failure metric
    walletSyncsTotal.inc({ status: 'failure' });

    // Record in dead letter queue for visibility
    await recordSyncFailure(walletId, errorMessage, syncConfig.maxRetryAttempts, {
      lastError: errorMessage,
    });

    // Emit sync failed event
    eventService.emitWalletSyncFailed(walletId, errorMessage, syncConfig.maxRetryAttempts);

    // Update sync metadata with final error
    await prisma.wallet.update({
      where: { id: walletId },
      data: {
        lastSyncStatus: 'failed',
        lastSyncError: errorMessage,
        syncInProgress: false,
      },
    });

    // Notify sync failure via WebSocket
    notificationService.broadcastSyncStatus(walletId, {
      inProgress: false,
      status: 'failed',
      error: errorMessage,
      retriesExhausted: true,
    });

    // Continue processing queue
    processQueue(state, (wId) => executeSyncJobFn(wId));

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
