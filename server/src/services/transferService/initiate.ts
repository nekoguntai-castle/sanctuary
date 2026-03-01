/**
 * Transfer Initiation
 *
 * Handles the first step of ownership transfer: owner initiates transfer to recipient.
 * Uses serializable transaction isolation to prevent race conditions.
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { ForbiddenError, InvalidInputError, ConflictError, UserNotFoundError } from '../../errors';
import { calculateExpiryDate, checkResourceOwnership, formatTransfer } from './helpers';
import type { Transfer, InitiateTransferInput } from './types';

const log = createLogger('TRANSFER');

/**
 * Initiate an ownership transfer
 * Uses transaction with serializable isolation to prevent race conditions
 */
export async function initiateTransfer(
  ownerId: string,
  input: InitiateTransferInput
): Promise<Transfer> {
  const { resourceType, resourceId, toUserId, message, keepExistingUsers = true, expiresInDays } = input;

  // Validation: can't transfer to yourself
  if (ownerId === toUserId) {
    throw new InvalidInputError('Cannot transfer ownership to yourself');
  }

  // Validation: check target user exists (this can be done outside transaction)
  const targetUser = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, username: true },
  });
  if (!targetUser) {
    throw new UserNotFoundError(toUserId);
  }

  // Use a transaction to ensure atomicity - prevents race condition where
  // two requests both pass the hasActiveTransfer check before either creates a transfer
  const transfer = await prisma.$transaction(async (tx) => {
    // Validation: check ownership
    const isOwner = await checkResourceOwnership(resourceType, resourceId, ownerId);
    if (!isOwner) {
      throw new ForbiddenError(`You are not the owner of this ${resourceType}`);
    }

    // Validation: check no active transfer exists for this resource
    // This check is inside the transaction to prevent TOCTOU race condition
    const activeTransferCount = await tx.ownershipTransfer.count({
      where: {
        resourceType,
        resourceId,
        status: { in: ['pending', 'accepted'] },
      },
    });
    if (activeTransferCount > 0) {
      throw new ConflictError(`This ${resourceType} already has a pending transfer`);
    }

    // Validation: check target user is not already owner
    const targetIsOwner = await checkResourceOwnership(resourceType, resourceId, toUserId);
    if (targetIsOwner) {
      throw new ConflictError('Target user is already an owner of this resource');
    }

    // Create transfer record - within the same transaction
    return tx.ownershipTransfer.create({
      data: {
        resourceType,
        resourceId,
        fromUserId: ownerId,
        toUserId,
        status: 'pending',
        message: message || null,
        keepExistingUsers,
        expiresAt: calculateExpiryDate(expiresInDays),
      },
      include: {
        fromUser: { select: { id: true, username: true } },
        toUser: { select: { id: true, username: true } },
      },
    });
  }, {
    // Use serializable isolation to prevent concurrent transfers
    isolationLevel: 'Serializable',
  });

  log.info('Transfer initiated', {
    transferId: transfer.id,
    resourceType,
    resourceId,
    from: ownerId,
    to: toUserId,
  });

  return formatTransfer(transfer);
}
