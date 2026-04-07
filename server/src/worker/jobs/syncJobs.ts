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
import type { WorkerJobHandler } from './types';
import type {
  SyncWalletJobData,
  SyncWalletJobResult,
  CheckStaleWalletsJobData,
  CheckStaleWalletsResult,
  UpdateConfirmationsJobData,
  UpdateConfirmationsResult,
} from './types';
import prisma from '../../models/prisma';
import { syncWallet } from '../../services/bitcoin/blockchain';
import {
  updateTransactionConfirmations,
  populateMissingTransactionFields,
} from '../../services/bitcoin/sync/confirmations';
import { setCachedBlockHeight, getCachedBlockHeight } from '../../services/bitcoin/blockchain';
import { getConfig } from '../../config';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const log = createLogger('JOB:SYNC');
const appConfig = getConfig();

// Keep lock alive beyond expected sync duration to avoid concurrent sync overlap.
const SYNC_LOCK_TTL_MS = appConfig.sync.maxSyncDurationMs + 60_000;

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
  options: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
  lockOptions: {
    lockKey: (data) => `sync:wallet:${data.walletId}`,
    lockTtlMs: SYNC_LOCK_TTL_MS,
  },
  handler: async (job: Job<SyncWalletJobData>): Promise<SyncWalletJobResult> => {
    const { walletId, reason } = job.data;
    const startTime = Date.now();

    log.info(`Syncing wallet ${walletId}`, { reason, jobId: job.id });

    // Get wallet network for block height tracking
    const wallet = await prisma.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });

    if (!wallet) {
      log.warn(`Wallet ${walletId} not found, skipping sync`);
      return { success: false, duration: 0, error: 'Wallet not found' };
    }

    // Mark wallet as syncing
    await prisma.wallet.update({
      where: { id: walletId },
      data: { syncInProgress: true },
    });

    try {
      // Execute sync
      const result = await syncWallet(walletId);

      // Populate missing transaction fields
      await populateMissingTransactionFields(walletId);

      // Get current block height for this network
      const network = wallet.network as 'mainnet' | 'testnet' | 'signet' | 'regtest';
      const currentBlockHeight = getCachedBlockHeight(network);

      // Update wallet metadata with block height
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          syncInProgress: false,
          lastSyncedAt: new Date(),
          lastSyncedBlockHeight: currentBlockHeight,
          lastSyncStatus: 'success',
          lastSyncError: null,
        },
      });

      const duration = Date.now() - startTime;

      log.info(`Wallet ${walletId} synced successfully`, {
        duration,
        transactions: result.transactions,
        utxos: result.utxos,
        jobId: job.id,
      });

      return {
        success: true,
        duration,
        transactionsFound: result.transactions,
        utxosUpdated: result.utxos,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      const errorMsg = getErrorMessage(error);

      // Update wallet with error status
      await prisma.wallet.update({
        where: { id: walletId },
        data: {
          syncInProgress: false,
          lastSyncStatus: 'failed',
          lastSyncError: errorMsg,
        },
      });

      log.error(`Wallet ${walletId} sync failed`, {
        error: errorMsg,
        duration,
        jobId: job.id,
        attemptsMade: job.attemptsMade,
      });

      return {
        success: false,
        duration,
        error: errorMsg,
      };
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

    // Find stale wallets, prioritizing those never synced, then oldest first
    // Limited to prevent queue flooding
    const staleWallets = await prisma.wallet.findMany({
      where: {
        OR: [
          { lastSyncedAt: null },
          { lastSyncedAt: { lt: cutoffTime } },
        ],
        syncInProgress: false,
      },
      select: { id: true, name: true, lastSyncedAt: true },
      orderBy: [
        { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
      ],
      take: maxWallets,
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
      const network = config.bitcoin.network as 'mainnet' | 'testnet' | 'signet' | 'regtest';
      setCachedBlockHeight(height, network);
      log.info(`Block height updated to ${height}`, { hash: hash?.slice(0, 16) });
    }

    // Find all wallets with pending transactions (< 6 confirmations)
    const walletsWithPending = await prisma.transaction.findMany({
      where: {
        confirmations: { lt: 6 },
      },
      select: { walletId: true },
      distinct: ['walletId'],
    });

    if (walletsWithPending.length === 0) {
      log.debug('No wallets with pending transactions');
      return { updated: 0, notified: 0 };
    }

    log.debug(`Updating confirmations for ${walletsWithPending.length} wallets`);

    let totalUpdated = 0;
    let totalNotified = 0;

    for (const { walletId } of walletsWithPending) {
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
