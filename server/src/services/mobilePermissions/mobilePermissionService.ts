/**
 * Mobile Permission Service
 *
 * Manages mobile permissions for wallet access.
 * Mobile permissions act as ADDITIONAL RESTRICTIONS on top of wallet roles.
 *
 * ## Permission Resolution Logic
 *
 * Effective permission = MIN(walletRole, mobilePermission, ownerMax)
 *
 * 1. If the wallet role doesn't allow the action, deny.
 * 2. If no mobile permission record exists, use role maximum.
 * 3. If owner has set a maximum, apply it.
 * 4. Apply user's self-set restrictions.
 *
 * ## Usage
 *
 * ```typescript
 * const service = mobilePermissionService;
 *
 * // Check if action is allowed
 * const allowed = await service.canPerformAction(walletId, userId, 'createTransaction');
 *
 * // Get effective permissions
 * const permissions = await service.getEffectivePermissions(walletId, userId);
 *
 * // Update own permissions
 * await service.updateOwnPermissions(walletId, userId, { createTransaction: false });
 *
 * // Set max permissions for a user (owner only)
 * await service.setMaxPermissions(walletId, targetUserId, ownerId, { broadcast: false });
 * ```
 */

import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { ForbiddenError, NotFoundError } from '../../errors';
import { mobilePermissionRepository } from '../../repositories';
import type { MobilePermission } from '../../generated/prisma/client';
import {
  type MobileAction,
  type WalletRole,
  type EffectivePermissions,
  type UpdatePermissionsInput,
  type OwnerMaxPermissionsInput,
  ROLE_CAPABILITIES,
  ACTION_TO_FIELD,
  ALL_MOBILE_ACTIONS,
} from './types';

const log = createLogger('MOBILE_PERM:SVC');

// =============================================================================
// Permission Resolution
// =============================================================================

/**
 * Get the field value from a mobile permission record
 */
function getPermissionField(
  permission: MobilePermission,
  action: MobileAction
): boolean {
  const field = ACTION_TO_FIELD[action] as keyof MobilePermission;
  return permission[field] as boolean;
}

/**
 * Get owner max permission for an action
 */
function getOwnerMax(
  permission: MobilePermission | null,
  action: MobileAction
): boolean {
  if (!permission?.ownerMaxPermissions) return true;

  const maxPermissions = permission.ownerMaxPermissions as Record<string, boolean>;
  return maxPermissions[action] ?? true;
}

/**
 * Calculate effective permission for a single action
 *
 * @param role - User's wallet role
 * @param permission - Mobile permission record (if exists)
 * @param action - Action to check
 * @returns Whether the action is allowed
 */
function calculateEffectivePermission(
  role: WalletRole,
  permission: MobilePermission | null,
  action: MobileAction
): boolean {
  // 1. Check role capability (hard limit)
  const roleMax = ROLE_CAPABILITIES[role][action];
  if (!roleMax) return false;

  // 2. No permission record = use role maximum
  if (!permission) return roleMax;

  // 3. Check owner-set maximum
  const ownerMax = getOwnerMax(permission, action);
  if (!ownerMax) return false;

  // 4. Check user's self-set permission
  const userPermission = getPermissionField(permission, action);
  return userPermission && ownerMax;
}

/**
 * Calculate all effective permissions for a user on a wallet
 */
function calculateAllEffectivePermissions(
  role: WalletRole,
  permission: MobilePermission | null
): Record<MobileAction, boolean> {
  const result: Record<MobileAction, boolean> = {} as Record<MobileAction, boolean>;

  for (const action of ALL_MOBILE_ACTIONS) {
    result[action] = calculateEffectivePermission(role, permission, action);
  }

  return result;
}

// =============================================================================
// Service Class
// =============================================================================

class MobilePermissionService {
  /**
   * Check if a user can perform a specific action on a wallet via mobile
   */
  async canPerformAction(
    walletId: string,
    userId: string,
    action: MobileAction
  ): Promise<boolean> {
    // Get user's wallet role
    const role = await this.getWalletRole(walletId, userId);
    if (!role) return false;

    // Get mobile permission record
    const permission = await mobilePermissionRepository.findByWalletAndUser(walletId, userId);

    return calculateEffectivePermission(role, permission, action);
  }

