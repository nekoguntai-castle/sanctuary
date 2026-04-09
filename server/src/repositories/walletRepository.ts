/**
 * Wallet Repository
 *
 * Abstracts database operations for wallets.
 * Provides centralized access patterns and query logic.
 */

import prisma from '../models/prisma';
import type { Wallet, Prisma } from '../generated/prisma/client';
import type {
  NetworkType,
  WalletWithAddresses,
  WalletSyncState,
  CursorPaginationOptions,
  CursorPaginatedResult,
} from './types';
import { buildWalletAccessWhere } from './accessControl';

/**
 * Find a wallet by ID if user has access
 * Returns null if wallet doesn't exist or user lacks access
 */
export async function findByIdWithAccess(
  walletId: string,
  userId: string
): Promise<Wallet | null> {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
  });
}

/**
 * Find a wallet by ID with addresses included
 */
export async function findByIdWithAddresses(
  walletId: string,
  userId: string
): Promise<WalletWithAddresses | null> {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    include: {
      addresses: true,
    },
  });
}

/**
 * Find all wallets for a user
 */
export async function findByUserId(userId: string): Promise<Wallet[]> {
  return prisma.wallet.findMany({
    where: buildWalletAccessWhere(userId),
  });
}

/**
 * Find wallets for a user with cursor-based pagination
 * More efficient for large wallet collections
 */
export async function findByUserIdPaginated(
  userId: string,
  options: CursorPaginationOptions = {}
): Promise<CursorPaginatedResult<Wallet>> {
  const { limit = 50, cursor, direction = 'forward' } = options;
  const take = Math.min(limit, 200) + 1; // Fetch one extra to detect hasMore

  const wallets = await prisma.wallet.findMany({
    where: {
      ...buildWalletAccessWhere(userId),
      ...(cursor ? { id: direction === 'forward' ? { gt: cursor } : { lt: cursor } } : {}),
    },
    take,
    orderBy: { id: direction === 'forward' ? 'asc' : 'desc' },
  });

  const hasMore = wallets.length > limit;
  const items = wallets.slice(0, limit);

  // Reverse if paginating backward to maintain consistent order
  if (direction === 'backward') {
    items.reverse();
  }

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    hasMore,
  };
}

/**
 * Find all wallets for a user on a specific network
 */
export async function findByNetwork(
  userId: string,
  network: NetworkType
): Promise<Wallet[]> {
  return prisma.wallet.findMany({
    where: {
      network,
      ...buildWalletAccessWhere(userId),
    },
  });
}

/**
 * Find wallets by network with sync status info
 */
export async function findByNetworkWithSyncStatus(
  userId: string,
  network: NetworkType
): Promise<Array<{ id: string; syncInProgress: boolean; lastSyncStatus: string | null; lastSyncedAt: Date | null }>> {
  return prisma.wallet.findMany({
    where: {
      network,
      ...buildWalletAccessWhere(userId),
    },
    select: {
      id: true,
      syncInProgress: true,
      lastSyncStatus: true,
      lastSyncedAt: true,
    },
  });
}

/**
 * Get wallet IDs for a network
 */
export async function getIdsByNetwork(
  userId: string,
  network: NetworkType
): Promise<string[]> {
  const wallets = await prisma.wallet.findMany({
    where: {
      network,
      ...buildWalletAccessWhere(userId),
    },
    select: { id: true },
  });
  return wallets.map(w => w.id);
}

/**
 * Update wallet sync state
 */
export async function updateSyncState(
  walletId: string,
  state: Partial<WalletSyncState>
): Promise<Wallet> {
  return prisma.wallet.update({
    where: { id: walletId },
    data: state,
  });
}

/**
 * Reset sync state for a wallet
 */
export async function resetSyncState(walletId: string): Promise<Wallet> {
  return prisma.wallet.update({
    where: { id: walletId },
    data: {
      syncInProgress: false,
      lastSyncedAt: null,
      lastSyncStatus: null,
    },
  });
}

/**
 * Update wallet
 */
export async function update(
  walletId: string,
  data: Prisma.WalletUpdateInput
): Promise<Wallet> {
  return prisma.wallet.update({
    where: { id: walletId },
    data,
  });
}

/**
 * Check if user has access to wallet
 */
export async function hasAccess(walletId: string, userId: string): Promise<boolean> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    select: { id: true },
  });
  return wallet !== null;
}

/**
 * Find wallet by ID (no access check - for internal use only)
 */
export async function findById(walletId: string): Promise<Wallet | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
  });
}

/**
 * Get wallet name
 */
