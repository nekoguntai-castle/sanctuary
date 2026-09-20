/**
 * Repository Access Control Helpers
 *
 * Shared utilities for building access control queries across repositories.
 * Used by wallets, devices, and other entities that support user and group access.
 */

import type { Prisma } from '../generated/prisma/client';
import { WALLET_EDIT_ROLE_VALUES } from '@sanctuary/shared/constants/walletRoles';

/**
 * Build the access control WHERE clause for wallet queries.
 * Checks if user has direct access or via group membership.
 *
 * @example
 * // Use in wallet queries
 * const wallets = await prisma.wallet.findMany({
 *   where: buildWalletAccessWhere(userId),
 * });
 *
 * // Combine with other conditions
 * const wallet = await prisma.wallet.findFirst({
 *   where: {
 *     id: walletId,
 *     ...buildWalletAccessWhere(userId),
 *   },
 * });
 */
export function buildWalletAccessWhere(userId: string): Prisma.WalletWhereInput {
  return {
    OR: [
      { users: { some: { userId } } },
      { group: { members: { some: { userId } } } },
    ],
  };
}

/**
 * Build the WHERE clause for wallets where the user has edit-or-above
 * (owner/signer) access. A direct wallet role takes precedence over the
 * group role, including when the direct role is view-only. Used to scope
 * destructive batch operations (e.g. network resync) away from view-only wallets.
 */
export function buildWalletEditAccessWhere(userId: string): Prisma.WalletWhereInput {
  return {
    OR: [
      { users: { some: { userId, role: { in: [...WALLET_EDIT_ROLE_VALUES] } } } },
      {
        // Any direct grant suppresses the group role, even a viewer grant.
        users: { none: { userId } },
        group: { members: { some: { userId } } },
        groupRole: { in: [...WALLET_EDIT_ROLE_VALUES] },
      },
    ],
  };
}

/**
 * Build the access control WHERE clause for device queries.
 * Checks if user owns the device, has shared access via DeviceUser,
 * or has access via a shared wallet.
 */
export function buildDeviceAccessWhere(userId: string): Prisma.DeviceWhereInput {
  return {
    OR: [
      { userId }, // Device owner
      { users: { some: { userId } } }, // Shared access via DeviceUser
      { group: { members: { some: { userId } } } }, // Group access
      {
        wallets: {
          some: {
            wallet: {
              OR: [
                { users: { some: { userId } } },
                { group: { members: { some: { userId } } } },
              ],
            },
          },
        },
      },
    ],
  };
}
