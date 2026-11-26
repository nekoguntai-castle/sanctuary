/**
 * Transfer Actions
 *
 * Handles recipient and owner actions on transfers:
 * accept (recipient), decline (recipient), cancel (owner).
 * All use atomic updates with WHERE clauses to prevent race conditions.
 */

import { transferRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../../errors';
import { isExpired, formatTransfer } from './helpers';
import type { Transfer } from './types';

const log = createLogger('TRANSFER:SVC');

const ACTIVE_TRANSFER_STATUSES = ['pending', 'accepted'];

async function expireTransferIfOverdue(transfer: {
  id: string;
  status: string;
  expiresAt: Date;
}): Promise<void> {
  if (ACTIVE_TRANSFER_STATUSES.includes(transfer.status) && isExpired(transfer.expiresAt)) {
    await transferRepository.atomicStatusUpdate(
      transfer.id,
      { status: { in: ACTIVE_TRANSFER_STATUSES } },
      { status: 'expired' }
    );
    throw new InvalidInputError('Transfer has expired');
  }
}

/**
 * Accept a pending transfer (recipient action)
 * Uses atomic update with WHERE clause to prevent race conditions
 */
export async function acceptTransfer(
  recipientId: string,
  transferId: string
): Promise<Transfer> {
  // First check if transfer exists and get details for error messages
  const transfer = await transferRepository.findById(transferId);

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only recipient can accept
  if (transfer.toUserId !== recipientId) {
    throw new ForbiddenError('Only the recipient can accept this transfer');
  }

  // Check if already expired
  await expireTransferIfOverdue(transfer);

  // Atomic update: only succeeds if status is still 'pending'
  // This prevents race conditions where two requests both try to accept
  const result = await transferRepository.atomicStatusUpdate(
    transferId,
    {
      toUserId: recipientId,
      status: 'pending',
      expiresAt: { gt: new Date() },
    },
    {
      status: 'accepted',
      acceptedAt: new Date(),
    }
  );

  if (result === 0) {
    // Refresh to get current status for error message
    const current = await transferRepository.findById(transferId);
    if (current) {
      await expireTransferIfOverdue(current);
    }
    if (current?.status === 'accepted') {
      throw new ConflictError('Transfer has already been accepted');
    }
    throw new InvalidInputError(`Transfer cannot be accepted (current status: ${current?.status || 'unknown'})`);
  }

  // Fetch updated record for return
  const updated = await transferRepository.findByIdWithUsers(transferId);

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
  const transfer = await transferRepository.findById(transferId);

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only recipient can decline
  if (transfer.toUserId !== recipientId) {
    throw new ForbiddenError('Only the recipient can decline this transfer');
  }

  // Lazily expire overdue transfers instead of transitioning them to declined
  await expireTransferIfOverdue(transfer);

  // Atomic update: only succeeds if status is still 'pending' and unexpired
  const result = await transferRepository.atomicStatusUpdate(
    transferId,
    { toUserId: recipientId, status: 'pending', expiresAt: { gt: new Date() } },
    { status: 'declined', declineReason: reason || null, cancelledAt: new Date() }
  );

  if (result === 0) {
    const current = await transferRepository.findById(transferId);
    if (current) {
      await expireTransferIfOverdue(current);
    }
    throw new InvalidInputError(`Transfer cannot be declined (current status: ${current?.status || 'unknown'})`);
  }

  const updated = await transferRepository.findByIdWithUsers(transferId);

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
  const transfer = await transferRepository.findById(transferId);

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  // Validation: only owner can cancel
  if (transfer.fromUserId !== ownerId) {
    throw new ForbiddenError('Only the transfer initiator can cancel');
  }

  // Lazily expire overdue transfers instead of transitioning them to cancelled
  await expireTransferIfOverdue(transfer);

  // Atomic update: only succeeds if status is still cancellable and unexpired
  const result = await transferRepository.atomicStatusUpdate(
    transferId,
    { fromUserId: ownerId, status: { in: ['pending', 'accepted'] }, expiresAt: { gt: new Date() } },
    { status: 'cancelled', cancelledAt: new Date() }
  );

  if (result === 0) {
    const current = await transferRepository.findById(transferId);
    if (current) {
      await expireTransferIfOverdue(current);
    }
    throw new InvalidInputError(`Transfer cannot be cancelled (current status: ${current?.status || 'unknown'})`);
  }

  const updated = await transferRepository.findByIdWithUsers(transferId);

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  log.info('Transfer cancelled', {
    transferId,
    by: ownerId,
  });

  return formatTransfer(updated);
}