export async function getName(walletId: string): Promise<string | null> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { name: true },
  });
  return wallet?.name ?? null;
}

/**
 * Find wallet with group info
 */
export async function findByIdWithGroup(walletId: string): Promise<(Wallet & { group: { name: string } | null }) | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: { group: true },
  });
}

/**
 * Find wallet with device signing info for transaction construction.
 * Returns only the device fields needed for PSBT signing (fingerprint, xpub).
 */
export async function findByIdWithSigningDevices(walletId: string) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: true,
        },
      },
    },
  });
}

/**
 * Find wallet with devices for export
 * Includes device accounts to properly select derivation paths for wallet type
 */
export async function findByIdWithDevices(walletId: string) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      devices: {
        include: {
          device: {
            include: {
              accounts: true,
            },
          },
        },
        orderBy: { signerIndex: 'asc' },
      },
    },
  });
}

/**
 * Find wallet by ID with specific select (no access check - for internal use)
 */
export async function findByIdWithSelect<T extends Prisma.WalletSelect>(
  walletId: string,
  select: T
) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    select,
  });
}

/**
 * Find accessible wallets for a user with select
 */
export async function findAccessibleWithSelect<T extends Prisma.WalletSelect>(
  userId: string,
  select: T,
  additionalWhere?: Prisma.WalletWhereInput
) {
  return prisma.wallet.findMany({
    where: {
      ...buildWalletAccessWhere(userId),
      ...additionalWhere,
    },
    select,
  });
}

/**
 * Find a wallet by ID with sign/edit access check (owner or signer role)
 */
export async function findByIdWithEditAccess(
  walletId: string,
  userId: string
): Promise<Wallet | null> {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: {
        some: {
          userId,
          role: { in: ['owner', 'signer'] },
        },
      },
    },
  });
}

/**
 * Find a wallet's group role by group membership
 * Used by access control to check group-based wallet access
 */
export async function findGroupRoleByMembership(
  walletId: string,
  userId: string
): Promise<string | null> {
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      group: { members: { some: { userId } } },
    },
    select: { groupRole: true },
  });
  return wallet?.groupRole ?? null;
}

/**
 * Find wallet name by ID (lean select)
 */
export async function findNameById(walletId: string): Promise<{ id: string; name: string } | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    select: { id: true, name: true },
  });
}

/**
 * Get wallet network (lean query for sync operations)
 */
export async function findNetwork(walletId: string): Promise<string | null> {
  const wallet = await prisma.wallet.findUnique({
    where: { id: walletId },
    select: { network: true },
  });
  return wallet?.network ?? null;
}

/**
 * Reset all wallets with syncInProgress=true (batch updateMany)
 * Used on startup to clear stale flags from previous server sessions.
 */
export async function resetAllStuckSyncFlags(): Promise<number> {
  const result = await prisma.wallet.updateMany({
    where: { syncInProgress: true },
    data: { syncInProgress: false },
  });
  return result.count;
}

/**
 * Find wallets currently marked as syncing
 */
export async function findStuckSyncing(
  select?: { id: true; name: true; lastSyncedAt?: true }
): Promise<Array<{ id: string; name: string; lastSyncedAt?: Date | null }>> {
  return prisma.wallet.findMany({
    where: { syncInProgress: true },
    select: select ?? { id: true, name: true },
  });
}

/**
 * Find stale wallets that need syncing (not synced recently or never synced)
 */
export async function findStale(options: {
  staleThresholdMs: number;
  maxResults?: number;
  orderBy?: Prisma.WalletOrderByWithRelationInput[];
}): Promise<Array<{ id: string; name: string; lastSyncedAt: Date | null }>> {
  return prisma.wallet.findMany({
    where: {
      OR: [
        { lastSyncedAt: null },
        { lastSyncedAt: { lt: new Date(Date.now() - options.staleThresholdMs) } },
      ],
      syncInProgress: false,
    },
    select: { id: true, name: true, lastSyncedAt: true },
    orderBy: options.orderBy,
    take: options.maxResults,
  });
}

/**
 * Find stuck wallets (syncInProgress=true AND not synced recently)
 */
export async function findStuckWithCutoff(
  cutoff: Date
): Promise<Array<{ id: string; name: string; lastSyncedAt: Date | null }>> {
  return prisma.wallet.findMany({
    where: {
      syncInProgress: true,
      OR: [
        { lastSyncedAt: { lt: cutoff } },
        { lastSyncedAt: null },
      ],
    },
    select: { id: true, name: true, lastSyncedAt: true },
  });
}

