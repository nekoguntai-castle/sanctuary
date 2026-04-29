/**
 * Address Repository
 *
 * Abstracts database operations for addresses.
 */

import prisma from "../models/prisma";
import type { Address, Prisma } from "../generated/prisma/client";
import { buildWalletAccessWhere } from "./accessControl";
import {
  parseAddressDerivationPath,
  type DerivationAddressChain,
} from "../../../shared/utils/bitcoin";

const ADDRESS_CHAIN_SCAN_PAGE_SIZE = 200;

const addressLabelsInclude = {
  addressLabels: {
    include: {
      label: true,
    },
  },
} satisfies Prisma.AddressInclude;

type AddressPathRecord = { derivationPath: string | null };
type AddressPathIdRecord = AddressPathRecord & { id: string };
type AddressWithLabels = Prisma.AddressGetPayload<{
  include: typeof addressLabelsInclude;
}>;

interface AddressIdPageState {
  skippedMatches: number;
  skipTarget: number;
  take?: number;
  ids: string[];
}

function matchesAddressChain(
  address: AddressPathRecord,
  chain: DerivationAddressChain,
): boolean {
  return parseAddressDerivationPath(address.derivationPath)?.chain === chain;
}

function appendMatchingAddresses<T extends AddressPathRecord>(
  addresses: T[],
  chain: DerivationAddressChain,
  matches: T[],
  limit: number,
): void {
  for (const address of addresses) {
    if (matches.length >= limit) return;
    if (matchesAddressChain(address, chain)) {
      matches.push(address);
    }
  }
}

function appendMatchingAddressIds(
  addresses: AddressPathIdRecord[],
  chain: DerivationAddressChain,
  state: AddressIdPageState,
): void {
  for (const address of addresses) {
    if (state.take !== undefined && state.ids.length >= state.take) return;
    if (!matchesAddressChain(address, chain)) continue;

    if (state.skippedMatches < state.skipTarget) {
      state.skippedMatches++;
      continue;
    }

    state.ids.push(address.id);
  }
}

function hasCollectedRequestedTake(state: AddressIdPageState): boolean {
  return state.take !== undefined && state.ids.length >= state.take;
}

async function findUnusedByAddressChain(
  walletId: string,
  chain: DerivationAddressChain,
  take: number,
): Promise<Address[]> {
  const limit = Math.max(0, take);
  const matches: Address[] = [];
  let skip = 0;

  while (matches.length < limit) {
    const addresses = await prisma.address.findMany({
      where: {
        walletId,
        used: false,
      },
      orderBy: { index: "asc" },
      skip,
      take: ADDRESS_CHAIN_SCAN_PAGE_SIZE,
    });

    appendMatchingAddresses(addresses, chain, matches, limit);
    if (addresses.length < ADDRESS_CHAIN_SCAN_PAGE_SIZE) break;
    skip += addresses.length;
  }

  return matches;
}

async function collectAddressIdsByChain(
  where: Prisma.AddressWhereInput,
  chain: DerivationAddressChain,
  skip?: number,
  take?: number,
): Promise<string[]> {
  const state: AddressIdPageState = {
    skippedMatches: 0,
    skipTarget: Math.max(0, skip ?? 0),
    take: take === undefined ? undefined : Math.max(0, take),
    ids: [],
  };
  let dbSkip = 0;

  while (!hasCollectedRequestedTake(state)) {
    const addresses = await prisma.address.findMany({
      where,
      select: { id: true, derivationPath: true },
      orderBy: { index: "asc" },
      skip: dbSkip,
      take: ADDRESS_CHAIN_SCAN_PAGE_SIZE,
    });

    appendMatchingAddressIds(addresses, chain, state);
    if (addresses.length < ADDRESS_CHAIN_SCAN_PAGE_SIZE) break;
    dbSkip += addresses.length;
  }

  return state.ids;
}

