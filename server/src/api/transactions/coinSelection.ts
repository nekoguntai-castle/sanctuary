/**
 * Transactions - UTXO Selection Router
 *
 * Endpoints for UTXO selection strategies
 */

import { Router } from 'express';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { db as prisma } from '../../repositories/db';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError } from '../../errors/ApiError';
import * as selectionService from '../../services/utxoSelectionService';

const router = Router();

/**
 * POST /api/v1/wallets/:walletId/utxos/select
 * Select UTXOs for a transaction using specified strategy
 */
router.post('/wallets/:walletId/utxos/select', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { amount, feeRate, strategy = 'efficiency', scriptType } = req.body;

  if (!amount || !feeRate) {
    throw new ValidationError('amount and feeRate are required');
  }

  const feeRateNum = parseFloat(feeRate);
  if (isNaN(feeRateNum) || feeRateNum <= 0) {
    throw new ValidationError('feeRate must be a positive number');
  }

  const validStrategies = ['privacy', 'efficiency', 'oldest_first', 'largest_first', 'smallest_first'];
  if (!validStrategies.includes(strategy)) {
    throw new ValidationError(`Invalid strategy. Valid options: ${validStrategies.join(', ')}`);
  }

  const result = await selectionService.selectUtxos({
    walletId,
    targetAmount: BigInt(amount),
    feeRate: feeRateNum,
    strategy,
    scriptType,
  });

  // Convert BigInt to number for JSON serialization
  res.json({
    selected: result.selected.map(u => ({
      ...u,
      amount: Number(u.amount),
    })),
    totalAmount: Number(result.totalAmount),
    estimatedFee: Number(result.estimatedFee),
    changeAmount: Number(result.changeAmount),
    inputCount: result.inputCount,
    strategy: result.strategy,
    warnings: result.warnings,
    privacyImpact: result.privacyImpact,
  });
}));

/**
 * POST /api/v1/wallets/:walletId/utxos/compare-strategies
 * Compare different UTXO selection strategies for a given amount
 */
router.post('/wallets/:walletId/utxos/compare-strategies', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { amount, feeRate, scriptType } = req.body;

  if (!amount || !feeRate) {
    throw new ValidationError('amount and feeRate are required');
  }

  const feeRateNum = parseFloat(feeRate);
  if (isNaN(feeRateNum) || feeRateNum <= 0) {
    throw new ValidationError('feeRate must be a positive number');
  }

  const results = await selectionService.compareStrategies(
    walletId,
    BigInt(amount),
    feeRateNum,
    scriptType
  );

  // Convert BigInt to number for JSON serialization
  const serialized: Record<string, unknown> = {};
  for (const [strategy, result] of Object.entries(results)) {
    serialized[strategy] = {
      selected: result.selected.map(u => ({
        ...u,
        amount: Number(u.amount),
      })),
      totalAmount: Number(result.totalAmount),
      estimatedFee: Number(result.estimatedFee),
      changeAmount: Number(result.changeAmount),
      inputCount: result.inputCount,
      strategy: result.strategy,
      warnings: result.warnings,
      privacyImpact: result.privacyImpact,
    };
  }

  res.json(serialized);
}));

/**
 * GET /api/v1/wallets/:walletId/utxos/recommended-strategy
 * Get recommended UTXO selection strategy based on wallet and fee context
 */
router.get('/wallets/:walletId/utxos/recommended-strategy', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const feeRate = parseFloat(req.query.feeRate as string) || 10;
  const prioritizePrivacy = req.query.prioritizePrivacy === 'true';

  // Get UTXO count
  const utxoCount = await prisma.uTXO.count({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
  });

  const recommendation = selectionService.getRecommendedStrategy(
    utxoCount,
    feeRate,
    prioritizePrivacy
  );

  res.json({
    ...recommendation,
    utxoCount,
    feeRate,
  });
}));

export default router;
