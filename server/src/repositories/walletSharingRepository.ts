/**
 * Wallet Sharing Repository
 *
 * Abstracts database operations for wallet access/sharing.
 * Automatically invalidates access cache when roles change.
 */

import prisma from '../models/prisma';
import type { WalletUser, GroupMember } from '../generated/prisma/client';
import { invalidateWalletAccessCache } from '../infrastructure/accessCache';

type WalletUserRole = 'owner' | 'viewer' | 'signer' | 'approver';

/**
 * Find wallet user access record
 */
export async function findWalletUser(
  walletId: string,
  userId: string
): Promise<WalletUser | null> {
  return prisma.walletUser.findFirst({
    where: { walletId, userId },
  });
}

/**
 * Add user to wallet
 */
export async function addUserToWallet(
  walletId: string,
  userId: string,
  role: WalletUserRole
): Promise<WalletUser> {
  const result = await prisma.walletUser.create({
    data: { walletId, userId, role },
  });
  // Invalidate cache for this wallet (user just gained access)
  await invalidateWalletAccessCache(walletId);
  return result;
}

/**
 * Update user's role in wallet
 */
export async function updateUserRole(
  walletUserId: string,
  role: WalletUserRole
): Promise<WalletUser> {
  const result = await prisma.walletUser.update({
    where: { id: walletUserId },
    data: { role },
  });
  // Invalidate cache for this wallet (role changed)
  await invalidateWalletAccessCache(result.walletId);
  return result;
}

/**
 * Remove user from wallet
 */
export async function removeUserFromWallet(walletUserId: string): Promise<void> {
  // Get the wallet/user IDs before deleting for cache invalidation
  const walletUser = await prisma.walletUser.findUnique({
    where: { id: walletUserId },
    select: { walletId: true, userId: true },
  });

  await prisma.walletUser.delete({
    where: { id: walletUserId },
  });

  // Invalidate cache for this wallet (user lost access)
  if (walletUser) {
    await invalidateWalletAccessCache(walletUser.walletId);
  }
}

/**
 * Check if user is member of group
 */
export async function isGroupMember(
  groupId: string,
  userId: string
): Promise<boolean> {
  const member = await prisma.groupMember.findFirst({
    where: { groupId, userId },
  });
  return member !== null;
}

/**
 * Get group member record
 */
export async function getGroupMember(
  groupId: string,
  userId: string
): Promise<GroupMember | null> {
  return prisma.groupMember.findFirst({
    where: { groupId, userId },
  });
}

/**
 * Update wallet's group assignment
 */
export async function updateWalletGroup(
  walletId: string,
  groupId: string | null,
  groupRole: string = 'viewer'
): Promise<void> {
  await prisma.wallet.update({
    where: { id: walletId },
    data: {
      groupId: groupId || null,
      groupRole: groupId ? groupRole : 'viewer',
    },
  });
  // Invalidate cache for this wallet (group access changed)
  await invalidateWalletAccessCache(walletId);
}

/**
 * Update wallet's group assignment and return wallet with group info
 */
export async function updateWalletGroupWithResult(
  walletId: string,
  groupId: string | null,
  groupRole: string = 'viewer'
) {
  const wallet = await prisma.wallet.update({
    where: { id: walletId },
    data: {
      groupId: groupId || null,
      groupRole: groupId ? groupRole : 'viewer',
    },
    include: {
      group: true,
    },
  });
  // Invalidate cache for this wallet (group access changed)
  await invalidateWalletAccessCache(walletId);
  return wallet;
}

/**
 * Get wallet with sharing info
 */
export async function getWalletSharingInfo(walletId: string) {
  return prisma.wallet.findUnique({
    where: { id: walletId },
    include: {
      group: true,
      users: {
        include: {
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      },
    },
  });
}

/**
 * Find wallet IDs where a user has specific roles
 */
export async function findWalletIdsByUserRole(
  userId: string,
  roles: string[]
): Promise<string[]> {
  const walletUsers = await prisma.walletUser.findMany({
    where: {
      userId,
      role: { in: roles },
    },
    select: { walletId: true },
  });
  return walletUsers.map(wu => wu.walletId);
}

/**
 * Find all wallet users with their user preferences
 * Used by notification services (AI insights, etc.)
 */
export async function findWalletUsersWithPreferences(walletId: string) {
  return prisma.walletUser.findMany({
    where: { walletId },
    include: {
      user: {
        select: { id: true, preferences: true },
      },
    },
  });
}

/**
 * Find all wallet users with username info
 * Used by mobile permission service
 */
export async function findWalletUsersWithUsername(walletId: string) {
  return prisma.walletUser.findMany({
    where: { walletId },
    include: {
      user: {
        select: { id: true, username: true },
      },
    },
  });
}

/**
 * Find a wallet user by composite key (walletId + userId)
 * Returns role info for permission checks
 */
export async function findWalletUserByCompositeKey(
  walletId: string,
  userId: string
) {
  return prisma.walletUser.findUnique({
    where: {
      walletId_userId: { walletId, userId },
    },
    select: { role: true },
  });
}

// Export as namespace
export const walletSharingRepository = {
  findWalletUser,
  addUserToWallet,
  updateUserRole,
  removeUserFromWallet,
  isGroupMember,
  getGroupMember,
  updateWalletGroup,
  updateWalletGroupWithResult,
  getWalletSharingInfo,
  findWalletIdsByUserRole,
  findWalletUsersWithPreferences,
  findWalletUsersWithUsername,
  findWalletUserByCompositeKey,
};

export default walletSharingRepository;
