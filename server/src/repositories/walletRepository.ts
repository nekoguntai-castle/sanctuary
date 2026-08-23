/**
 * Wallet Repository
 *
 * Abstracts database operations for wallets.
 * Provides centralized access patterns and query logic.
 */

import prisma from '../models/prisma';
import type { Wallet, Prisma } from '../generated/prisma/client';
import { WALLET_EDIT_ROLE_VALUES } from '@sanctuary/shared/constants/walletRoles';
import type {
  NetworkType,
  WalletWithAddresses,
  WalletSyncState,
  WalletSyncDurableState,
  IncrementalSyncLifecycleState,
  WalletSyncStatePatch,
  CursorPaginationOptions,
  CursorPaginatedResult,
} from './types';
import { buildWalletAccessWhere } from './accessControl';

const walletSyncStateSelect = {
  syncInProgress: true,
  lastSyncedAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
  lastSyncFailureClass: true,
  syncExecutionOwner: true,
  syncRetryCount: true,
  syncNextRetryAt: true,
  syncStartedAt: true,
  syncStateVersion: true,
  requestedIncrementalSyncGeneration: true,
  claimedIncrementalSyncGeneration: true,
  processedIncrementalSyncGeneration: true,
  incrementalSyncClaimedAt: true,
  incrementalSyncLeaseExpiresAt: true,
  syncActionRequiredAt: true,
  requestedFullResyncGeneration: true,
  preparedFullResyncGeneration: true,
  processedFullResyncGeneration: true,
} satisfies Prisma.WalletSelect;

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
): Promise<Array<{
  id: string;
  syncInProgress: boolean;
  lastSyncStatus: string | null;
  lastSyncedAt: Date | null;
  requestedIncrementalSyncGeneration: number;
  processedIncrementalSyncGeneration: number;
  requestedFullResyncGeneration: number;
  processedFullResyncGeneration: number;
  syncActionRequiredAt: Date | null;
}>> {
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
      requestedIncrementalSyncGeneration: true,
      processedIncrementalSyncGeneration: true,
      requestedFullResyncGeneration: true,
      processedFullResyncGeneration: true,
      syncActionRequiredAt: true,
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
 * Update wallet sync state and advance the CAS token used by stale recovery.
 */
export async function updateSyncState(
  walletId: string,
  state: WalletSyncStatePatch
): Promise<IncrementalSyncLifecycleState> {
  return prisma.wallet.update({
    where: { id: walletId },
    data: {
      ...state,
      syncStateVersion: { increment: 1 },
    },
  }) as Promise<IncrementalSyncLifecycleState>;
}

/** Atomically persist a worker sync's success metadata and lifecycle state. */
export async function completeSyncSuccess(
  walletId: string,
  lastSyncedAt: Date,
  lastSyncedBlockHeight: number,
): Promise<IncrementalSyncLifecycleState> {
  return prisma.wallet.update({
    where: { id: walletId },
    data: {
      lastSyncedAt,
      lastSyncedBlockHeight,
      lastSyncStatus: 'success',
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncInProgress: false,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
      syncStateVersion: { increment: 1 },
    },
  }) as Promise<IncrementalSyncLifecycleState>;
}

/** Read the authoritative persisted sync lifecycle state. */
export async function findSyncState(walletId: string): Promise<WalletSyncDurableState | null> {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    select: walletSyncStateSelect,
  }) as Promise<WalletSyncDurableState | null>;
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
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
      syncStateVersion: { increment: 1 },
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
        orderBy: { signerIndex: 'asc' },
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
              model: { select: { slug: true, name: true } },
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
          role: { in: [...WALLET_EDIT_ROLE_VALUES] },
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
 * Reset inline or legacy rows left active by an API-process restart.
 * Worker-owned attempts remain authoritative in BullMQ and must not be cleared
 * merely because an API process restarted.
 */
export async function resetAllStuckSyncFlags(): Promise<number> {
  const result = await prisma.wallet.updateMany({
    where: {
      syncInProgress: true,
      OR: [
        { syncExecutionOwner: null },
        { syncExecutionOwner: 'inline' },
      ],
    },
    data: {
      syncInProgress: false,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
      syncStateVersion: { increment: 1 },
    },
  });
  return result.count;
}

