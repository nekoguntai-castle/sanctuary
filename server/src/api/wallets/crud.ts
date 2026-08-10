/**
 * Wallets - CRUD Router
 *
 * Core wallet lifecycle operations (create, read, update, delete)
 */

import { Router } from 'express';
import { z } from 'zod';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import { WalletType, WALLET_TYPE_VALUES, WALLET_SCRIPT_TYPE_VALUES } from '@sanctuary/shared/constants/walletIdentity';
import { requireWalletAccess } from '../../middleware/walletAccess';
import { validate } from '../../middleware/validate';
import { asyncHandler } from '../../errors/errorHandler';
import { ErrorCodes, NotFoundError } from '../../errors/ApiError';
import * as walletService from '../../services/wallet';
import { requireAuthenticatedUser } from '../../middleware/auth';

const router = Router();
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parsePositiveSafeInteger(value: number | string): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = BigInt(value);
  if (parsed <= BigInt(0) || parsed > MAX_SAFE_INTEGER_BIGINT) {
    return null;
  }
  return Number(parsed);
}

const positiveSafeIntegerSchema = (field: string) => z.unknown().transform((value, ctx) => {
  const parsed = (typeof value === 'number' || typeof value === 'string')
    ? parsePositiveSafeInteger(value)
    : null;
  if (parsed === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${field} must be a positive safe integer`,
    });
    return z.NEVER;
  }
  return parsed;
});

const WalletSignerSchema = z.object({
  deviceId: z.string().trim().min(1),
  deviceAccountId: z.string().trim().min(1),
  signerIndex: z.number().int().min(0),
}).strict();

const CreateWalletBodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(WALLET_TYPE_VALUES),
  scriptType: z.enum(WALLET_SCRIPT_TYPE_VALUES),
  network: z.enum(BITCOIN_NETWORKS).optional(),
  quorum: positiveSafeIntegerSchema('quorum').optional(),
  totalSigners: positiveSafeIntegerSchema('totalSigners').optional(),
  descriptor: z.string().optional(),
  changeDescriptor: z.string().optional(),
  fingerprint: z.string().optional(),
  groupId: z.string().optional(),
  signers: z.array(WalletSignerSchema).optional(),
}).strict().superRefine((data, ctx) => {
  if (data.type !== WalletType.MULTI_SIG) {
    return;
  }

  if (data.quorum === undefined || data.totalSigners === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quorum and totalSigners required for multi-sig wallets',
      path: ['quorum'],
    });
    return;
  }

  if (data.totalSigners < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'totalSigners must be at least 2 for multi-sig wallets',
      path: ['totalSigners'],
    });
  }

  if (data.quorum > data.totalSigners) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'quorum cannot exceed totalSigners',
      path: ['quorum'],
    });
  }
}).transform(data => (
  data.type === WalletType.MULTI_SIG
    ? data
    : { ...data, quorum: undefined, totalSigners: undefined }
));

// Reject identity-material and unknown mutations instead of silently stripping them.
const UpdateWalletBodySchema = z.object({
  name: z.string().min(1),
}).strict();

const createWalletValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => ['name', 'scriptType'].includes(issue.path))) {
    return 'name, type, and scriptType are required';
  }
  /* v8 ignore next -- route schema tests cover type-specific validation messages */
  if (issues.some(issue => issue.path === 'type')) {
    return 'type must be single_sig or multi_sig';
  }
  if (issues.some(issue => ['quorum', 'totalSigners'].includes(issue.path))) {
    return issues.find(issue => ['quorum', 'totalSigners'].includes(issue.path))!.message;
  }
  /* v8 ignore next -- ZodError from safeParse has at least one issue */
  return 'Invalid wallet request';
};

/**
 * GET /api/v1/wallets
 * Get all wallets for authenticated user
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const wallets = await walletService.getUserWallets(userId);

  res.json(wallets);
}));

/**
 * POST /api/v1/wallets
 * Create a new wallet
 */
router.post('/', validate(
  { body: CreateWalletBodySchema },
  { message: createWalletValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const {
    name,
    type,
    scriptType,
    network,
    quorum,
    totalSigners,
    descriptor,
    changeDescriptor,
    fingerprint,
    groupId,
    signers,
  } = req.body;

  const wallet = await walletService.createWallet(userId, {
    name,
    type,
    scriptType,
    network,
    quorum,
    totalSigners,
    descriptor,
    changeDescriptor,
    fingerprint,
    groupId,
    signers,
  });

  res.status(201).json(wallet);
}));

/**
 * GET /api/v1/wallets/:id
 * Get a specific wallet by ID
 */
router.get('/:id', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const walletId = req.walletId!;

  const wallet = await walletService.getWalletById(walletId, userId);

  if (!wallet) {
    throw new NotFoundError('Wallet not found');
  }

  res.json(wallet);
}));

/**
 * PATCH /api/v1/wallets/:id
 * Update a wallet (owner only)
 */
router.patch('/:id', requireWalletAccess('owner'), validate({ body: UpdateWalletBodySchema }), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const walletId = req.walletId!;
  const { name } = req.body;

  const wallet = await walletService.updateWallet(walletId, userId, {
    name,
  });

  res.json(wallet);
}));

/**
 * DELETE /api/v1/wallets/:id
 * Delete a wallet (owner only)
 */
router.delete('/:id', requireWalletAccess('owner'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const walletId = req.walletId!;

  await walletService.deleteWallet(walletId, userId);

  res.status(204).send();
}));

export default router;
