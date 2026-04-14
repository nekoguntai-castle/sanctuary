/**
 * Transactions - Privacy Analysis Router
 *
 * Endpoints for UTXO privacy scoring and spend analysis
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { utxoRepository } from '../../repositories';
import { checkWalletAccess } from '../../services/accessControl';
import { asyncHandler } from '../../errors/errorHandler';
import { NotFoundError, ForbiddenError, UnauthorizedError, ValidationError } from '../../errors/ApiError';
import * as privacyService from '../../services/privacyService';

const router = Router();

const SpendAnalysisBodySchema = z.object({
  utxoIds: z.array(z.unknown()),
});

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
  const utxoWalletId = await utxoRepository.findWalletIdByUtxoId(utxoId);

  if (!utxoWalletId) {
    throw new NotFoundError('UTXO not found');
  }

  const access = await checkWalletAccess(utxoWalletId, userId);
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
router.post('/wallets/:walletId/privacy/spend-analysis', requireWalletAccess('view'), validate(
  { body: SpendAnalysisBodySchema },
  { message: 'utxoIds must be an array' }
), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { utxoIds } = req.body;

  // Verify all UTXOs belong to this wallet
  const matchCount = await utxoRepository.countByIdsInWallet(utxoIds, walletId);

  if (matchCount !== utxoIds.length) {
    throw new ValidationError('Some UTXOs not found or do not belong to this wallet');
  }

  const analysis = await privacyService.calculateSpendPrivacy(utxoIds);

  res.json(analysis);
}));

export default router;