/**
 * Demote rows stranded mid-retry to a terminal `failed`.
 *
 * The retry ladder is driven by an in-heap `setTimeout`, so a restart discards
 * it silently and leaves `lastSyncStatus = 'retrying'` with no timer, no job
 * and no reaper that selects it - `findStuckWithCutoff` requires
 * `syncInProgress = true`, which a retrying row never has. The badge then reads
 * "Retrying" forever over work nothing is doing.
 *
 * Scoped to inline-owned rows and legacy null-owner rows because BullMQ owns
 * worker retry durability. `syncInProgress = false` leaves picked-up work alone.
 */
export async function demoteStrandedInlineRetries(
  reason: string,
  failureClass: WalletSyncState['lastSyncFailureClass'],
): Promise<number> {
  const result = await prisma.wallet.updateMany({
    where: {
      lastSyncStatus: 'retrying',
      OR: [
        { syncExecutionOwner: null },
        { syncExecutionOwner: 'inline' },
      ],
      syncInProgress: false,
    },
    data: {
      lastSyncStatus: 'failed',
      lastSyncError: reason,
      lastSyncFailureClass: failureClass,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
      syncStateVersion: { increment: 1 },
    },
  });
  return result.count;
}

/** Clear a stale active row only if its observed lifecycle snapshot is current. */
export async function clearSyncStateIfUnchanged(candidate: {
  id: string;
  syncExecutionOwner: string | null;
  syncStartedAt: Date | null;
  syncStateVersion: number;
}): Promise<WalletSyncDurableState | null> {
  return prisma.$transaction(async (tx) => {
    const result = await tx.wallet.updateMany({
      where: {
        id: candidate.id,
        syncInProgress: true,
        syncExecutionOwner: candidate.syncExecutionOwner,
        syncStartedAt: candidate.syncStartedAt,
        syncStateVersion: candidate.syncStateVersion,
      },
      data: {
        syncInProgress: false,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncFailureClass: null,
        syncExecutionOwner: null,
        syncRetryCount: 0,
        syncNextRetryAt: null,
        syncStartedAt: null,
        syncStateVersion: { increment: 1 },
      },
    });
    if (result.count !== 1) return null;
    return tx.wallet.findUnique({
      where: { id: candidate.id },
      select: walletSyncStateSelect,
    }) as Promise<WalletSyncDurableState | null>;
  });
}

/**
 * Find wallets currently marked as syncing
 */