  /**
   * Check action and throw if denied
   */
  async assertCanPerformAction(
    walletId: string,
    userId: string,
    action: MobileAction
  ): Promise<void> {
    const allowed = await this.canPerformAction(walletId, userId, action);
    if (!allowed) {
      throw new ForbiddenError(`Mobile access denied for action: ${action}`, undefined, {
        walletId,
        userId,
        action,
      });
    }
  }

  /**
   * Get effective permissions for a user on a wallet
   */
  async getEffectivePermissions(walletId: string, userId: string): Promise<EffectivePermissions> {
    // Get user's wallet role
    const role = await this.getWalletRole(walletId, userId);
    if (!role) {
      throw new ForbiddenError('User does not have access to this wallet', undefined, {
        walletId,
        userId,
      });
    }

    // Get mobile permission record
    const permission = await mobilePermissionRepository.findByWalletAndUser(walletId, userId);

    // Calculate effective permissions
    const permissions = calculateAllEffectivePermissions(role, permission);

    // Determine if there are custom restrictions
    const hasCustomRestrictions = permission !== null;
    const hasOwnerRestrictions = permission?.ownerMaxPermissions != null;

    return {
      walletId,
      userId,
      role,
      permissions,
      hasCustomRestrictions,
      hasOwnerRestrictions,
    };
  }

  /**
   * Get all mobile permissions for a user with wallet details
   * Optimized: includes wallet role in initial query to avoid N+1
   */
  async getUserMobilePermissions(userId: string) {
    const permissions = await mobilePermissionRepository.findByUserIdWithWallet(userId);

    // Calculate effective permissions - role is now included in the query
    const results = permissions.map((perm) => {
      // Extract role from the included users relation
      const role = perm.wallet.users[0]?.role as WalletRole | undefined;
      const effectivePermissions = calculateAllEffectivePermissions(
        role || 'viewer',
        perm
      );

      // Remove the nested users from the response
      const { users, ...walletData } = perm.wallet;

      return {
        ...perm,
        wallet: walletData,
        role,
        effectivePermissions,
      };
    });

    return results;
  }

  /**
   * Update a user's own mobile permissions
   * Users can only restrict their own permissions, not grant more than role allows
   */
  async updateOwnPermissions(
    walletId: string,
    userId: string,
    input: UpdatePermissionsInput,
    modifiedBy?: string
  ): Promise<EffectivePermissions> {
    // Verify user has access to wallet
    const role = await this.getWalletRole(walletId, userId);
    if (!role) {
      throw new ForbiddenError('User does not have access to this wallet');
    }

    // Get existing permission record
    const existing = await mobilePermissionRepository.findByWalletAndUser(walletId, userId);

    // Build update data
    const updateData: Record<string, boolean | string | null> = {};
    for (const [action, value] of Object.entries(input)) {
      if (value !== undefined) {
        const field = ACTION_TO_FIELD[action as MobileAction];
        updateData[field] = value;
      }
    }

    // If there's owner max permissions, validate we're not exceeding them
    if (existing?.ownerMaxPermissions) {
      const maxPerms = existing.ownerMaxPermissions as Record<string, boolean>;
      for (const [action, value] of Object.entries(input)) {
        if (value === true && maxPerms[action] === false) {
          throw new ForbiddenError(
            `Cannot enable ${action}: owner has restricted this permission`,
            undefined,
            { action }
          );
        }
      }
    }

    // Upsert permission record
    await mobilePermissionRepository.upsert(walletId, userId, {
      ...updateData,
      lastModifiedBy: modifiedBy || userId,
    });

    log.info('Updated mobile permissions', { walletId, userId, changes: Object.keys(input) });

    return this.getEffectivePermissions(walletId, userId);
  }

  /**
   * Set maximum permissions for a user (owner only)
   * This restricts what actions a user can perform even if they try to enable them
   */
  async setMaxPermissions(
    walletId: string,
    targetUserId: string,
    ownerUserId: string,
    maxPermissions: OwnerMaxPermissionsInput
  ): Promise<EffectivePermissions> {
    // Verify caller is owner
    const ownerRole = await this.getWalletRole(walletId, ownerUserId);
    if (ownerRole !== 'owner') {
      throw new ForbiddenError('Only wallet owners can set permission caps');
    }

    // Verify target user has access to wallet
    const targetRole = await this.getWalletRole(walletId, targetUserId);
    if (!targetRole) {
      throw new ForbiddenError('Target user does not have access to this wallet');
    }

    // Cannot set restrictions on owner
    if (targetRole === 'owner') {
      throw new ForbiddenError('Cannot set permission restrictions on wallet owners');
    }

    // Upsert permission record with owner max
    await mobilePermissionRepository.upsert(walletId, targetUserId, {
      ownerMaxPermissions: maxPermissions as Record<string, boolean>,
      lastModifiedBy: ownerUserId,
    });

    log.info('Set mobile permission caps', {
      walletId,
      targetUserId,
      ownerUserId,
      caps: Object.keys(maxPermissions),
    });

    return this.getEffectivePermissions(walletId, targetUserId);
  }

