/**
 * Transfer Queries
 *
 * Read-only query functions for retrieving transfer data.
 */

import { db as prisma } from '../../repositories/db';
import type { Prisma } from '@prisma/client';
import { formatTransfer } from './helpers';
import type { Transfer, TransferFilters, ResourceType } from './types';

/**
 * Get transfers for a user
 */
export async function getUserTransfers(
  userId: string,
  filters: TransferFilters = {}
): Promise<{ transfers: Transfer[]; total: number }> {
  const { role = 'all', status = 'all', resourceType } = filters;

  // Build where clause
  const where: Prisma.OwnershipTransferWhereInput = {};

  // Role filter
  if (role === 'initiator') {
    where.fromUserId = userId;
  } else if (role === 'recipient') {
    where.toUserId = userId;
  } else {
    where.OR = [{ fromUserId: userId }, { toUserId: userId }];
  }

  // Status filter
  if (status === 'active') {
    where.status = { in: ['pending', 'accepted'] };
  } else if (status !== 'all') {
    where.status = status;
  }

  // Resource type filter
  if (resourceType) {
    where.resourceType = resourceType;
  }

  const [transfers, total] = await Promise.all([
    prisma.ownershipTransfer.findMany({
      where,
      include: {
        fromUser: { select: { id: true, username: true } },
        toUser: { select: { id: true, username: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.ownershipTransfer.count({ where }),
  ]);

  // Format all transfers
  const formatted = await Promise.all(transfers.map(formatTransfer));

  return { transfers: formatted, total };
}

/**
 * Get a single transfer by ID
 */
export async function getTransfer(transferId: string): Promise<Transfer | null> {
  const transfer = await prisma.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromUser: { select: { id: true, username: true } },
      toUser: { select: { id: true, username: true } },
    },
  });

  if (!transfer) {
    return null;
  }

  return formatTransfer(transfer);
}

/**
 * Check if resource has an active transfer
 */
export async function hasActiveTransfer(
  resourceType: ResourceType,
  resourceId: string
): Promise<boolean> {
  const count = await prisma.ownershipTransfer.count({
    where: {
      resourceType,
      resourceId,
      status: { in: ['pending', 'accepted'] },
    },
  });
  return count > 0;
}

/**
 * Get pending incoming transfers count for a user
 */
export async function getPendingIncomingCount(userId: string): Promise<number> {
  return prisma.ownershipTransfer.count({
    where: {
      toUserId: userId,
      status: 'pending',
    },
  });
}

/**
 * Get transfers requiring owner confirmation
 */
export async function getAwaitingConfirmationCount(userId: string): Promise<number> {
  return prisma.ownershipTransfer.count({
    where: {
      fromUserId: userId,
      status: 'accepted',
    },
  });
}
