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
import {
  CreateDraftRequestSchema,
  UpdateDraftRequestSchema,
} from '@sanctuary/shared/schemas/draftRequests';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { requireWalletAccess } from '../middleware/walletAccess';
import { validate } from '../middleware/validate';
import { draftService } from '../services/draftService';
import { serializeDraftTransaction, serializeDraftTransactions } from '../utils/serialization';
import { asyncHandler } from '../errors/errorHandler';

const router = Router();

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
  { body: CreateDraftRequestSchema }
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
  { body: UpdateDraftRequestSchema }
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
