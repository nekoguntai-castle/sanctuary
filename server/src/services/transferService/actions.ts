/**
 * Transfer Actions
 *
 * Handles recipient and owner actions on transfers:
 * accept (recipient), decline (recipient), cancel (owner).
 * All use atomic updates with WHERE clauses to prevent race conditions.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../../errors';
import { isExpired, formatTransfer } from './helpers';
import type { Transfer } from './types';

const log = createLogger('TRANSFER');

/**
 * Accept a pending transfer (recipient action)
 * Uses atomic update with WHERE clause to prevent race conditions
 */
export async function acceptTransfer(
  recipientId: string,
  transferId: string
): Promise<Transfer> {
  // First check if transfer exists and get details for error messages
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only recipient can accept
  if (transfer.toUserId !== recipientId) {
    throw new ForbiddenError('Only the recipient can accept this transfer');
  }

  // Check if already expired
  if (isExpired(transfer.expiresAt)) {
    // Mark as expired atomically
    await prisma.ownershipTransfer.updateMany({
      where: { id: transferId, status: { in: ['pending', 'accepted'] } },
      data: { status: 'expired' },
    });
    throw new InvalidInputError('Transfer has expired');
  }

  // Atomic update: only succeeds if status is still 'pending'
  // This prevents race conditions where two requests both try to accept
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      toUserId: recipientId,  // Ensure recipient check is also atomic
      status: 'pending',      // Only update if still pending
      expiresAt: { gt: new Date() },  // Not expired
    },
    data: {
      status: 'accepted',
      acceptedAt: new Date(),
    },
  });

  if (result.count === 0) {
    // Refresh to get current status for error message
    const current = await prisma.ownershipTransfer.findUnique({
      where: { id: transferId },
    });
    if (current?.status === 'accepted') {
      throw new ConflictError('Transfer has already been accepted');
    }
    throw new InvalidInputError(`Transfer cannot be accepted (current status: ${current?.status || 'unknown'})`);
  }

  // Fetch updated record for return
  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  log.info('Transfer accepted', {
    transferId,
    by: recipientId,
  });

  return formatTransfer(updated);
}

/**
 * Decline a pending transfer (recipient action)
 * Uses atomic update with WHERE clause to prevent race conditions
 */
export async function declineTransfer(
  recipientId: string,
  transferId: string,
  reason?: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only recipient can decline
  if (transfer.toUserId !== recipientId) {
    throw new ForbiddenError('Only the recipient can decline this transfer');
  }

  // Atomic update: only succeeds if status is still 'pending'
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      toUserId: recipientId,
      status: 'pending',
    },
    data: {
      status: 'declined',
      declineReason: reason || null,
      cancelledAt: new Date(),
    },
  });

  if (result.count === 0) {
    const current = await prisma.ownershipTransfer.findUnique({
      where: { id: transferId },
    });
    throw new InvalidInputError(`Transfer cannot be declined (current status: ${current?.status || 'unknown'})`);
  }

  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  log.info('Transfer declined', {
    transferId,
    by: recipientId,
    reason,
  });

  return formatTransfer(updated);
}

/**
 * Cancel a transfer (owner action)
 * Can cancel from pending or accepted state
 * Uses atomic update with WHERE clause to prevent race conditions
 */
export async function cancelTransfer(
  ownerId: string,
  transferId: string
): Promise<Transfer> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only owner can cancel
  if (transfer.fromUserId !== ownerId) {
    throw new ForbiddenError('Only the transfer initiator can cancel');
  }

  // Atomic update: only succeeds if status is still cancellable
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      fromUserId: ownerId,
      status: { in: ['pending', 'accepted'] },
    },
    data: {
      status: 'cancelled',
      cancelledAt: new Date(),
    },
  });

  if (result.count === 0) {
    const current = await prisma.ownershipTransfer.findUnique({
      where: { id: transferId },
    });
    throw new InvalidInputError(`Transfer cannot be cancelled (current status: ${current?.status || 'unknown'})`);
  }

  const updated = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  log.info('Transfer cancelled', {
    transferId,
    by: ownerId,
  });

  return formatTransfer(updated);
}
