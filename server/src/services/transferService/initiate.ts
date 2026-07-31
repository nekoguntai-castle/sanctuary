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
import type { PrismaTx } from './types';
import { isPrismaError } from '../../utils/errors';

const log = createLogger('TRANSFER:SVC');
const MAX_SERIALIZABLE_ATTEMPTS = 3;

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
  const transfer = await initiateWithSerializableRetry(async (tx) => {
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

async function initiateWithSerializableRetry<T>(
  attemptTransaction: (tx: PrismaTx) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_SERIALIZABLE_ATTEMPTS; attempt += 1) {
    try {
      return await transferRepository.withSerializableTransaction(attemptTransaction);
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt === MAX_SERIALIZABLE_ATTEMPTS) {
        throw new ConflictError(
          'Transfer initiation conflicted with another update. Please retry.',
        );
      }
      log.debug('Retrying transfer initiation after serialization conflict', { attempt });
    }
  }

  /* v8 ignore next -- every loop path returns or throws */
  throw new ConflictError('Transfer initiation failed after retry attempts');
}

function isSerializableTransactionConflict(error: unknown): boolean {
  if (!isPrismaError(error)) return false;
  if (error.code === 'P2034') return true;
  // The driver adapter currently wraps PostgreSQL serialization failures in
  // Prisma's generic raw-query error while preserving the conflict kind.
  const driverAdapterError = error.meta?.driverAdapterError as
    | { cause?: { kind?: unknown } }
    | undefined;
  return error.code === 'P2010'
    && driverAdapterError?.cause?.kind === 'TransactionWriteConflict';
}
