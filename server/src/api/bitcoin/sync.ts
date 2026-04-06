/**
 * Bitcoin - Sync Router
 *
 * Wallet synchronization and confirmation update operations
 */

import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import * as blockchain from '../../services/bitcoin/blockchain';
import { findByIdWithAccess } from '../../repositories/walletRepository';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError } from '../../errors/ApiError';

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

  // Check user has access to wallet
  const wallet = await findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const result = await blockchain.syncWallet(walletId);

  res.json({
    message: 'Wallet synced successfully',
    ...result,
  });
}));

/**
 * POST /api/v1/bitcoin/wallet/:walletId/update-confirmations
 * Update transaction confirmations for a wallet
 */
router.post('/wallet/:walletId/update-confirmations', asyncHandler(async (req, res) => {
  const userId = req.user!.userId;
  const { walletId } = req.params;

  // Check user has access to wallet
  const wallet = await findByIdWithAccess(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  const updated = await blockchain.updateTransactionConfirmations(walletId);

  res.json({
    message: 'Confirmations updated',
    updated,
  });
}));

export default router;
