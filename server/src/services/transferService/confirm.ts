/**
 * Transfer Confirmation
 *
 * Handles the final step of ownership transfer: owner confirms and executes.
 * Includes the actual wallet/device ownership transfer logic within
 * serializable transactions.
 */

import { db as prisma } from '../../repositories/db';
import type { OwnershipTransfer } from '@prisma/client';
import { createLogger } from '../../utils/logger';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../../errors';
import { isExpired, formatTransfer } from './helpers';
import type { PrismaTx, Transfer } from './types';

const log = createLogger('TRANSFER');

/**
 * Confirm and execute transfer (owner action)
 * This is the final step that actually transfers ownership
 * Uses serializable transaction to prevent race conditions
 */
export async function confirmTransfer(
  ownerId: string,
  transferId: string
): Promise<Transfer> {
  // First check basic validations outside transaction for better error messages
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
  });

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  if (transfer.fromUserId !== ownerId) {
    throw new ForbiddenError('Only the transfer initiator can confirm');
  }

  // Execute everything in a serializable transaction to prevent race conditions
  // This ensures status check and execution are atomic
  await prisma.$transaction(async (tx) => {
    // Re-fetch and validate inside transaction
    const current = await tx.ownershipTransfer.findUnique({
      where: { id: transferId },
    });

    if (!current || current.status !== 'accepted') {
      if (current?.status === 'confirmed') {
        throw new ConflictError('Transfer has already been completed');
      }
      throw new InvalidInputError(`Transfer cannot be confirmed (current status: ${current?.status || 'unknown'})`);
    }

    // Check expiration
    if (isExpired(current.expiresAt)) {
      await tx.ownershipTransfer.update({
        where: { id: transferId },
        data: { status: 'expired' },
      });
      throw new InvalidInputError('Transfer has expired');
    }

    // Execute the ownership transfer based on resource type
    if (current.resourceType === 'wallet') {
      await executeWalletTransferTx(tx, current);
    } else {
      await executeDeviceTransferTx(tx, current);
    }
  }, {
    isolationLevel: 'Serializable',
  });

  // Fetch updated transfer for return
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

  log.info('Transfer confirmed and executed', {
    transferId,
    resourceType: transfer.resourceType,
    resourceId: transfer.resourceId,
    from: transfer.fromUserId,
    to: transfer.toUserId,
  });

  return formatTransfer(updated);
}

/**
 * Execute wallet ownership transfer (uses existing transaction)
 */
async function executeWalletTransferTx(tx: PrismaTx, transfer: OwnershipTransfer): Promise<void> {
  const walletId = transfer.resourceId;

  // 1. Find current owner's WalletUser record
  const currentOwner = await tx.walletUser.findFirst({
    where: { walletId, userId: transfer.fromUserId, role: 'owner' },
  });

  if (!currentOwner) {
    throw new ConflictError('Transfer failed: owner no longer owns this wallet');
  }

  // 2. Check if recipient already has access
  const recipientAccess = await tx.walletUser.findFirst({
    where: { walletId, userId: transfer.toUserId },
  });

  if (recipientAccess) {
    // Upgrade existing access to owner
    await tx.walletUser.update({
      where: { id: recipientAccess.id },
      data: { role: 'owner' },
    });
  } else {
    // Create new owner access
    await tx.walletUser.create({
      data: {
        walletId,
        userId: transfer.toUserId,
        role: 'owner',
      },
    });
  }

  // 3. Handle previous owner based on keepExistingUsers flag
  if (transfer.keepExistingUsers) {
    // Downgrade to viewer
    await tx.walletUser.update({
      where: { id: currentOwner.id },
      data: { role: 'viewer' },
    });
  } else {
    // Remove access entirely
    await tx.walletUser.delete({
      where: { id: currentOwner.id },
    });
  }

  // 4. Update transfer status
  await tx.ownershipTransfer.update({
    where: { id: transfer.id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });
}

/**
 * Execute device ownership transfer (uses existing transaction)
 */
async function executeDeviceTransferTx(tx: PrismaTx, transfer: OwnershipTransfer): Promise<void> {
  const deviceId = transfer.resourceId;

  // 1. Find current owner's DeviceUser record
  const currentOwner = await tx.deviceUser.findFirst({
    where: { deviceId, userId: transfer.fromUserId, role: 'owner' },
  });

  if (!currentOwner) {
    throw new ConflictError('Transfer failed: owner no longer owns this device');
  }

  // 2. Update Device.userId (legacy field for backward compatibility)
  await tx.device.update({
    where: { id: deviceId },
    data: { userId: transfer.toUserId },
  });

  // 3. Handle recipient access
  const recipientAccess = await tx.deviceUser.findFirst({
    where: { deviceId, userId: transfer.toUserId },
  });

  if (recipientAccess) {
    await tx.deviceUser.update({
      where: { id: recipientAccess.id },
      data: { role: 'owner' },
    });
  } else {
    await tx.deviceUser.create({
      data: {
        deviceId,
        userId: transfer.toUserId,
        role: 'owner',
      },
    });
  }

  // 4. Handle previous owner
  if (transfer.keepExistingUsers) {
    await tx.deviceUser.update({
      where: { id: currentOwner.id },
      data: { role: 'viewer' },
    });
  } else {
    await tx.deviceUser.delete({
      where: { id: currentOwner.id },
    });
  }

  // 5. Update transfer status
  await tx.ownershipTransfer.update({
    where: { id: transfer.id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });
}