export async function findStuckSyncing(): Promise<Array<{
  id: string;
  name: string;
  syncExecutionOwner?: string | null;
  syncStartedAt?: Date | null;
  syncStateVersion?: number;
}>> {
  return prisma.wallet.findMany({
    where: { syncInProgress: true },
    select: {
      id: true,
      name: true,
      syncExecutionOwner: true,
      syncStartedAt: true,
      syncStateVersion: true,
    },
    orderBy: [
      { syncStartedAt: 'asc' },
      { id: 'asc' },
    ],
    // Bound lock-authority work per sweep. Cleared rows leave this ordered
    // population, so subsequent sweeps deterministically advance through it.
    take: 100,
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
 * Find stuck wallets by the current attempt start time. Null start times are
 * legacy candidates and still require the caller's lock-authority probe.
 */
export async function findStuckWithCutoff(
  cutoff: Date
): Promise<Array<{
  id: string;
  name: string;
  syncExecutionOwner: string | null;
  syncStartedAt: Date | null;
  syncStateVersion: number;
}>> {
  return prisma.wallet.findMany({
    where: {
      syncInProgress: true,
      OR: [
        { syncStartedAt: { lt: cutoff } },
        { syncStartedAt: null },
      ],
    },
    select: {
      id: true,
      name: true,
      syncExecutionOwner: true,
      syncStartedAt: true,
      syncStateVersion: true,
    },
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
        include: {
          deviceAccount: true,
          device: {
            include: {
              accounts: true,
              model: { select: { slug: true, name: true } },
            },
          },
        },
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
        include: {
          deviceAccount: true,
          device: {
            include: {
              accounts: true,
              model: { select: { slug: true, name: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Link a device to a wallet.
 */
export interface WalletSignerLinkData {
  deviceId: string;
  deviceAccountId: string;
  signerIndex: number;
  signerBindingVersion: 1;
  signerFingerprint: string;
  signerXpub: string;
  signerDerivationPath: string;
  signerPurpose: string;
  signerScriptType: string;
}

export async function linkDevice(
  walletId: string,
  signer: WalletSignerLinkData,
): Promise<void> {
  await prisma.walletDevice.create({
    data: { walletId, ...signer },
  });
}

export interface WalletDescriptorAssignment {
  descriptor: string;
  changeDescriptor: string;
  fingerprint: string;
  descriptorPolicyVersion: 1;
  descriptorSourceKind: 'generated_pair' | 'imported_pair' | 'imported_multipath';
  sourceDescriptor: string;
  sourceChangeDescriptor: string | null;
  sourceDescriptorChecksum: string | null;
  sourceChangeDescriptorChecksum: string | null;
  canonicalPolicyId: string;
  canonicalPolicyVersion: number;
  addresses: Prisma.AddressCreateManyInput[];
}

async function assignMissingDescriptor(
  tx: Pick<typeof prisma, 'wallet' | 'address'>,
  walletId: string,
  assignment: WalletDescriptorAssignment,
): Promise<void> {
  // This CAS permits only the first policy assignment. Existing policy metadata
  // or addresses mean another writer/history already controls the wallet.
  const updated = await tx.wallet.updateMany({
    where: {
      id: walletId,
      descriptor: null,
      descriptorPolicyVersion: null,
      addresses: { none: {} },
    },
    data: {
      descriptor: assignment.descriptor,
      changeDescriptor: assignment.changeDescriptor,
      fingerprint: assignment.fingerprint,
      descriptorPolicyVersion: assignment.descriptorPolicyVersion,
      descriptorSourceKind: assignment.descriptorSourceKind,
      sourceDescriptor: assignment.sourceDescriptor,
      sourceChangeDescriptor: assignment.sourceChangeDescriptor,
      sourceDescriptorChecksum: assignment.sourceDescriptorChecksum,
      sourceChangeDescriptorChecksum: assignment.sourceChangeDescriptorChecksum,
      canonicalPolicyId: assignment.canonicalPolicyId,
      canonicalPolicyVersion: assignment.canonicalPolicyVersion,
    },
  });
  if (updated.count !== 1) {
    throw new Error('Wallet descriptor changed before signer binding completed');
  }
  await tx.address.createMany({ data: assignment.addresses });
}

export async function linkDeviceWithDescriptor(
  walletId: string,
  signer: WalletSignerLinkData,
  assignment: WalletDescriptorAssignment,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.walletDevice.create({ data: { walletId, ...signer } });
    await assignMissingDescriptor(tx, walletId, assignment);
  });
}

export async function assignDescriptorWithAddresses(
  walletId: string,
  assignment: WalletDescriptorAssignment,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assignMissingDescriptor(tx, walletId, assignment);
  });
}

/**
 * Atomically create a wallet with owner association and optional device links.
 * Returns the wallet with devices and addresses relations.
 */
export async function createWithDeviceLinks(
  data: Prisma.WalletCreateInput,
  signers?: WalletSignerLinkData[],
  initialAddresses: Array<Omit<Prisma.AddressCreateManyInput, 'walletId'>> = [],
): Promise<Wallet & { devices: Array<{ deviceId: string }>; addresses: Array<{ id: string }> }> {
  return prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.create({ data });

    if (signers && signers.length > 0) {
      await tx.walletDevice.createMany({
        data: signers.map((signer) => ({
          walletId: wallet.id,
          ...signer,
        })),
      });
    }

    if (initialAddresses.length > 0) {
      await tx.address.createMany({
        data: initialAddresses.map((address) => ({
          ...address,
          walletId: wallet.id,
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
  completeSyncSuccess,
  findSyncState,
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
  demoteStrandedInlineRetries,
  clearSyncStateIfUnchanged,
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
  linkDeviceWithDescriptor,
  assignDescriptorWithAddresses,
  createWithDeviceLinks,
};

export default walletRepository;
