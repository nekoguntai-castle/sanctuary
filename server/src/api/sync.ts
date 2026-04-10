/**
 * Sync API Routes
 *
 * API endpoints for wallet synchronization management
 */

import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { rateLimitByUser } from '../middleware/rateLimit';
import { getSyncService } from '../services/syncService';
import { enqueueWalletSyncBatch } from '../services/workerSyncQueue';
import { walletRepository, transactionRepository, addressRepository } from '../repositories';
import { createLogger } from '../utils/logger';
import { walletLogBuffer } from '../services/walletLogBuffer';
import { asyncHandler } from '../errors/errorHandler';
import { NotFoundError, InvalidInputError } from '../errors/ApiError';
import { getConfig } from '../config';
import type { NetworkType } from '../config';

const router = Router();
const log = createLogger('SYNC:ROUTE');

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/sync/wallet/:walletId
 * Trigger immediate sync for a wallet
 */
router.post('/wallet/:walletId', rateLimitByUser('sync:trigger'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const syncService = getSyncService();
  const result = await syncService.syncNow(walletId);

  res.json({
    success: result.success,
    syncedAddresses: result.addresses,
    newTransactions: result.transactions,
    newUtxos: result.utxos,
    error: result.error,
  });
}));

/**
 * POST /api/v1/sync/queue/:walletId
 * Queue a wallet for background sync
 */
router.post('/queue/:walletId', rateLimitByUser('sync:trigger'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;
  const { priority = 'normal' } = req.body;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const syncService = getSyncService();
  syncService.queueSync(walletId, priority);

  const status = await syncService.getSyncStatus(walletId);

  res.json({
    queued: true,
    queuePosition: status.queuePosition,
    syncInProgress: status.syncInProgress,
  });
}));

/**
 * GET /api/v1/sync/status/:walletId
 * Get sync status for a wallet
 */
router.get('/status/:walletId', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const syncService = getSyncService();
  const status = await syncService.getSyncStatus(walletId);

  res.json(status);
}));

/**
 * GET /api/v1/sync/logs/:walletId
 * Get buffered sync logs for a wallet
 * Returns the most recent logs stored in memory (up to 200 entries)
 */
router.get('/logs/:walletId', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const logs = walletLogBuffer.get(walletId);

  res.json({ logs });
}));

/**
 * POST /api/v1/sync/user
 * Queue all user's wallets for background sync (called on login/page load)
 */
router.post('/user', rateLimitByUser('sync:batch'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { priority = 'normal' } = req.body;

  const syncService = getSyncService();
  await syncService.queueUserWallets(userId, priority);

  res.json({
    success: true,
    message: 'All wallets queued for sync',
  });
}));

/**
 * POST /api/v1/sync/reset/:walletId
 * Reset a stuck sync state
 */
router.post('/reset/:walletId', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Reset the sync state
  await walletRepository.updateSyncState(walletId, { syncInProgress: false });

  res.json({
    success: true,
    message: 'Sync state reset',
  });
}));

/**
 * POST /api/v1/sync/resync/:walletId
 * Full resync - clears all transactions and re-syncs from blockchain
 * Use this to fix missing transactions (e.g., sent transactions)
 */
router.post('/resync/:walletId', rateLimitByUser('sync:trigger'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  // Check user has access to wallet
  const wallet = await walletRepository.findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  // Full resync should reset everything, including stuck sync flags
  // Don't block on syncInProgress - that's the point of a full resync
  if (wallet.syncInProgress) {
    log.info(`[SYNC_API] Full resync clearing stuck syncInProgress for wallet ${walletId}`);
  }

  // Clear all transactions for this wallet
  const deletedCount = await transactionRepository.deleteByWalletId(walletId);

  // Reset address used flags so they get properly marked during sync
  await addressRepository.resetUsedFlags(walletId);

  // Reset the wallet sync state
  await walletRepository.resetSyncState(walletId);

  // Trigger immediate high-priority sync
  const syncService = getSyncService();
  syncService.queueSync(walletId, 'high');

  res.json({
    success: true,
    message: `Cleared ${deletedCount} transactions. Full resync queued.`,
    deletedTransactions: deletedCount,
  });
}));

/**
 * POST /api/v1/sync/network/:network
 * Queue all user's wallets for a specific network
 */
