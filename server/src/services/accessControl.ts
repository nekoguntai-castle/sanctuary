/**
 * Access Control Service
 *
 * Centralized access control checks for all resources.
 * Provides consistent authorization patterns across the application.
 */

import { db as prisma } from '../repositories/db';
import { NotFoundError, ForbiddenError, WalletNotFoundError } from '../errors';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { getNamespacedCache } from '../infrastructure/redis';
import type { ICacheService } from './cache/cacheService';

const log = createLogger('ACCESS_CONTROL:SVC');

// Roles that can edit wallet data (labels, memos, etc.)
const EDIT_ROLES = ['owner', 'signer'];

// Roles that can approve transactions
const APPROVE_ROLES = ['owner', 'approver'];

/**
 * Cache TTL for wallet access checks (30 seconds - short for security)
 */
const ACCESS_CACHE_TTL_SECONDS = 30;

/**
 * Get the access control cache instance
 * Uses Redis when available, falls back to in-memory
 */
function getAccessCache(): ICacheService {
  return getNamespacedCache('access');
}

/**
 * Clear access cache for a specific wallet (call when roles change)
 */
export async function invalidateWalletAccessCache(walletId: string): Promise<void> {
  try {
    const cache = getAccessCache();
    await cache.deletePattern(`*:${walletId}`);
    log.debug('Invalidated access cache for wallet', { walletId: walletId.substring(0, 8) });
  } catch (error) {
    log.warn('Failed to invalidate wallet access cache', { walletId, error: getErrorMessage(error) });
  }
}

/**
 * Clear access cache for a specific user (call when user leaves group, etc.)
 */
export async function invalidateUserAccessCache(userId: string): Promise<void> {
  try {
    const cache = getAccessCache();
    await cache.deletePattern(`${userId}:*`);
    log.debug('Invalidated access cache for user', { userId: userId.substring(0, 8) });
  } catch (error) {
    log.warn('Failed to invalidate user access cache', { userId, error: getErrorMessage(error) });
  }
}

/**
 * Clear entire access cache (for admin operations)
 */
export async function clearAccessCache(): Promise<void> {
  try {
    const cache = getAccessCache();
    await cache.clear();
    log.info('Cleared entire access cache');
  } catch (error) {
    log.warn('Failed to clear access cache', { error: getErrorMessage(error) });
  }
}

export type WalletRole = 'owner' | 'approver' | 'signer' | 'viewer' | null;

/**
 * Access check result for a wallet
 */
export interface WalletAccessResult {
  hasAccess: boolean;
  canEdit: boolean;
  role: WalletRole;
}

/**
 * Resource context for access checks
 */
export interface ResourceContext {
  walletId: string;
  role: WalletRole;
  canEdit: boolean;
}

/**
 * Build Prisma WHERE clause for wallet access via user or group
 */
export function buildWalletAccessWhere(userId: string) {
  return {
    OR: [
      { users: { some: { userId } } },
      { group: { members: { some: { userId } } } },
    ],
  };
}

/**
 * Cache entry wrapper to distinguish "no access" from "cache miss"
 */
interface CachedRole {
  role: WalletRole;
}

/**
 * Get user's role for a specific wallet
 * Returns the highest privilege role if user has multiple access paths
 * Uses distributed cache (Redis or in-memory fallback) with 30s TTL
 */
export async function getUserWalletRole(walletId: string, userId: string): Promise<WalletRole> {
  const cacheKey = `${userId}:${walletId}`;
  const cache = getAccessCache();

  // Check cache first
  try {
    const cached = await cache.get<CachedRole>(cacheKey);
    if (cached !== null && typeof cached === 'object' && 'role' in cached) {
      return cached.role;
    }
  } catch {
    // Cache miss or error, continue to DB
  }

  // Check direct user access first
  const walletUser = await prisma.walletUser.findFirst({
    where: { walletId, userId },
  });

  let role: WalletRole = null;

  if (walletUser) {
    role = walletUser.role as WalletRole;
  } else {
    // Check group access
    const wallet = await prisma.wallet.findFirst({
      where: {
        id: walletId,
        group: { members: { some: { userId } } },
      },
      select: { groupRole: true },
    });

    if (wallet) {
      role = wallet.groupRole as WalletRole;
    }
  }

  // Cache the result (including null for no access)
  // Wrap in object to distinguish from cache miss
  try {
    await cache.set<CachedRole>(cacheKey, { role }, ACCESS_CACHE_TTL_SECONDS);
  } catch {
    // Cache set failed, continue without caching
  }

  return role;
}

/**
 * Check wallet access and return detailed result
 */
export async function checkWalletAccess(walletId: string, userId: string): Promise<WalletAccessResult> {
  const role = await getUserWalletRole(walletId, userId);
  return {
    hasAccess: role !== null,
    canEdit: role !== null && EDIT_ROLES.includes(role),
    role,
  };
}

/**
 * Require wallet access - throws if no access
 */
