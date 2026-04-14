/**
 * Transactions - UTXO Selection Router
 *
 * Endpoints for UTXO selection strategies
 */

import { Router } from 'express';
import { z } from 'zod';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { utxoRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { FeeRateSchema } from '../schemas/common';
import * as selectionService from '../../services/utxoSelectionService';

const router = Router();
const validStrategies = ['privacy', 'efficiency', 'oldest_first', 'largest_first', 'smallest_first'];

const UtxoSelectionBodyBaseSchema = z.object({
  amount: z.unknown().optional(),
  feeRate: z.unknown().optional(),
  strategy: z.unknown().optional(),
  scriptType: z.unknown().optional(),
});

const UtxoCompareStrategiesBodyBaseSchema = UtxoSelectionBodyBaseSchema.omit({ strategy: true });

function validateSelectionFields(data: { amount?: unknown; feeRate?: unknown; strategy?: unknown }, ctx: z.RefinementCtx) {
  if (!data.amount || !data.feeRate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'amount and feeRate are required',
      path: ['amount'],
    });
    return;
  }

  const feeRateResult = FeeRateSchema.safeParse(data.feeRate);
  if (!feeRateResult.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'feeRate must be a positive number',
      path: ['feeRate'],
    });
  }

  const strategy = data.strategy ?? 'efficiency';
  if (!validStrategies.includes(strategy as string)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Invalid strategy. Valid options: ${validStrategies.join(', ')}`,
      path: ['strategy'],
    });
  }
}

const UtxoSelectionBodySchema = UtxoSelectionBodyBaseSchema.superRefine(validateSelectionFields);

const UtxoCompareStrategiesBodySchema = UtxoCompareStrategiesBodyBaseSchema.superRefine(validateSelectionFields);

const utxoSelectionValidationMessage = (issues: Array<{ message: string }>) => {
  if (issues.some(issue => issue.message === 'feeRate must be a positive number')) {
    return 'feeRate must be a positive number';
  }
  const invalidStrategyIssue = issues.find(issue => issue.message.startsWith('Invalid strategy.'));
  if (invalidStrategyIssue) {
    return invalidStrategyIssue.message;
  }
  return 'amount and feeRate are required';
};

/**
 * POST /api/v1/wallets/:walletId/utxos/select
 * Select UTXOs for a transaction using specified strategy
 */
router.post('/wallets/:walletId/utxos/select', requireWalletAccess('view'), validate(
  { body: UtxoSelectionBodySchema },
  { message: utxoSelectionValidationMessage }
), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { amount, feeRate, strategy = 'efficiency', scriptType } = req.body;
  const parsedFeeRate = FeeRateSchema.parse(feeRate);

  const result = await selectionService.selectUtxos({
    walletId,
    targetAmount: BigInt(amount),
    feeRate: parsedFeeRate,
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
router.post('/wallets/:walletId/utxos/compare-strategies', requireWalletAccess('view'), validate(
  { body: UtxoCompareStrategiesBodySchema },
  { message: utxoSelectionValidationMessage }
), asyncHandler(async (req, res) => {
  const walletId = req.walletId!;
  const { amount, feeRate, scriptType } = req.body;
  const parsedFeeRate = FeeRateSchema.parse(feeRate);

  const results = await selectionService.compareStrategies(
    walletId,
    BigInt(amount),
    parsedFeeRate,
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
  const feeRate = z.coerce.number().min(1).catch(10).safeParse(req.query.feeRate).data ?? 10;
  const prioritizePrivacy = req.query.prioritizePrivacy === 'true';

  // Get UTXO count
  const utxoCount = await utxoRepository.countUnspentUnfrozen(walletId);

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
