/**
 * Sync API Routes
 *
 * API endpoints for wallet synchronization management
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { rateLimitByUser } from '../middleware/rateLimit';
import { validate } from '../middleware/validate';
import { getSyncCoordinator, type SyncPriority } from '../services/sync/syncCoordinator';
import { asyncHandler } from '../errors/errorHandler';

const router = Router();

const SyncPriorityBodySchema = z.object({
  priority: z.unknown().optional(),
}).passthrough().catch({});

function readPriority(body: unknown): SyncPriority {
  /* v8 ignore next -- JSON body middleware provides an object for this route */
  if (!body || typeof body !== 'object') {
    return 'normal';
  }

  return ((body as { priority?: SyncPriority }).priority ?? 'normal');
}

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/sync/wallet/:walletId
 * Trigger immediate sync for a wallet
 */
router.post('/wallet/:walletId', rateLimitByUser('sync:trigger'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().syncWalletNow(userId, walletId));
}));

/**
 * POST /api/v1/sync/queue/:walletId
 * Queue a wallet for background sync
 */
router.post('/queue/:walletId', rateLimitByUser('sync:trigger'), validate(
  { body: SyncPriorityBodySchema }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;
  const priority = readPriority(req.body);

  res.json(await getSyncCoordinator().queueWalletSync(userId, walletId, priority));
}));

/**
 * GET /api/v1/sync/status/:walletId
 * Get sync status for a wallet
 */
router.get('/status/:walletId', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().getWalletSyncStatus(userId, walletId));
}));

/**
 * GET /api/v1/sync/logs/:walletId
 * Get buffered sync logs for a wallet
 * Returns the most recent logs stored in memory (up to 200 entries)
 */
router.get('/logs/:walletId', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().getWalletSyncLogs(userId, walletId));
}));

/**
 * POST /api/v1/sync/user
 * Queue all user's wallets for background sync (called on login/page load)
 */
router.post('/user', rateLimitByUser('sync:batch'), validate(
  { body: SyncPriorityBodySchema }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const priority = readPriority(req.body);

  res.json(await getSyncCoordinator().queueUserWallets(userId, priority));
}));

/**
 * POST /api/v1/sync/reset/:walletId
 * Reset a stuck sync state
 */
router.post('/reset/:walletId', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().resetWalletSyncState(userId, walletId));
}));

/**
 * POST /api/v1/sync/resync/:walletId
 * Full resync - clears all transactions and re-syncs from blockchain
 * Use this to fix missing transactions (e.g., sent transactions)
 */
router.post('/resync/:walletId', rateLimitByUser('sync:trigger'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().resyncWallet(userId, walletId));
}));

/**
 * POST /api/v1/sync/network/:network
 * Queue all user's wallets for a specific network
 */
router.post('/network/:network', rateLimitByUser('sync:batch'), validate(
  { body: SyncPriorityBodySchema }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { network } = req.params;
  const priority = readPriority(req.body);

  res.json(await getSyncCoordinator().queueNetworkSync(userId, network, priority));
}));

/**
 * POST /api/v1/sync/network/:network/resync
 * Full resync for all user's wallets of a specific network
 * Requires X-Confirm-Resync: true header
 */
router.post('/network/:network/resync', rateLimitByUser('sync:batch'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { network } = req.params;
  const confirmed = req.headers['x-confirm-resync'] === 'true';

  res.json(await getSyncCoordinator().resyncNetwork(userId, network, confirmed));
}));

/**
 * GET /api/v1/sync/network/:network/status
 * Get aggregate sync status for all wallets of a network
 */
router.get('/network/:network/status', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { network } = req.params;

  res.json(await getSyncCoordinator().getNetworkSyncStatus(userId, network));
}));

export default router;
