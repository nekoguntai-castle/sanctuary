/**
 * Draft Transaction API Routes
 *
 * API endpoints for managing draft transactions (saved, unsigned/partially signed PSBTs)
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, approver, signer, viewer)
 * - WRITE (POST, PATCH, DELETE): Only owner or signer roles
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { requireWalletAccess } from '../middleware/walletAccess';
import { validate } from '../middleware/validate';
import { ACTIONABLE_DRAFT_STATUSES } from '../repositories/draftRepository';
import { draftService } from '../services/draftService';
import { serializeDraftTransaction, serializeDraftTransactions } from '../utils/serialization';
import { asyncHandler } from '../errors/errorHandler';

const router = Router();

const DraftIntegerValueSchema = z.custom<number | string>(
  (value) => (
    (typeof value === 'number' && Number.isInteger(value) && value >= 0) ||
    (typeof value === 'string' && /^\d+$/.test(value))
  ),
  { message: 'Expected a non-negative integer value' }
);
const DraftFeeRateSchema = z.custom<number | string>(
  (value) => (
    (typeof value === 'number' && Number.isFinite(value) && value > 0) ||
    (typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) && Number(value) > 0)
  ),
  { message: 'Expected a positive fee rate' }
);
const OptionalDraftTextSchema = z.union([z.string(), z.null()]);
const DraftOutputSchema = z.object({
  address: z.string().min(1),
  amount: DraftIntegerValueSchema,
  sendMax: z.boolean().optional(),
}).strict();
const DraftInputSchema = z.object({
  txid: z.string().regex(/^[a-fA-F0-9]{64}$/),
  vout: z.number().int().nonnegative(),
  address: z.string(),
  amount: DraftIntegerValueSchema,
}).strict();
const DraftDecoyOutputSchema = z.object({
  address: z.string().min(1),
  amount: DraftIntegerValueSchema,
}).strict();

const CreateDraftBodySchema = z.object({
  recipient: z.string().min(1),
  amount: DraftIntegerValueSchema,
  feeRate: DraftFeeRateSchema,
  selectedUtxoIds: z.array(z.string()).optional(),
  enableRBF: z.boolean().optional(),
  subtractFees: z.boolean().optional(),
  sendMax: z.boolean().optional(),
  outputs: z.array(DraftOutputSchema).optional(),
  inputs: z.array(DraftInputSchema).optional(),
  decoyOutputs: z.array(DraftDecoyOutputSchema).optional(),
  payjoinUrl: z.string().optional(),
  isRBF: z.boolean().optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
  psbtBase64: z.string().min(1),
  fee: DraftIntegerValueSchema.optional(),
  totalInput: DraftIntegerValueSchema.optional(),
  totalOutput: DraftIntegerValueSchema.optional(),
  changeAmount: DraftIntegerValueSchema.optional(),
  changeAddress: z.string().optional(),
  effectiveAmount: DraftIntegerValueSchema.optional(),
  inputPaths: z.array(z.string().min(1)).optional(),
  signedPsbtBase64: z.string().min(1).optional(),
  signedDeviceId: z.string().min(1).optional(),
}).strict();

const UpdateDraftBodySchema = z.object({
  signedPsbtBase64: z.string().min(1).optional(),
  signedDeviceId: z.string().min(1).optional(),
  status: z.enum(ACTIONABLE_DRAFT_STATUSES).optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
}).strict();

// All routes require authentication
router.use(authenticate);

/**
 * GET /api/v1/wallets/:walletId/drafts
 * Get all draft transactions for a wallet
 */
router.get('/wallets/:walletId/drafts', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { walletId } = req.params;

  const drafts = await draftService.getDraftsForWallet(walletId);
  res.json(serializeDraftTransactions(drafts));
}));

/**
 * GET /api/v1/wallets/:walletId/drafts/:draftId
 * Get a specific draft transaction
 */
router.get('/wallets/:walletId/drafts/:draftId', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { walletId, draftId } = req.params;

  const draft = await draftService.getDraft(walletId, draftId);
  res.json(serializeDraftTransaction(draft));
}));

/**
 * POST /api/v1/wallets/:walletId/drafts
 * Create a new draft transaction
 */
router.post('/wallets/:walletId/drafts', requireWalletAccess('edit'), validate(
  { body: CreateDraftBodySchema }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId } = req.params;
  const {
    recipient,
    amount,
    feeRate,
    selectedUtxoIds,
    enableRBF,
    subtractFees,
    sendMax,
    outputs,
    inputs,
    decoyOutputs,
    payjoinUrl,
    isRBF,
    label,
    memo,
    psbtBase64,
    fee,
    totalInput,
    totalOutput,
    changeAmount,
    changeAddress,
    effectiveAmount,
    inputPaths,
    signedPsbtBase64,
    signedDeviceId,
  } = req.body;

  const draft = await draftService.createDraft(walletId, userId, {
    recipient,
    amount,
    feeRate,
    selectedUtxoIds,
    enableRBF,
    subtractFees,
    sendMax,
    outputs,
    inputs,
    decoyOutputs,
    payjoinUrl,
    isRBF,
    label,
    memo,
    psbtBase64,
    fee,
    totalInput,
    totalOutput,
    changeAmount,
    changeAddress,
    effectiveAmount,
    inputPaths,
    signedPsbtBase64,
    signedDeviceId,
  });

  res.status(201).json(serializeDraftTransaction(draft));
}));

/**
 * PATCH /api/v1/wallets/:walletId/drafts/:draftId
 * Update a draft transaction (e.g., add signature)
 */
router.patch('/wallets/:walletId/drafts/:draftId', requireWalletAccess('edit'), validate(
  { body: UpdateDraftBodySchema }
), asyncHandler(async (req, res) => {
  const { walletId, draftId } = req.params;
  const { signedPsbtBase64, signedDeviceId, status, label, memo } = req.body;

  const draft = await draftService.updateDraft(walletId, draftId, {
    signedPsbtBase64,
    signedDeviceId,
    status,
    label,
    memo,
  });

  res.json(serializeDraftTransaction(draft));
}));

/**
 * DELETE /api/v1/wallets/:walletId/drafts/:draftId
 * Delete a draft transaction (creator or wallet owner only)
 */
router.delete('/wallets/:walletId/drafts/:draftId', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { walletId, draftId } = req.params;

  await draftService.deleteDraft(walletId, draftId, userId, req.walletRole);
  res.status(204).send();
}));

export default router;
