/**
 * Address Repository
 *
 * Abstracts database operations for addresses.
 */

import prisma from '../models/prisma';
import type { Address, Prisma } from '@prisma/client';
import { buildWalletAccessWhere } from './accessControl';

/**
 * Reset used flags for all addresses in a wallet
 */
export async function resetUsedFlags(walletId: string): Promise<number> {
  const result = await prisma.address.updateMany({
    where: { walletId },
    data: { used: false },
  });
  return result.count;
}

/**
 * Reset used flags for all addresses in multiple wallets
 */
export async function resetUsedFlagsForWallets(walletIds: string[]): Promise<number> {
  const result = await prisma.address.updateMany({
    where: { walletId: { in: walletIds } },
    data: { used: false },
  });
  return result.count;
}

/**
 * Find addresses by wallet
 */
export async function findByWalletId(
  walletId: string,
  options?: {
    used?: boolean;
    skip?: number;
    take?: number;
  }
): Promise<Address[]> {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }

  return prisma.address.findMany({
    where,
    skip: options?.skip,
    take: options?.take,
    orderBy: { index: 'asc' },
  });
}

/**
 * Mark address as used
 */
export async function markAsUsed(addressId: string): Promise<Address> {
  return prisma.address.update({
    where: { id: addressId },
    data: { used: true },
  });
}

/**
 * Find next unused address for a wallet
 * Note: Change addresses are distinguished by derivation path (contains /1/ for change)
 */
export async function findNextUnused(
  walletId: string
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      walletId,
      used: false,
    },
    orderBy: { index: 'asc' },
  });
}

/**
 * Count addresses by wallet
 */
export async function countByWalletId(
  walletId: string,
  options?: { used?: boolean }
): Promise<number> {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }

  return prisma.address.count({ where });
}

/**
 * Find addresses with labels for export
 */
export async function findWithLabels(walletId: string) {
  return prisma.address.findMany({
    where: {
      walletId,
      addressLabels: { some: {} },
    },
    include: {
      addressLabels: {
        include: {
          label: true,
        },
      },
    },
  });
}

/**
 * Find an address by ID if user has access to its wallet
 */
export async function findByIdWithAccess(
  addressId: string,
  userId: string
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      id: addressId,
      wallet: buildWalletAccessWhere(userId),
    },
  });
}

// Export as namespace
export const addressRepository = {
  resetUsedFlags,
  resetUsedFlagsForWallets,
  findByWalletId,
  markAsUsed,
  findNextUnused,
  countByWalletId,
  findWithLabels,
  findByIdWithAccess,
};

export default addressRepository;