async function findAddressesByIdsWithLabels(
  ids: string[],
): Promise<AddressWithLabels[]> {
  if (ids.length === 0) return [];

  const addresses = await prisma.address.findMany({
    where: { id: { in: ids } },
    include: addressLabelsInclude,
  });
  const byId = new Map(addresses.map((address) => [address.id, address]));

  return ids.flatMap((id) => {
    const address = byId.get(id);
    return address ? [address] : [];
  });
}

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
export async function resetUsedFlagsForWallets(
  walletIds: string[],
): Promise<number> {
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
  },
): Promise<Address[]> {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }

  return prisma.address.findMany({
    where,
    skip: options?.skip,
    take: options?.take,
    orderBy: { index: "asc" },
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
 */
export async function findNextUnused(
  walletId: string,
): Promise<Address | null> {
  return prisma.address.findFirst({
    where: {
      walletId,
      used: false,
    },
    orderBy: { index: "asc" },
  });
}

/**
 * Find next unused external/receive address for a wallet.
 */
export async function findNextUnusedReceive(
  walletId: string,
): Promise<Address | null> {
  return (await findUnusedByAddressChain(walletId, "receive", 1))[0] ?? null;
}

/**
 * Find next unused change address.
 */
export async function findNextUnusedChange(
  walletId: string,
): Promise<Address | null> {
  return (await findUnusedByAddressChain(walletId, "change", 1))[0] ?? null;
}

/**
 * Find multiple unused change addresses for decoy output generation
 */
export async function findUnusedChangeAddresses(
  walletId: string,
  take: number,
): Promise<Address[]> {
  return findUnusedByAddressChain(walletId, "change", take);
}

/**
 * Find unused addresses excluding specific addresses
 */
export async function findUnusedExcluding(
  walletId: string,
  excludeAddresses: string[],
  take: number,
): Promise<Address[]> {
  return prisma.address.findMany({
    where: {
      walletId,
      used: false,
      address: { notIn: excludeAddresses },
    },
    orderBy: { index: "asc" },
    take,
  });
}

/**
 * Find derivation paths for specific addresses in a wallet
 */
export async function findDerivationPathsByAddresses(
  walletId: string,
  addresses: string[],
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
  options?: { used?: boolean },
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
    include: addressLabelsInclude,
  });
}

/**
 * Find an address by ID if user has access to its wallet
 */
export async function findByIdWithAccess(
  addressId: string,
  userId: string,
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
    chain?: DerivationAddressChain;
    skip?: number;
    take?: number;
  },
) {
  const where: Prisma.AddressWhereInput = { walletId };

  if (options?.used !== undefined) {
    where.used = options.used;
  }

  if (!options?.chain) {
    return prisma.address.findMany({
      where,
      include: addressLabelsInclude,
      orderBy: { index: "asc" },
      take: options?.take,
      skip: options?.skip,
    });
  }

  const addressIds = await collectAddressIdsByChain(
    where,
    options.chain,
    options.skip,
    options.take,
  );
  return findAddressesByIdsWithLabels(addressIds);
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
  options?: { skipDuplicates?: boolean },
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
  const [totalCount, usedCount, unusedCount, totalBalanceResult, usedBalances] =
    await Promise.all([
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

  return {
    totalCount,
    usedCount,
    unusedCount,
    totalBalanceResult,
    usedBalances,
  };
}

/**
 * Find UTXO balances grouped by address for a set of addresses
 */
export async function findUtxoBalancesByAddresses(
  walletId: string,
  addresses: string[],
) {
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
  userId: string,
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
 * Find wallet summaries for known address strings without applying a user access filter.
 * Used by backend-only monitoring to classify whether a spend destination is internal.
 */
export async function findWalletSummariesByAddresses(addresses: string[]) {
  const uniqueAddresses = Array.from(new Set(addresses.filter(Boolean)));
  if (uniqueAddresses.length === 0) return [];

  return prisma.address.findMany({
    where: {
      address: { in: uniqueAddresses },
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
  return addresses.map((a) => a.address);
}

/**
 * Find address id/string pairs for a wallet (for field population during sync)
 */
export async function findIdAndAddressByWalletId(
  walletId: string,
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
  addresses: string[],
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
  take: number,
): Promise<Address[]> {
  return prisma.address.findMany({
    where: { walletId, used: false },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Find all addresses with wallet info (for subscription management)
 */
export async function findAllWithWalletNetwork(): Promise<
  Array<{
    id: string;
    address: string;
    walletId: string;
    wallet: { network: string };
  }>
> {
  return prisma.address.findMany({
    select: {
      id: true,
      address: true,
      walletId: true,
      wallet: { select: { network: true } },
    },
    orderBy: { id: "asc" },
  });
}

/**
 * Find all addresses with wallet info, paginated by cursor (for large deployments)
 */
export async function findAllWithWalletNetworkPaginated(options: {
  take: number;
  cursor?: string;
}): Promise<
  Array<{
    id: string;
    address: string;
    walletId: string;
    wallet: { network: string };
  }>
> {
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
    orderBy: { id: "asc" },
  });
}

/**
 * Find an address record by address string (no access check)
 */
export async function findByAddress(
  address: string,
  select?: { walletId: true },
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
  findWalletSummariesByAddresses,
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