  /**
   * Clear owner-set maximum permissions
   */
  async clearMaxPermissions(
    walletId: string,
    targetUserId: string,
    ownerUserId: string
  ): Promise<EffectivePermissions> {
    // Verify caller is owner
    const ownerRole = await this.getWalletRole(walletId, ownerUserId);
    if (ownerRole !== 'owner') {
      throw new ForbiddenError('Only wallet owners can clear permission caps');
    }

    const existing = await mobilePermissionRepository.findByWalletAndUser(walletId, targetUserId);
    if (!existing) {
      throw new NotFoundError('No mobile permission record found for user');
    }

    await mobilePermissionRepository.updateByWalletAndUser(walletId, targetUserId, {
      ownerMaxPermissions: null,
      lastModifiedBy: ownerUserId,
    });

    log.info('Cleared mobile permission caps', { walletId, targetUserId, ownerUserId });

    return this.getEffectivePermissions(walletId, targetUserId);
  }

  /**
   * Reset all mobile permissions to defaults (all enabled)
   */
  async resetPermissions(walletId: string, userId: string): Promise<void> {
    await mobilePermissionRepository.deleteByWalletAndUser(walletId, userId);
    log.info('Reset mobile permissions to defaults', { walletId, userId });
  }

  /**
   * Get wallet permissions for all users in a wallet
   * Optimized: batch fetches all permissions to avoid N+1 queries
   */
  async getWalletPermissions(walletId: string, requesterId: string) {
    // Verify requester has access
    const requesterRole = await this.getWalletRole(walletId, requesterId);
    if (!requesterRole) {
      throw new ForbiddenError('User does not have access to this wallet');
    }

    // Get all wallet users
    const walletUsers = await prisma.walletUser.findMany({
      where: { walletId },
      include: {
        user: {
          select: { id: true, username: true },
        },
      },
    });

    // Batch fetch all mobile permissions for this wallet's users
    const userIds = walletUsers.map((wu) => wu.userId);
    const permissionsMap = await mobilePermissionRepository.findByWalletIdAndUserIds(
      walletId,
      userIds
    );

    // Map results using the pre-fetched permissions
    const results = walletUsers.map((wu) => {
      const permission = permissionsMap.get(wu.userId) || null;
      const effectivePermissions = calculateAllEffectivePermissions(
        wu.role as WalletRole,
        permission
      );

      return {
        userId: wu.userId,
        username: wu.user.username,
        role: wu.role,
        effectivePermissions,
        hasCustomRestrictions: permission !== null,
        hasOwnerRestrictions: permission?.ownerMaxPermissions != null,
      };
    });

    return results;
  }

  // =============================================================================
  // Internal API for Gateway
  // =============================================================================

  /**
   * Check permission for gateway (returns simple boolean response)
   * Used by gateway to validate mobile requests
   */
  async checkForGateway(
    walletId: string,
    userId: string,
    action: MobileAction
  ): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const allowed = await this.canPerformAction(walletId, userId, action);
      return {
        allowed,
        reason: allowed ? undefined : `Mobile access denied for action: ${action}`,
      };
    } catch (error) {
      log.error('Error checking mobile permission', { walletId, userId, action, error: getErrorMessage(error) });
      return { allowed: false, reason: 'Permission check failed' };
    }
  }

  // =============================================================================
  // Helper Methods
  // =============================================================================

  /**
   * Get user's role for a wallet
   */
  private async getWalletRole(walletId: string, userId: string): Promise<WalletRole | null> {
    const walletUser = await prisma.walletUser.findUnique({
      where: {
        walletId_userId: { walletId, userId },
      },
      select: { role: true },
    });

    if (!walletUser) return null;

    return walletUser.role as WalletRole;
  }
}

/**
 * Singleton service instance
 */
export const mobilePermissionService = new MobilePermissionService();

export default mobilePermissionService;