router.post('/network/:network', rateLimitByUser('sync:batch'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { network } = req.params;
  const { priority = 'normal' } = req.body;

  // Validate network
  if (!['mainnet', 'testnet', 'signet'].includes(network)) {
    throw new InvalidInputError('Invalid network. Must be mainnet, testnet, or signet.');
  }

  // Find all user's wallets for this network
  const walletIds = await walletRepository.getIdsByNetwork(userId, network as NetworkType);

  if (walletIds.length === 0) {
    return res.json({
      success: true,
      queued: 0,
      walletIds: [],
      message: `No ${network} wallets found`,
    });
  }

  const queued = await enqueueWalletSyncBatch(walletIds, {
    priority,
    reason: `manual-network-sync:${network}`,
    staggerDelayMs: getConfig().sync.syncStaggerDelayMs,
    jobIdPrefix: `manual-network-sync:${network}:${userId}`,
  });

  res.json({
    success: true,
    queued,
    walletIds,
  });
}));

/**
 * POST /api/v1/sync/network/:network/resync
 * Full resync for all user's wallets of a specific network
 * Requires X-Confirm-Resync: true header
 */
router.post('/network/:network/resync', rateLimitByUser('sync:batch'), asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { network } = req.params;

  // Validate network
  if (!['mainnet', 'testnet', 'signet'].includes(network)) {
    throw new InvalidInputError('Invalid network. Must be mainnet, testnet, or signet.');
  }

  // Require confirmation header for destructive operation
  const confirmHeader = req.headers['x-confirm-resync'];
  if (confirmHeader !== 'true') {
    throw new InvalidInputError('Full resync requires X-Confirm-Resync: true header');
  }

  // Find all user's wallets for this network with sync status
  const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, network as NetworkType);

  if (wallets.length === 0) {
    return res.json({
      success: true,
      queued: 0,
      walletIds: [],
      message: `No ${network} wallets found`,
    });
  }

  // Full resync should reset everything, including stuck sync flags
  // Don't skip wallets with syncInProgress - that's the point of a full resync
  const stuckWallets = wallets.filter(w => w.syncInProgress);
  if (stuckWallets.length > 0) {
    log.info(`[SYNC_API] Full network resync clearing ${stuckWallets.length} stuck syncInProgress flags`);
  }

  const walletIds = wallets.map(w => w.id);

  // Clear transactions and reset state for each wallet
  let totalDeletedTxs = 0;
  for (const walletId of walletIds) {
    const deletedCount = await transactionRepository.deleteByWalletId(walletId);
    totalDeletedTxs += deletedCount;

    // Reset address used flags
    await addressRepository.resetUsedFlags(walletId);

    // Reset wallet sync state
    await walletRepository.resetSyncState(walletId);
  }

  const queued = await enqueueWalletSyncBatch(walletIds, {
    priority: 'high',
    reason: `manual-network-resync:${network}`,
    staggerDelayMs: getConfig().sync.syncStaggerDelayMs,
    jobIdPrefix: `manual-network-resync:${network}:${userId}`,
  });

  res.json({
    success: true,
    queued,
    walletIds,
    deletedTransactions: totalDeletedTxs,
    clearedStuckFlags: stuckWallets.length,
  });
}));

/**
 * GET /api/v1/sync/network/:network/status
 * Get aggregate sync status for all wallets of a network
 */
router.get('/network/:network/status', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { network } = req.params;

  // Validate network
  if (!['mainnet', 'testnet', 'signet'].includes(network)) {
    throw new InvalidInputError('Invalid network. Must be mainnet, testnet, or signet.');
  }

  // Find all user's wallets for this network with sync status
  const wallets = await walletRepository.findByNetworkWithSyncStatus(userId, network as NetworkType);

  const syncing = wallets.filter(w => w.syncInProgress).length;
  const synced = wallets.filter(w => !w.syncInProgress && w.lastSyncStatus === 'success').length;
  const failed = wallets.filter(w => !w.syncInProgress && w.lastSyncStatus === 'failed').length;
  const pending = wallets.filter(w => !w.syncInProgress && !w.lastSyncStatus).length;

  // Find the most recent sync time
  const syncTimes = wallets
    .filter(w => w.lastSyncedAt)
    .map(w => new Date(w.lastSyncedAt!).getTime());
  const lastSyncAt = syncTimes.length > 0 ? new Date(Math.max(...syncTimes)).toISOString() : null;

  res.json({
    network,
    total: wallets.length,
    syncing,
    synced,
    failed,
    pending,
    lastSyncAt,
  });
}));

export default router;
