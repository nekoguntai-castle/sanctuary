/**
 * Transactions - UTXO Selection Router
 *
 * Endpoints for UTXO selection strategies
 */

import { Router } from 'express';
import { z } from 'zod';
import {
  DEFAULT_UTXO_SELECTION_STRATEGY,
  UTXO_SELECTION_STRATEGIES,
} from '@sanctuary/shared/constants/transactions';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { utxoRepository } from '../../repositories';
import { asyncHandler } from '../../errors/errorHandler';
import { FeeRateSchema } from '../schemas/common';
import * as selectionService from '../../services/utxoSelectionService';

const router = Router();
const MAX_SAFE_SATS = BigInt(Number.MAX_SAFE_INTEGER);
const UtxoAmountInputSchema = z.union([z.string(), z.number()]);
const UtxoFeeRateInputSchema = z.union([z.string(), z.number()]);
const UtxoSelectionStrategySchema = z.enum(UTXO_SELECTION_STRATEGIES);

type UtxoAmountInput = z.infer<typeof UtxoAmountInputSchema>;

function parseUtxoAmount(value: UtxoAmountInput): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return null;
    }
    if (value <= 0) {
      return null;
    }
    return BigInt(value);
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const amount = BigInt(value);
  if (amount <= BigInt(0)) {
    return null;
  }
  if (amount > MAX_SAFE_SATS) {
    return null;
  }

  return amount;
}

const UtxoAmountSchema = UtxoAmountInputSchema.transform((value, ctx) => {
  const amount = parseUtxoAmount(value);
  if (amount === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'amount must be a positive safe integer',
    });
    return z.NEVER;
  }
  return amount;
});

function validateSelectionFields(
  data: { amount?: bigint; feeRate?: z.infer<typeof UtxoFeeRateInputSchema> },
  ctx: z.RefinementCtx
) {
  if (data.amount === undefined || data.feeRate === undefined) {
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
}

const UtxoSelectionBodySchema = z.object({
  amount: UtxoAmountSchema.optional(),
  feeRate: UtxoFeeRateInputSchema.optional(),
  strategy: UtxoSelectionStrategySchema.optional().default(DEFAULT_UTXO_SELECTION_STRATEGY),
  scriptType: z.string().min(1).optional(),
}).strict().superRefine(validateSelectionFields);

const UtxoCompareStrategiesBodySchema = z.object({
  amount: UtxoAmountSchema.optional(),
  feeRate: UtxoFeeRateInputSchema.optional(),
  scriptType: z.string().min(1).optional(),
}).strict().superRefine(validateSelectionFields);

type UtxoSelectionBody = z.infer<typeof UtxoSelectionBodySchema>;
type UtxoCompareStrategiesBody = z.infer<typeof UtxoCompareStrategiesBodySchema>;

const utxoSelectionValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => issue.message === 'amount and feeRate are required')) {
    return 'amount and feeRate are required';
  }
  if (issues.some(issue => issue.path === 'amount')) {
    return 'amount must be a positive safe integer';
  }
  if (issues.some(issue => issue.path === 'feeRate')) {
    return 'feeRate must be a positive number';
  }
  if (issues.some(issue => issue.path === 'strategy')) {
    return `Invalid strategy. Valid options: ${UTXO_SELECTION_STRATEGIES.join(', ')}`;
  }
  if (issues.some(issue => issue.path === 'scriptType')) {
    return 'scriptType must be a non-empty string';
  }
  return 'Invalid UTXO selection request';
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
  const { amount, feeRate, strategy, scriptType } = req.body as UtxoSelectionBody;
  const parsedFeeRate = FeeRateSchema.parse(feeRate);
  const targetAmount = amount as bigint;

  const result = await selectionService.selectUtxos({
    walletId,
    targetAmount,
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
  const { amount, feeRate, scriptType } = req.body as UtxoCompareStrategiesBody;
  const parsedFeeRate = FeeRateSchema.parse(feeRate);
  const targetAmount = amount as bigint;

  const results = await selectionService.compareStrategies(
    walletId,
    targetAmount,
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
  /* v8 ignore next -- schema catch provides default fee rate for malformed query input */
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
