/**
 * Wallet Access Control
 *
 * Role checking and permission validation for wallet operations.
 */

import { db as prisma } from '../../repositories/db';
import type { WalletRole, WalletAccessCheckResult } from './types';

// Roles that can edit wallet data (labels, etc.)
const EDIT_ROLES = ['owner', 'signer'];

/**
 * Get user's role for a specific wallet
 * Returns the highest privilege role if user has multiple access paths
 */
export async function getUserWalletRole(walletId: string, userId: string): Promise<WalletRole> {
  // Check direct user access first
  const walletUser = await prisma.walletUser.findFirst({
    where: { walletId, userId },
  });

  if (walletUser) {
    return walletUser.role as WalletRole;
  }

  // Check group access
  const wallet = await prisma.wallet.findFirst({
    where: {
      id: walletId,
      group: { members: { some: { userId } } },
    },
    select: { groupRole: true },
  });

  if (wallet) {
    return wallet.groupRole as WalletRole;
  }

  return null;
}

/**
 * Check if user has any access to wallet (for read operations)
 */
export async function checkWalletAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null;
}

/**
 * Check if user has edit access to wallet (owner or signer roles)
 * Use this for operations that modify labels, memos, etc.
 */
export async function checkWalletEditAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role !== null && EDIT_ROLES.includes(role);
}

/**
 * Check if user is wallet owner
 * Use this for operations like sharing, deleting wallet
 */
export async function checkWalletOwnerAccess(walletId: string, userId: string): Promise<boolean> {
  const role = await getUserWalletRole(walletId, userId);
  return role === 'owner';
}

/**
 * Check wallet access and edit permission in a single query
 * Use this to avoid N+1 queries when checking both access and edit permission
 *
 * Returns: { hasAccess, canEdit, role }
 * - hasAccess: true if user can view the wallet
 * - canEdit: true if user can modify the wallet (owner or signer)
 * - role: the user's role ('owner' | 'signer' | 'viewer' | null)
 */
export async function checkWalletAccessWithRole(walletId: string, userId: string): Promise<WalletAccessCheckResult> {
  const role = await getUserWalletRole(walletId, userId);
  return {
    hasAccess: role !== null,
    canEdit: role !== null && EDIT_ROLES.includes(role),
    role,
  };
}
