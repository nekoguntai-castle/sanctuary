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
 * Find next unused external/receive address for a wallet.
 * BIP paths end with /<change>/<index>, where change 0 is receive and
 * change 1 is internal/change. Hardened coin-type segments use apostrophes
 * (for example /1'/), so the bare /0/ match is safe for receive filtering.
 */
export async function findNextUnusedReceive(
  walletId: string
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      walletId,
      used: false,
      derivationPath: { contains: '/0/' },
    },
    orderBy: { index: 'asc' },
  });
}

/**
 * Find next unused change address (BIP44 derivation path containing /1/)
 */
export async function findNextUnusedChange(
  walletId: string
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      walletId,
      used: false,
      derivationPath: { contains: '/1/' },
    },
    orderBy: { index: 'asc' },
  });
}

/**
 * Find multiple unused change addresses for decoy output generation
 */
export async function findUnusedChangeAddresses(
  walletId: string,
  take: number
): Promise<Address[]> {
  return prisma.address.findMany({
    where: {
      walletId,
      used: false,
      derivationPath: { contains: '/1/' },
    },
    orderBy: { index: 'asc' },
    take,
  });
}

/**
 * Find unused addresses excluding specific addresses
 */
export async function findUnusedExcluding(
  walletId: string,
  excludeAddresses: string[],
  take: number
): Promise<Address[]> {
  return prisma.address.findMany({
    where: {
      walletId,
      used: false,
      address: { notIn: excludeAddresses },
    },
    orderBy: { index: 'asc' },
    take,
  });
}

/**
 * Find derivation paths for specific addresses in a wallet
 */
export async function findDerivationPathsByAddresses(
  walletId: string,
  addresses: string[]
): Promise<Array<{ address: string; derivationPath: string }>> {
  return prisma.address.findMany({
    where: {
      walletId,
      address: { in: addresses },
    },
    select: {
      address: true,
      derivationPath: true,
    },
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
  /* v8 ignore next -- changeFilter branch is covered through route-level address filters */
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

/**
 * Find addresses by address strings for user's accessible wallets (for address-lookup)
 */
export async function findByAddressesForUser(
  addresses: string[],
  userId: string
) {
  return prisma.address.findMany({
    where: {
      address: { in: addresses },
      wallet: {
        users: {
          some: {
            userId,
          },
        },
      },
    },
    select: {
      address: true,
      wallet: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
}

/**
 * Find address strings for a wallet (lean query for sync operations)
 */
export async function findAddressStrings(walletId: string): Promise<string[]> {
  const addresses = await prisma.address.findMany({
    where: { walletId },
    select: { address: true },
  });
  return addresses.map(a => a.address);
}

/**
 * Find address id/string pairs for a wallet (for field population during sync)
 */
export async function findIdAndAddressByWalletId(
  walletId: string
): Promise<Array<{ id: string; address: string }>> {
  return prisma.address.findMany({
    where: { walletId },
    select: { id: true, address: true },
  });
}

/**
 * Bulk mark addresses as used by address string (for sync update addresses phase)
 */
export async function markManyAsUsedByAddress(
  walletId: string,
  addresses: string[]
): Promise<number> {
  /* v8 ignore next -- bulk callers avoid empty address batches */
  if (addresses.length === 0) return 0;
  const result = await prisma.address.updateMany({
    where: {
      walletId,
      address: { in: addresses },
      used: false,
    },
    data: { used: true },
  });
  return result.count;
}

/**
 * Find an address by ID with its wallet included (for single-address sync)
 */
export async function findByIdWithWallet(addressId: string) {
  return prisma.address.findUnique({
    where: { id: addressId },
    include: { wallet: true },
  });
}

/**
 * Find recently created unused addresses for a wallet (for gap limit expansion sync)
 */
export async function findRecentUnused(
  walletId: string,
  take: number
): Promise<Address[]> {
  return prisma.address.findMany({
    where: { walletId, used: false },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

/**
 * Find all addresses with wallet info (for subscription management)
 */
export async function findAllWithWalletNetwork(): Promise<Array<{
  id: string;
  address: string;
  walletId: string;
  wallet: { network: string };
}>> {
  return prisma.address.findMany({
    select: {
      id: true,
      address: true,
      walletId: true,
      wallet: { select: { network: true } },
    },
    orderBy: { id: 'asc' },
  });
}

/**
 * Find all addresses with wallet info, paginated by cursor (for large deployments)
 */
export async function findAllWithWalletNetworkPaginated(options: {
  take: number;
  cursor?: string;
}): Promise<Array<{
  id: string;
  address: string;
  walletId: string;
  wallet: { network: string };
}>> {
  return prisma.address.findMany({
    select: {
      id: true,
      address: true,
      walletId: true,
      wallet: { select: { network: true } },
    },
    take: options.take,
    skip: options.cursor ? 1 : 0,
    cursor: options.cursor ? { id: options.cursor } : undefined,
    orderBy: { id: 'asc' },
  });
}

/**
 * Find an address record by address string (no access check)
 */
export async function findByAddress(
  address: string,
  select?: { walletId: true }
): Promise<{ walletId: string } | null> {
  return prisma.address.findFirst({
    where: { address },
    select: select ?? { walletId: true },
  });
}

/**
 * Find an address record by address string with wallet included
 */
export async function findByAddressWithWallet(address: string) {
  return prisma.address.findFirst({
    where: { address },
    include: { wallet: true },
  });
}

/**
 * Create a single address
 */
export async function create(data: {
  walletId: string;
  address: string;
  derivationPath: string;
  index: number;
  used: boolean;
}): Promise<Address> {
  return prisma.address.create({ data });
}

// Export as namespace
export const addressRepository = {
  resetUsedFlags,
  resetUsedFlagsForWallets,
  findByWalletId,
  markAsUsed,
  findNextUnused,
  findNextUnusedReceive,
  findNextUnusedChange,
  findUnusedChangeAddresses,
  findUnusedExcluding,
  findDerivationPathsByAddresses,
  countByWalletId,
  findWithLabels,
  findByIdWithAccess,
  findByWalletIdWithLabels,
  createMany,
  findDerivationPaths,
  getAddressSummary,
  findUtxoBalancesByAddresses,
  findByAddressesForUser,
  findAddressStrings,
  findIdAndAddressByWalletId,
  // Sync pipeline methods
  markManyAsUsedByAddress,
  findByIdWithWallet,
  findRecentUnused,
  findAllWithWalletNetwork,
  findAllWithWalletNetworkPaginated,
  findByAddress,
  findByAddressWithWallet,
  create,
};

export default addressRepository;
