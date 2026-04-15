/**
 * Ownership Transfer API Routes
 *
 * API endpoints for secure 3-step ownership transfers:
 * 1. Owner initiates transfer
 * 2. Recipient accepts (or declines)
 * 3. Owner confirms to complete
 *
 * Owner can cancel at any point before final confirmation.
 */

import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireAuthenticatedUser } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { createLogger } from '../utils/logger';
import { asyncHandler } from '../errors/errorHandler';
import { ErrorCodes, NotFoundError, ForbiddenError } from '../errors/ApiError';
import {
  initiateTransfer,
  acceptTransfer,
  declineTransfer,
  cancelTransfer,
  confirmTransfer,
  getUserTransfers,
  getTransfer,
  getPendingIncomingCount,
  getAwaitingConfirmationCount,
  type InitiateTransferInput,
  type TransferFilters,
  type ResourceType,
  type TransferStatus,
} from '../services/transferService';

const log = createLogger('TRANSFER:ROUTE');

const router = Router();

const InitiateTransferBodySchema = z.object({
  resourceType: z.unknown(),
  resourceId: z.unknown(),
  toUserId: z.unknown(),
  message: z.unknown().optional(),
  keepExistingUsers: z.unknown().optional(),
  expiresInDays: z.unknown().optional(),
}).superRefine((data, ctx) => {
  if (!data.resourceType || !data.resourceId || !data.toUserId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceType, resourceId, and toUserId are required',
      path: ['resourceType'],
    });
    return;
  }

  if (data.resourceType !== 'wallet' && data.resourceType !== 'device') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'resourceType must be "wallet" or "device"',
      path: ['resourceType'],
    });
  }
});

const DeclineTransferBodySchema = z.object({
  reason: z.unknown().optional(),
}).passthrough();

const initiateTransferValidationMessage = (issues: Array<{ message: string }>) => (
  issues.some(issue => issue.message === 'resourceType must be "wallet" or "device"')
    ? 'resourceType must be "wallet" or "device"'
    : 'resourceType, resourceId, and toUserId are required'
);

// All routes require authentication
router.use(authenticate);

// ========================================
// TRANSFER ENDPOINTS
// ========================================

/**
 * POST /api/v1/transfers
 * Initiate an ownership transfer
 */
router.post('/', validate(
  { body: InitiateTransferBodySchema },
  { message: initiateTransferValidationMessage, code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { resourceType, resourceId, toUserId, message, keepExistingUsers, expiresInDays } = req.body;

  const input: InitiateTransferInput = {
    resourceType: resourceType as ResourceType,
    resourceId,
    toUserId,
    message,
    keepExistingUsers,
    expiresInDays,
  };

  const transfer = await initiateTransfer(userId, input);

  log.info('Transfer initiated via API', {
    transferId: transfer.id,
    resourceType,
    resourceId,
    from: userId,
    to: toUserId,
  });

  res.status(201).json(transfer);
}));

/**
 * GET /api/v1/transfers
 * Get transfers for the authenticated user
 *
 * Query params:
 * - role: 'initiator' | 'recipient' | 'all' (default: 'all')
 * - status: TransferStatus | 'active' | 'all' (default: 'all')
 * - resourceType: 'wallet' | 'device' (optional)
 */
router.get('/', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { role, status, resourceType } = req.query;

  const filters: TransferFilters = {};

  if (role && ['initiator', 'recipient', 'all'].includes(role as string)) {
    filters.role = role as 'initiator' | 'recipient' | 'all';
  }

  if (status) {
    filters.status = status as TransferStatus | 'active' | 'all';
  }

  if (resourceType && ['wallet', 'device'].includes(resourceType as string)) {
    filters.resourceType = resourceType as ResourceType;
  }

  const result = await getUserTransfers(userId, filters);

  res.json(result);
}));

/**
 * GET /api/v1/transfers/counts
 * Get counts for pending transfers
 */
router.get('/counts', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  const [pendingIncoming, awaitingConfirmation] = await Promise.all([
    getPendingIncomingCount(userId),
    getAwaitingConfirmationCount(userId),
  ]);

  res.json({
    pendingIncoming,
    awaitingConfirmation,
    total: pendingIncoming + awaitingConfirmation,
  });
}));

/**
 * GET /api/v1/transfers/:id
 * Get a specific transfer by ID
 */
router.get('/:id', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { id } = req.params;

  const transfer = await getTransfer(id);

  if (!transfer) {
    throw new NotFoundError('Transfer not found');
  }

  // Only involved parties can view transfer details
  if (transfer.fromUserId !== userId && transfer.toUserId !== userId) {
    throw new ForbiddenError('You do not have access to this transfer');
  }

  res.json(transfer);
}));

/**
 * POST /api/v1/transfers/:id/accept
 * Accept a pending transfer (recipient action)
 */
router.post('/:id/accept', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { id } = req.params;

  const transfer = await acceptTransfer(userId, id);

  log.info('Transfer accepted via API', { transferId: id, by: userId });

  res.json(transfer);
}));

/**
 * POST /api/v1/transfers/:id/decline
 * Decline a pending transfer (recipient action)
 */
router.post('/:id/decline', validate({ body: DeclineTransferBodySchema }), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { id } = req.params;
  const { reason } = req.body;

  const transfer = await declineTransfer(userId, id, reason);

  log.info('Transfer declined via API', { transferId: id, by: userId });

  res.json(transfer);
}));

/**
 * POST /api/v1/transfers/:id/cancel
 * Cancel a transfer (owner action)
 * Can cancel from pending or accepted state
 */
router.post('/:id/cancel', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { id } = req.params;

  const transfer = await cancelTransfer(userId, id);

  log.info('Transfer cancelled via API', { transferId: id, by: userId });

  res.json(transfer);
}));

/**
 * POST /api/v1/transfers/:id/confirm
 * Confirm and execute a transfer (owner action)
 * This is the final step that actually transfers ownership
 */
router.post('/:id/confirm', asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { id } = req.params;

  const transfer = await confirmTransfer(userId, id);

  log.info('Transfer confirmed via API', {
    transferId: id,
    by: userId,
    resourceType: transfer.resourceType,
    resourceId: transfer.resourceId,
  });

  res.json(transfer);
}));

export default router;
