/**
 * Transfer Repository
 *
 * Abstracts database operations for ownership transfers.
 * Provides centralized access patterns for transfer queries and mutations.
 */

import prisma from '../models/prisma';
import type { OwnershipTransfer, Prisma } from '../generated/prisma/client';
import { createLogger } from '../utils/logger';

import type { PrismaTxClient } from '../models/prisma';
const log = createLogger('TRANSFER:REPO');

type PrismaTx = PrismaTxClient;

const userSelect = { id: true, username: true } as const;

const withUsers = {
  fromUser: { select: userSelect },
  toUser: { select: userSelect },
} as const;

/** Transfer with user relations */
export type TransferWithUsers = OwnershipTransfer & {
  fromUser?: { id: string; username: string } | null;
  toUser?: { id: string; username: string } | null;
};

/** Filter options for user transfer queries */
export interface TransferQueryFilters {
  role?: 'initiator' | 'recipient' | 'all';
  status?: string;
  resourceType?: string;
}

/** Conditions for atomic status updates */
export interface AtomicUpdateConditions {
  status?: string | { in: string[] };
  fromUserId?: string;
  toUserId?: string;
  expiresAt?: { gt: Date };
}

/**
 * Find a transfer by ID
 */
export async function findById(
  transferId: string,
  tx?: PrismaTx
): Promise<OwnershipTransfer | null> {
  const client = tx ?? prisma;
  return client.ownershipTransfer.findUnique({
    where: { id: transferId },
  });
}

/**
 * Find a transfer by ID with user relations
 */
export async function findByIdWithUsers(
  transferId: string,
  tx?: PrismaTx
): Promise<TransferWithUsers | null> {
  const client = tx ?? prisma;
  return client.ownershipTransfer.findUnique({
    where: { id: transferId },
    include: withUsers,
  });
}

/**
 * Build where clause for user transfer queries
 */
function buildUserTransferWhere(
  userId: string,
  filters: TransferQueryFilters = {}
): Prisma.OwnershipTransferWhereInput {
  const { role = 'all', status = 'all', resourceType } = filters;
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

  return where;
}

/**
 * Find transfers for a user with optional filters
 */
export async function findByUser(
  userId: string,
  filters: TransferQueryFilters = {}
): Promise<TransferWithUsers[]> {
  const where = buildUserTransferWhere(userId, filters);
  return prisma.ownershipTransfer.findMany({
    where,
    include: withUsers,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Count transfers for a user with optional filters (for pagination)
 */
export async function countByUser(
  userId: string,
  filters: TransferQueryFilters = {}
): Promise<number> {
  const where = buildUserTransferWhere(userId, filters);
  return prisma.ownershipTransfer.count({ where });
}

/**
 * Check if a resource has an active transfer (pending or accepted)
 */
export async function hasActiveTransfer(
  resourceType: string,
  resourceId: string,
  tx?: PrismaTx
): Promise<boolean> {
  const client = tx ?? prisma;
  const count = await client.ownershipTransfer.count({
    where: {
      resourceType,
      resourceId,
      status: { in: ['pending', 'accepted'] },
    },
  });
  return count > 0;
}

/**
 * Get count of pending incoming transfers for a user (notification badge)
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
 * Get count of transfers awaiting owner confirmation (notification badge)
 */
export async function getAwaitingConfirmationCount(userId: string): Promise<number> {
  return prisma.ownershipTransfer.count({
    where: {
      fromUserId: userId,
      status: 'accepted',
    },
  });
}

/**
 * Atomic status update using updateMany with WHERE conditions
 * Returns the number of records updated (0 means conditions not met - race lost)
 */
export async function atomicStatusUpdate(
  transferId: string,
  conditions: AtomicUpdateConditions,
  data: Prisma.OwnershipTransferUpdateManyMutationInput
): Promise<number> {
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      id: transferId,
      ...conditions,
    },
    data,
  });
  return result.count;
}

/**
 * Create a new transfer record
 */
export async function create(
  data: Prisma.OwnershipTransferUncheckedCreateInput,
  tx?: PrismaTx
): Promise<TransferWithUsers> {
  const client = tx ?? prisma;
  return client.ownershipTransfer.create({
    data,
    include: withUsers,
  });
}

/**
 * Update a transfer by ID (within a transaction)
 */
export async function update(
  transferId: string,
  data: Prisma.OwnershipTransferUpdateInput,
  tx?: PrismaTx
): Promise<OwnershipTransfer> {
  const client = tx ?? prisma;
  return client.ownershipTransfer.update({
    where: { id: transferId },
    data,
  });
}

/**
 * Expire overdue transfers (maintenance cleanup)
 * Updates all pending/accepted transfers past their expiry date
 * Returns count of expired transfers
 */
export async function expireOverdue(): Promise<number> {
  const result = await prisma.ownershipTransfer.updateMany({
    where: {
      status: { in: ['pending', 'accepted'] },
      expiresAt: { lt: new Date() },
    },
    data: {
      status: 'expired',
    },
  });

  if (result.count > 0) {
    log.info('Expired overdue transfers', { count: result.count });
  }

  return result.count;
}

// Export as namespace
export const transferRepository = {
  findById,
  findByIdWithUsers,
  findByUser,
  countByUser,
  hasActiveTransfer,
  getPendingIncomingCount,
  getAwaitingConfirmationCount,
  atomicStatusUpdate,
  create,
  update,
  expireOverdue,
};

export default transferRepository;
