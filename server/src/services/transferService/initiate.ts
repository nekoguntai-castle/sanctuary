/**
 * Transfer Initiation
 *
 * Handles the first step of ownership transfer: owner initiates transfer to recipient.
 * Uses serializable transaction isolation to prevent race conditions.
 */

import { userRepository, transferRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { ForbiddenError, InvalidInputError, ConflictError, UserNotFoundError } from '../../errors';
import { calculateExpiryDate, checkResourceOwnership, formatTransfer } from './helpers';
import type { Transfer, InitiateTransferInput } from './types';
import { withSerializableRetry } from './serializableRetry';

const log = createLogger('TRANSFER:SVC');

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
  const targetUser = await userRepository.findByIdWithSelect(toUserId, { id: true, username: true });
  if (!targetUser) {
    throw new UserNotFoundError(toUserId);
  }

  // Use a serializable transaction to ensure atomicity - prevents race condition where
  // two requests both pass the hasActiveTransfer check before either creates a transfer
  const transfer = await withSerializableRetry({
    operation: 'initiation',
    exhaustedMessage: 'Transfer initiation conflicted with another update. Please retry.',
  }, async (tx) => {
    await transferRepository.lockResourceOwnership(resourceType, resourceId, tx);

    // Validation: check ownership
    const isOwner = await transferRepository.isDirectResourceOwner(
      resourceType,
      resourceId,
      ownerId,
      tx,
    );
    if (!isOwner) {
      throw new ForbiddenError(`You are not the owner of this ${resourceType}`);
    }

    // Validation: check no active transfer exists for this resource
    // This check is inside the transaction to prevent TOCTOU race condition
    const hasActive = await transferRepository.hasActiveTransfer(resourceType, resourceId, tx);
    if (hasActive) {
      throw new ConflictError(`This ${resourceType} already has a pending transfer`);
    }

    // Validation: check target user is not already owner
    const targetIsOwner = await checkResourceOwnership(resourceType, resourceId, toUserId, tx);
    if (targetIsOwner) {
      throw new ConflictError('Target user is already an owner of this resource');
    }

    // Create transfer record - within the same transaction
    return transferRepository.create({
      resourceType,
      resourceId,
      fromUserId: ownerId,
      toUserId,
      status: 'pending',
      message: message || null,
      keepExistingUsers,
      expiresAt: calculateExpiryDate(expiresInDays),
    }, tx);
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
