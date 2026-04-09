/**
 * Transactions - Privacy Analysis Router
 *
 * Endpoints for UTXO privacy scoring and spend analysis
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import { checkWalletAccess } from '../../services/accessControl';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError, ForbiddenError, UnauthorizedError, ValidationError } from '../../errors/ApiError';
import * as privacyService from '../../services/privacyService';

const router = Router();

/**
 * GET /api/v1/wallets/:walletId/privacy
 * Get privacy analysis for all UTXOs in a wallet
 */
router.get('/wallets/:walletId/privacy', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;

  const result = await privacyService.calculateWalletPrivacy(walletId);

  // Convert BigInt to number for JSON serialization
  const utxos = result.utxos.map(u => ({
    ...u,
    amount: Number(u.amount),
  }));

  res.json({
    utxos,
    summary: result.summary,
  });
}));

/**
 * GET /api/v1/utxos/:utxoId/privacy
 * Get privacy score for a single UTXO
 */
router.get('/utxos/:utxoId/privacy', asyncHandler(async (req, res) => {
  const { utxoId } = req.params;
  const userId = req.user?.userId;

  if (!userId) {
    throw new UnauthorizedError();
  }

  // Get UTXO and check wallet access
  const utxo = await prisma.uTXO.findUnique({
    where: { id: utxoId },
    select: { walletId: true },
  });

  if (!utxo) {
    throw new NotFoundError('UTXO not found');
  }

  const access = await checkWalletAccess(utxo.walletId, userId);
  if (!access.hasAccess) {
    throw new ForbiddenError('Access denied');
  }

  const score = await privacyService.calculateUtxoPrivacy(utxoId);

  res.json(score);
}));

/**
 * POST /api/v1/wallets/:walletId/privacy/spend-analysis
 * Analyze privacy impact of spending selected UTXOs together
 */
router.post('/wallets/:walletId/privacy/spend-analysis', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { utxoIds } = req.body;

  if (!Array.isArray(utxoIds)) {
    throw new ValidationError('utxoIds must be an array');
  }

  // Verify all UTXOs belong to this wallet
  const utxos = await prisma.uTXO.findMany({
    where: {
      id: { in: utxoIds },
      walletId,
    },
    select: { id: true },
  });

  if (utxos.length !== utxoIds.length) {
    throw new ValidationError('Some UTXOs not found or do not belong to this wallet');
  }

  const analysis = await privacyService.calculateSpendPrivacy(utxoIds);

  res.json(analysis);
}));

export default router;
