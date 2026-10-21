/**
 * Transfer Confirmation
 *
 * Handles the final step of ownership transfer: owner confirms and executes.
 * Includes the actual wallet/device ownership transfer logic within
 * serializable transactions.
 */

import { transferRepository } from '../../repositories';
import type { OwnershipTransfer } from '../../generated/prisma/client';
import { createLogger } from '../../utils/logger';
import { NotFoundError, ForbiddenError, InvalidInputError, ConflictError } from '../../errors';
import { isExpired, formatTransfer } from './helpers';
import { withSerializableRetry } from './serializableRetry';
import type { PrismaTx, Transfer, TransferWithUsers } from './types';
import { invalidateWebSocketWalletAccess } from '../websocketAuthorizationInvalidation';
import { auditService, AuditAction, AuditCategory } from '../auditService';

const log = createLogger('TRANSFER:SVC');

/** Access removed by a keepExistingUsers=false transfer, for the audit entry. */
interface AccessRemoval {
  removedUserIds: string[];
  removedGroupId: string | null;
}

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
  const transfer = await transferRepository.findById(transferId);

  if (!transfer) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  if (transfer.fromUserId !== ownerId) {
    throw new ForbiddenError('Only the transfer initiator can confirm');
  }

  // Execute everything in a serializable transaction to prevent race conditions
  // This ensures status check and execution are atomic
  const result = await withSerializableRetry({
    operation: 'confirmation',
    exhaustedMessage: 'Transfer confirmation conflicted with another update. Please retry.',
  }, async (tx) => {
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
      // Return instead of throwing so the expired transition commits first.
      return { expired: true, walletId: null, removal: null };
    }

    await transferRepository.lockResourceOwnership(
      current.resourceType === 'wallet' ? 'wallet' : 'device',
      current.resourceId,
      tx,
    );

    // Execute the ownership transfer based on resource type
    const isWallet = current.resourceType === 'wallet';
    const removal = isWallet
      ? await executeWalletTransferTx(tx, current)
      : await executeDeviceTransferTx(tx, current);
    return {
      expired: false,
      walletId: isWallet ? current.resourceId : null,
      removal,
    };
  });

  if (result.expired) {
    throw new InvalidInputError('Transfer has expired');
  }

  if (result.walletId) {
    // Transfer changes walletUser on its transaction client, bypassing the sharing
    // repository. Refresh socket grants here after the commit.
    await invalidateWebSocketWalletAccess(result.walletId);
  }

  // Fetch updated transfer for return
  const updated = await transferRepository.findByIdWithUsers(transferId);

  if (!updated) {
    throw new NotFoundError(`Transfer '${transferId}' not found`);
  }

  if (result.removal) {
    await auditAccessRemoval(updated, result.removal);
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
 * Record the access a keepExistingUsers=false transfer removed. Written after
 * commit; auditService.log swallows its own failures.
 */
async function auditAccessRemoval(transfer: TransferWithUsers, removal: AccessRemoval): Promise<void> {
  const isWallet = transfer.resourceType === 'wallet';
  await auditService.log({
    userId: transfer.fromUserId,
    username: transfer.fromUser?.username ?? 'unknown',
    action: isWallet ? AuditAction.WALLET_UNSHARE : AuditAction.DEVICE_UNSHARE,
    category: isWallet ? AuditCategory.WALLET : AuditCategory.DEVICE,
    details: {
      reason: 'ownership_transfer',
      transferId: transfer.id,
      removedUserIds: removal.removedUserIds,
      removedGroupId: removal.removedGroupId,
    },
  });
}

/**
 * The membership and group-grant operations for one shared resource, bound to
 * the transfer's tx client so revocation stays inside the serializable tx.
 */
interface ResourceAccessOps {
  findOtherMembers(): Promise<Array<{ id: string; userId: string }>>;
  deleteMembers(ids: string[]): Promise<unknown>;
  readGroupId(): Promise<string | null>;
  clearGroup(): Promise<unknown>;
}

function walletAccessOps(tx: PrismaTx, walletId: string, newOwnerId: string): ResourceAccessOps {
  return {
    findOtherMembers: () => tx.walletUser.findMany({
      where: { walletId, userId: { not: newOwnerId } },
      select: { id: true, userId: true },
    }),
    deleteMembers: ids => tx.walletUser.deleteMany({ where: { id: { in: ids } } }),
    readGroupId: async () =>
      (await tx.wallet.findUniqueOrThrow({ where: { id: walletId }, select: { groupId: true } })).groupId,
    clearGroup: () => tx.wallet.update({ where: { id: walletId }, data: { groupId: null, groupRole: 'viewer' } }),
  };
}

function deviceAccessOps(tx: PrismaTx, deviceId: string, newOwnerId: string): ResourceAccessOps {
  return {
    findOtherMembers: () => tx.deviceUser.findMany({
      where: { deviceId, userId: { not: newOwnerId } },
      select: { id: true, userId: true },
    }),
    deleteMembers: ids => tx.deviceUser.deleteMany({ where: { id: { in: ids } } }),
    readGroupId: async () =>
      (await tx.device.findUniqueOrThrow({ where: { id: deviceId }, select: { groupId: true } })).groupId,
    clearGroup: () => tx.device.update({ where: { id: deviceId }, data: { groupId: null, groupRole: 'viewer' } }),
  };
}

/**
 * Remove every member except the new owner and clear the group grant.
 */
async function revokeOtherAccess(ops: ResourceAccessOps): Promise<AccessRemoval> {
  const members = await ops.findOtherMembers();
  if (members.length > 0) {
    await ops.deleteMembers(members.map(member => member.id));
  }
  const groupId = await ops.readGroupId();
  if (groupId) {
    await ops.clearGroup();
  }
  return { removedUserIds: members.map(member => member.userId), removedGroupId: groupId };
}

/**
 * Execute wallet ownership transfer (uses existing transaction)
 */
async function executeWalletTransferTx(
  tx: PrismaTx,
  transfer: OwnershipTransfer,
): Promise<AccessRemoval | null> {
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

  // 3. Handle previous owner and other members based on keepExistingUsers flag
  let removal: AccessRemoval | null = null;
  if (transfer.keepExistingUsers) {
    // Downgrade to viewer
    await tx.walletUser.update({
      where: { id: currentOwner.id },
      data: { role: 'viewer' },
    });
  } else {
    // Remove all existing access, including the previous owner's
    removal = await revokeOtherAccess(walletAccessOps(tx, walletId, transfer.toUserId));
  }

  // 4. Update transfer status
  await tx.ownershipTransfer.update({
    where: { id: transfer.id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });
  return removal;
}

/**
 * Execute device ownership transfer (uses existing transaction)
 */
async function executeDeviceTransferTx(
  tx: PrismaTx,
  transfer: OwnershipTransfer,
): Promise<AccessRemoval | null> {
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

  // 4. Handle previous owner and other members
  let removal: AccessRemoval | null = null;
  if (transfer.keepExistingUsers) {
    await tx.deviceUser.update({
      where: { id: currentOwner.id },
      data: { role: 'viewer' },
    });
  } else {
    removal = await revokeOtherAccess(deviceAccessOps(tx, deviceId, transfer.toUserId));
  }

  // 5. Update transfer status
  await tx.ownershipTransfer.update({
    where: { id: transfer.id },
    data: {
      status: 'confirmed',
      confirmedAt: new Date(),
    },
  });
  return removal;
}
