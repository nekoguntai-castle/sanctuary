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
  TRANSFER_RESOURCE_TYPES,
  TRANSFER_ROLE_FILTER_VALUES,
  TRANSFER_STATUS_FILTER_VALUES,
  type InitiateTransferInput,
  type TransferFilters,
} from '../services/transferService';

const log = createLogger('TRANSFER:ROUTE');

const router = Router();

const TransferResourceTypeSchema = z.enum(TRANSFER_RESOURCE_TYPES);
const TransferRoleFilterSchema = z.enum(TRANSFER_ROLE_FILTER_VALUES);
const TransferStatusFilterSchema = z.enum(TRANSFER_STATUS_FILTER_VALUES);

const InitiateTransferBodySchema = z.object({
  resourceType: TransferResourceTypeSchema,
  resourceId: z.string().min(1),
  toUserId: z.string().min(1),
  message: z.string().optional(),
  keepExistingUsers: z.boolean().optional(),
  expiresInDays: z.number().int().positive().optional(),
}).strict();

type InitiateTransferBody = z.infer<typeof InitiateTransferBodySchema>;

const DeclineTransferBodySchema = z.object({
  reason: z.string().optional(),
}).strict().default({});

type DeclineTransferBody = z.infer<typeof DeclineTransferBodySchema>;

const TransferListQuerySchema = z.object({
  role: TransferRoleFilterSchema.optional(),
  status: TransferStatusFilterSchema.optional(),
  resourceType: TransferResourceTypeSchema.optional(),
});

type TransferListQuery = z.infer<typeof TransferListQuerySchema>;

const initiateTransferValidationMessage = (issues: Array<{ path: string; message: string }>) => {
  if (issues.some(issue => issue.path === 'resourceType')) {
    return 'resourceType must be "wallet" or "device"';
  }

  if (issues.some(issue => ['resourceId', 'toUserId'].includes(issue.path))) {
    return 'resourceType, resourceId, and toUserId are required';
  }

  return 'Invalid transfer request';
};

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
  const {
    resourceType,
    resourceId,
    toUserId,
    message,
    keepExistingUsers,
    expiresInDays,
  } = req.body as InitiateTransferBody;

  const input: InitiateTransferInput = {
    resourceType,
    resourceId,
    toUserId,
  };
  if (message !== undefined) {
    input.message = message;
  }
  if (keepExistingUsers !== undefined) {
    input.keepExistingUsers = keepExistingUsers;
  }
  if (expiresInDays !== undefined) {
    input.expiresInDays = expiresInDays;
  }

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
router.get('/', validate(
  { query: TransferListQuerySchema },
  { message: 'Invalid transfer filter', code: ErrorCodes.INVALID_INPUT }
), asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;
  const { role, status, resourceType } = req.query as unknown as TransferListQuery;

  const filters: TransferFilters = {};

  if (role) {
    filters.role = role;
  }

  if (status) {
    filters.status = status;
  }

  if (resourceType) {
    filters.resourceType = resourceType;
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
  const { reason } = req.body as DeclineTransferBody;

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
