/**
 * Address Repository
 *
 * Abstracts database operations for addresses.
 */

import prisma from '../models/prisma';
import type { Address, Prisma } from '../generated/prisma/client';
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

/**
 * Find addresses by wallet with labels included
 */
export async function findByWalletIdWithLabels(
  walletId: string,
  options?: {
    used?: boolean;
    changeFilter?: { derivationPath: { contains: string } };
    skip?: number;
    take?: number;
  }
) {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }
  if (options?.changeFilter) {
    where.derivationPath = options.changeFilter.derivationPath;
  }

  return prisma.address.findMany({
    where,
    include: {
      addressLabels: {
        include: {
          label: true,
        },
      },
    },
    orderBy: { index: 'asc' },
    take: options?.take,
    skip: options?.skip,
  });
}

/**
 * Bulk create addresses
 */
export async function createMany(
  data: Array<{
    walletId: string;
    address: string;
    derivationPath: string;
    index: number;
    used: boolean;
  }>,
  options?: { skipDuplicates?: boolean }
) {
  return prisma.address.createMany({
    data,
    skipDuplicates: options?.skipDuplicates,
  });
}

/**
 * Find derivation paths for all addresses in a wallet
 */
export async function findDerivationPaths(walletId: string) {
  return prisma.address.findMany({
    where: { walletId },
    select: { derivationPath: true, index: true },
  });
}

/**
 * Get address summary counts and balances for a wallet
 */
export async function getAddressSummary(walletId: string) {
  const [totalCount, usedCount, unusedCount, totalBalanceResult, usedBalances] = await Promise.all([
    prisma.address.count({ where: { walletId } }),
    prisma.address.count({ where: { walletId, used: true } }),
    prisma.address.count({ where: { walletId, used: false } }),
    prisma.uTXO.aggregate({
      where: { walletId, spent: false },
      _sum: { amount: true },
    }),
    prisma.$queryRaw<Array<{ used: boolean; balance: bigint }>>`
      SELECT a."used" as used, COALESCE(SUM(u."amount"), 0) as balance
      FROM "utxos" u
      JOIN "addresses" a ON a."address" = u."address"
      WHERE u."walletId" = ${walletId} AND u."spent" = false
      GROUP BY a."used"
    `,
  ]);

  return { totalCount, usedCount, unusedCount, totalBalanceResult, usedBalances };
}

/**
 * Find UTXO balances grouped by address for a set of addresses
 */
export async function findUtxoBalancesByAddresses(walletId: string, addresses: string[]) {
  return prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      ...(addresses.length > 0 && { address: { in: addresses } }),
    },
    select: {
      address: true,
      amount: true,
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
  findByWalletIdWithLabels,
  createMany,
  findDerivationPaths,
  getAddressSummary,
  findUtxoBalancesByAddresses,
};

export default addressRepository;
