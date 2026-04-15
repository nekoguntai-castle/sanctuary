/**
 * Draft Transaction API Routes
 *
 * API endpoints for managing draft transactions (saved, unsigned/partially signed PSBTs)
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, signer, viewer)
 * - WRITE (POST, PATCH, DELETE): Only owner or signer roles
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { requireWalletAccess } from '../middleware/walletAccess';
import { validate } from '../middleware/validate';
import { draftService } from '../services/draftService';
import { serializeDraftTransaction, serializeDraftTransactions } from '../utils/serialization';
import { asyncHandler } from '../errors/errorHandler';

const router = Router();

const DraftNumericValueSchema = z.union([z.number(), z.string()]);
const OptionalDraftTextSchema = z.union([z.string(), z.null()]);

const CreateDraftBodySchema = z.object({
  recipient: z.string().optional(),
  amount: DraftNumericValueSchema.optional(),
  feeRate: DraftNumericValueSchema.optional(),
  selectedUtxoIds: z.array(z.string()).optional(),
  enableRBF: z.boolean().optional(),
  subtractFees: z.boolean().optional(),
  sendMax: z.boolean().optional(),
  outputs: z.unknown().optional(),
  inputs: z.unknown().optional(),
  decoyOutputs: z.unknown().optional(),
  payjoinUrl: z.string().optional(),
  isRBF: z.boolean().optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
  psbtBase64: z.string().optional(),
  fee: DraftNumericValueSchema.optional(),
  totalInput: DraftNumericValueSchema.optional(),
  totalOutput: DraftNumericValueSchema.optional(),
  changeAmount: DraftNumericValueSchema.optional(),
  changeAddress: z.string().optional(),
  effectiveAmount: DraftNumericValueSchema.optional(),
  inputPaths: z.unknown().optional(),
});

const UpdateDraftBodySchema = z.object({
  signedPsbtBase64: z.string().optional(),
  signedDeviceId: z.string().optional(),
  status: z.string().optional(),
  label: OptionalDraftTextSchema.optional(),
  memo: OptionalDraftTextSchema.optional(),
});

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
