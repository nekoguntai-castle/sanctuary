/**
 * Labels API Routes
 *
 * API endpoints for managing labels on transactions and addresses.
 * Labels can be attached to multiple transactions/addresses and vice versa.
 *
 * Permissions:
 * - READ (GET): Any user with wallet access (owner, signer, viewer)
 * - WRITE (POST, PUT, DELETE): Only owner or signer roles
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { requireWalletAccess } from '../middleware/walletAccess';
import { validate } from '../middleware/validate';
import { labelService } from '../services/labelService';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes } from '../errors';
import { serializeForJson } from '../utils/serialization';

const router = Router();

const LabelCreateBodySchema = z.object({
  name: z.string().trim().min(1),
  color: z.string().optional(),
  description: z.string().optional(),
});

const LabelUpdateBodySchema = z.object({
  name: z.string().trim().min(1).optional(),
  color: z.string().optional(),
  description: z.string().optional(),
});

const LabelIdsAddBodySchema = z.object({
  labelIds: z.array(z.string()).min(1),
});

const LabelIdsReplaceBodySchema = z.object({
  labelIds: z.array(z.string()),
});

const labelIdsValidationOptions = {
  message: 'labelIds array is required',
  code: ErrorCodes.INVALID_INPUT,
};

// All routes require authentication
router.use(authenticate);

// ========================================
// LABEL CRUD OPERATIONS
// ========================================

/**
 * GET /api/v1/wallets/:walletId/labels
 * Get all labels for a wallet
 */
router.get('/wallets/:walletId/labels', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { walletId } = req.params;

  const labels = await labelService.getLabelsForWallet(walletId);
  res.json(labels);
}));

/**
 * GET /api/v1/wallets/:walletId/labels/:labelId
 * Get a specific label with all associated transactions and addresses
 */
router.get('/wallets/:walletId/labels/:labelId', requireWalletAccess('view'), asyncHandler(async (req, res) => {
  const { walletId, labelId } = req.params;

  const label = await labelService.getLabel(walletId, labelId);
  res.json(serializeForJson(label));
}));

/**
 * POST /api/v1/wallets/:walletId/labels
 * Create a new label (requires edit access: owner or signer)
 */
router.post('/wallets/:walletId/labels', requireWalletAccess('edit'), validate(
  { body: LabelCreateBodySchema },
  { message: 'Label name is required', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { walletId } = req.params;
  const { name, color, description } = req.body;

  const label = await labelService.createLabel(walletId, {
    name,
    color,
    description,
  });

  res.status(201).json(label);
}));

/**
 * PUT /api/v1/wallets/:walletId/labels/:labelId
 * Update a label (requires edit access: owner or signer)
 */
router.put('/wallets/:walletId/labels/:labelId', requireWalletAccess('edit'), validate(
  { body: LabelUpdateBodySchema },
  { message: 'Label name is required', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const { walletId, labelId } = req.params;
  const { name, color, description } = req.body;

  const label = await labelService.updateLabel(walletId, labelId, {
    name,
    color,
    description,
  });

  res.json(label);
}));

/**
 * DELETE /api/v1/wallets/:walletId/labels/:labelId
 * Delete a label (requires edit access: owner or signer)
 */
router.delete('/wallets/:walletId/labels/:labelId', requireWalletAccess('edit'), asyncHandler(async (req, res) => {
  const { walletId, labelId } = req.params;

  await labelService.deleteLabel(walletId, labelId);
  res.status(204).send();
}));

// ========================================
// TRANSACTION LABEL OPERATIONS
// ========================================

/**
 * GET /api/v1/transactions/:transactionId/labels
 * Get all labels for a transaction
 */
router.get('/transactions/:transactionId/labels', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { transactionId } = req.params;

  const labels = await labelService.getTransactionLabels(transactionId, userId);
  res.json(labels);
}));

/**
 * POST /api/v1/transactions/:transactionId/labels
 * Add labels to a transaction (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.post('/transactions/:transactionId/labels', validate(
  { body: LabelIdsAddBodySchema },
  labelIdsValidationOptions
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { transactionId } = req.params;
  const { labelIds } = req.body;

  const labels = await labelService.addTransactionLabels(transactionId, userId, labelIds);
  res.json(labels);
}));

/**
 * PUT /api/v1/transactions/:transactionId/labels
 * Replace all labels on a transaction (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.put('/transactions/:transactionId/labels', validate(
  { body: LabelIdsReplaceBodySchema },
  labelIdsValidationOptions
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { transactionId } = req.params;
  const { labelIds } = req.body;

  const labels = await labelService.replaceTransactionLabels(transactionId, userId, labelIds);
  res.json(labels);
}));

/**
 * DELETE /api/v1/transactions/:transactionId/labels/:labelId
 * Remove a label from a transaction (requires edit access: owner or signer)
 */
router.delete('/transactions/:transactionId/labels/:labelId', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { transactionId, labelId } = req.params;

  await labelService.removeTransactionLabel(transactionId, labelId, userId);
  res.status(204).send();
}));

// ========================================
// ADDRESS LABEL OPERATIONS
// ========================================

/**
 * GET /api/v1/addresses/:addressId/labels
 * Get all labels for an address
 */
router.get('/addresses/:addressId/labels', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { addressId } = req.params;

  const labels = await labelService.getAddressLabels(addressId, userId);
  res.json(labels);
}));

/**
 * POST /api/v1/addresses/:addressId/labels
 * Add labels to an address (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.post('/addresses/:addressId/labels', validate(
  { body: LabelIdsAddBodySchema },
  labelIdsValidationOptions
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { addressId } = req.params;
  const { labelIds } = req.body;

  const labels = await labelService.addAddressLabels(addressId, userId, labelIds);
  res.json(labels);
}));

/**
 * PUT /api/v1/addresses/:addressId/labels
 * Replace all labels on an address (requires edit access: owner or signer)
 * Body: { labelIds: string[] }
 */
router.put('/addresses/:addressId/labels', validate(
  { body: LabelIdsReplaceBodySchema },
  labelIdsValidationOptions
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { addressId } = req.params;
  const { labelIds } = req.body;

  const labels = await labelService.replaceAddressLabels(addressId, userId, labelIds);
  res.json(labels);
}));

/**
 * DELETE /api/v1/addresses/:addressId/labels/:labelId
 * Remove a label from an address (requires edit access: owner or signer)
 */
router.delete('/addresses/:addressId/labels/:labelId', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { addressId, labelId } = req.params;

  await labelService.removeAddressLabel(addressId, labelId, userId);
  res.status(204).send();
}));

export default router;
