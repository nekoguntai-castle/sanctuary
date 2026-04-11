/**
 * Bitcoin - Sync Router
 *
 * Wallet synchronization and confirmation update operations
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { getSyncCoordinator } from '../../services/sync/syncCoordinator';
import { asyncHandler } from '../../errors/errorHandler';

const router = Router();

// All sync routes require authentication
router.use(authenticate);

/**
 * POST /api/v1/bitcoin/wallet/:walletId/sync
 * Sync wallet with blockchain
 */
router.post('/wallet/:walletId/sync', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().syncLegacyBitcoinWallet(userId, walletId));
}));

/**
 * POST /api/v1/bitcoin/wallet/:walletId/update-confirmations
 * Update transaction confirmations for a wallet
 */
router.post('/wallet/:walletId/update-confirmations', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  res.json(await getSyncCoordinator().updateWalletConfirmations(userId, walletId));
}));

export default router;