export async function requireWalletAccess(walletId: string, userId: string): Promise<ResourceContext> {
  const access = await checkWalletAccess(walletId, userId);
  if (!access.hasAccess) {
    throw new WalletNotFoundError(walletId);
  }
  return {
    walletId,
    role: access.role,
    canEdit: access.canEdit,
  };
}

/**
 * Require wallet edit access - throws if cannot edit
 */
export async function requireWalletEditAccess(walletId: string, userId: string): Promise<ResourceContext> {
  const access = await checkWalletAccess(walletId, userId);
  if (!access.hasAccess) {
    throw new WalletNotFoundError(walletId);
  }
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to edit this wallet');
  }
  return {
    walletId,
    role: access.role,
    canEdit: true,
  };
}

/**
 * Require wallet owner access - throws if not owner
 */
export async function requireWalletOwnerAccess(walletId: string, userId: string): Promise<ResourceContext> {
  const access = await checkWalletAccess(walletId, userId);
  if (!access.hasAccess) {
    throw new WalletNotFoundError(walletId);
  }
  if (access.role !== 'owner') {
    throw new ForbiddenError('Only the wallet owner can perform this action');
  }
  return {
    walletId,
    role: 'owner',
    canEdit: true,
  };
}

/**
 * Check if user has any access to wallet (boolean convenience function)
 */
export async function hasWalletAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null;
}

/**
 * Check if user has edit access to wallet (owner or signer roles)
 */
export async function checkWalletEditAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null && EDIT_ROLES.includes(role);
}

/**
 * Check if user is wallet owner
 */
export async function checkWalletOwnerAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role === 'owner';
}

/**
 * Check if user can approve transactions on a wallet (owner or approver roles)
 */
export async function checkWalletApproveAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null && APPROVE_ROLES.includes(role);
}

/**
 * Check transaction access via wallet
 */
export async function checkTransactionAccess(
  transactionId: string,
  userId: string
): Promise<{ hasAccess: boolean; canEdit: boolean; walletId: string | null }> {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      wallet: buildWalletAccessWhere(userId),
    },
    select: { walletId: true },
  });

  if (!transaction) {
    return { hasAccess: false, canEdit: false, walletId: null };
  }

  const access = await checkWalletAccess(transaction.walletId, userId);
  return {
    hasAccess: true,
    canEdit: access.canEdit,
    walletId: transaction.walletId,
  };
}

/**
 * Require transaction access - throws if no access
 */
export async function requireTransactionAccess(
  transactionId: string,
  userId: string
): Promise<{ walletId: string; canEdit: boolean }> {
  const access = await checkTransactionAccess(transactionId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Transaction not found');
  }
  return {
    walletId: access.walletId,
    canEdit: access.canEdit,
  };
}

/**
 * Require transaction edit access - throws if cannot edit
 */
export async function requireTransactionEditAccess(
  transactionId: string,
  userId: string
): Promise<{ walletId: string }> {
  const access = await checkTransactionAccess(transactionId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Transaction not found');
  }
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to edit this wallet');
  }
  return { walletId: access.walletId };
}

/**
 * Check address access via wallet
 */
export async function checkAddressAccess(
  addressId: string,
  userId: string
): Promise<{ hasAccess: boolean; canEdit: boolean; walletId: string | null }> {
  const address = await prisma.address.findFirst({
    where: {
      id: addressId,
      wallet: buildWalletAccessWhere(userId),
    },
    select: { walletId: true },
  });

  if (!address) {
    return { hasAccess: false, canEdit: false, walletId: null };
  }

  const access = await checkWalletAccess(address.walletId, userId);
  return {
    hasAccess: true,
    canEdit: access.canEdit,
    walletId: address.walletId,
  };
}

/**
 * Require address access - throws if no access
 */
export async function requireAddressAccess(
  addressId: string,
  userId: string
): Promise<{ walletId: string; canEdit: boolean }> {
  const access = await checkAddressAccess(addressId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Address not found');
  }
  return {
    walletId: access.walletId,
    canEdit: access.canEdit,
  };
}

/**
 * Require address edit access - throws if cannot edit
 */
export async function requireAddressEditAccess(
  addressId: string,
  userId: string
): Promise<{ walletId: string }> {
  const access = await checkAddressAccess(addressId, userId);
  if (!access.hasAccess || !access.walletId) {
    throw new NotFoundError('Address not found');
  }
  if (!access.canEdit) {
    throw new ForbiddenError('You do not have permission to edit this wallet');
  }
  return { walletId: access.walletId };
}

// Export as namespace
export const accessControlService = {
  buildWalletAccessWhere,
  getUserWalletRole,
  hasWalletAccess,
  checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletApproveAccess,
  requireWalletAccess,
  requireWalletEditAccess,
  requireWalletOwnerAccess,
  checkTransactionAccess,
  requireTransactionAccess,
  requireTransactionEditAccess,
  checkAddressAccess,
  requireAddressAccess,
  requireAddressEditAccess,
  // Cache management
  invalidateWalletAccessCache,
  invalidateUserAccessCache,
  clearAccessCache,
};

export default accessControlService;