/**
 * Find all wallets with a custom select (no access check - for internal use)
 */
export async function findAllWithSelect<T extends Prisma.WalletSelect>(
  select: T,
  where?: Prisma.WalletWhereInput
) {
  return prisma.wallet.findMany({
    where,
    select,
  });
}

/**
 * Find a wallet by ID with access check and custom includes
 */
export async function findByIdWithAccessAndInclude(
  walletId: string,
  userId: string,
  include: Prisma.WalletInclude
) {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    include,
  });
}

/**
 * Delete a wallet by ID
 */
export async function deleteById(walletId: string): Promise<void> {
  await prisma.wallet.delete({
    where: { id: walletId },
  });
}

/**
 * Find wallet by ID with access check and custom include (for wallet queries)
 */
export async function findByIdWithFullAccess(
  walletId: string,
  userId: string,
  include: Prisma.WalletInclude
) {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include,
  });
}

/**
 * Find all wallets accessible by a user with custom include
 */
export async function findByUserIdWithInclude(
  userId: string,
  include: Prisma.WalletInclude,
  orderBy?: Prisma.WalletOrderByWithRelationInput
) {
  return prisma.wallet.findMany({
    where: {
      OR: [
        { users: { some: { userId } } },
        { group: { members: { some: { userId } } } },
      ],
    },
    include,
    orderBy,
  });
}

/**
 * Find a wallet by ID with access check and device details.
 * Returns wallet with nested device relations for descriptor building.
 */
export async function findByIdWithAccessAndDevices(walletId: string, userId: string) {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      ...buildWalletAccessWhere(userId),
    },
    include: {
      devices: {
        include: { device: true },
      },
    },
  });
}

/**
 * Find a wallet by ID where the user is an owner, with device details.
 * Used for operations restricted to wallet owners (e.g., descriptor repair).
 */
export async function findByIdWithOwnerAndDevices(walletId: string, userId: string) {
  return prisma.wallet.findFirst({
    where: {
      id: walletId,
      users: { some: { userId, role: 'owner' } },
    },
    include: {
      devices: {
        include: { device: true },
      },
    },
  });
}

/**
 * Link a device to a wallet.
 */
export async function linkDevice(
  walletId: string,
  deviceId: string,
  signerIndex?: number,
): Promise<void> {
  await prisma.walletDevice.create({
    data: { walletId, deviceId, signerIndex },
  });
}

/**
 * Atomically create a wallet with owner association and optional device links.
 * Returns the wallet with devices and addresses relations.
 */
export async function createWithDeviceLinks(
  data: Prisma.WalletCreateInput,
  deviceIds?: string[],
): Promise<Wallet & { devices: Array<{ deviceId: string }>; addresses: Array<{ id: string }> }> {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.create({ data });

    if (deviceIds && deviceIds.length > 0) {
      await tx.walletDevice.createMany({
        data: deviceIds.map((deviceId, index) => ({
          walletId: wallet.id,
          deviceId,
          signerIndex: index,
        })),
      });
    }

    const result = await tx.wallet.findUnique({
      where: { id: wallet.id },
      include: { devices: true, addresses: true },
    });

    if (!result) throw new Error('Failed to create wallet');
    return result;
  });
}

/**
 * Execute a callback inside a default-isolation Prisma transaction.
 * Used by services that need atomic multi-model operations.
 */
export async function withTransaction<T>(
  fn: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return prisma.$transaction(fn);
}

// Export all functions as a namespace for convenient importing
export const walletRepository = {
  findByIdWithAccess,
  findByIdWithAddresses,
  findByUserId,
  findByUserIdPaginated,
  findByNetwork,
  findByNetworkWithSyncStatus,
  getIdsByNetwork,
  updateSyncState,
  resetSyncState,
  update,
  hasAccess,
  findById,
  getName,
  findByIdWithGroup,
  findByIdWithSigningDevices,
  findByIdWithDevices,
  findByIdWithSelect,
  findAccessibleWithSelect,
  findByIdWithEditAccess,
  findGroupRoleByMembership,
  findNameById,
  findNetwork,
  resetAllStuckSyncFlags,
  findStuckSyncing,
  findStale,
  findStuckWithCutoff,
  findAllWithSelect,
  findByIdWithAccessAndInclude,
  deleteById,
  findByIdWithFullAccess,
  findByUserIdWithInclude,
  findByIdWithAccessAndDevices,
  findByIdWithOwnerAndDevices,
  linkDevice,
  createWithDeviceLinks,
  withTransaction,
};

export default walletRepository;
