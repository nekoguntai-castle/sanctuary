/**
 * User Repository
 *
 * Abstracts database operations for users.
 */

import prisma from '../models/prisma';
import { Prisma } from '../generated/prisma/client';
import type { User } from '../generated/prisma/client';
import { ConflictError, NotFoundError } from '../errors';
import { normalizeEmail } from '../utils/email';
import { normalizeUsername } from '../utils/username';
import { isSerializableTransactionConflict } from '../utils/prismaSerializableConflict';
import {
  executeAdminUserDelete,
  executeAdminUserUpdate,
  type AdminUserUpdateData,
} from './userAdminUpdate';

export type {
  AdminUpdateTransitions,
  AdminUserUpdateData,
} from './userAdminUpdate';

const MAX_PREFERENCE_UPDATE_ATTEMPTS = 3;
const PREFERENCE_USER_SELECT = {
  id: true,
  username: true,
  email: true,
  isAdmin: true,
  preferences: true,
  twoFactorEnabled: true,
  createdAt: true,
} as const;

export interface PreferenceUpdate<T> {
  preferences: Prisma.InputJsonValue;
  result: T;
}

export type PreferenceUpdater<T> = (current: unknown) => PreferenceUpdate<T>;

/**
 * Find user by ID
 */
export async function findById(id: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { id },
  });
}

/**
 * Find user by ID with select
 */
export async function findByIdWithSelect<T extends Prisma.UserSelect>(
  id: string,
  select: T
) {
  return prisma.user.findUnique({
    where: { id },
    select,
  });
}

/**
 * Find user by username
 */
export async function findByUsername(username: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { username: normalizeUsername(username) },
  });
}

/**
 * Find user by email
 */
export async function findByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });
}

/**
 * Find all users with summary fields (admin)
 */
export async function findAllSummary() {
  return prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      isAdmin: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find user by ID with profile fields (includes password for verification)
 */
export async function findByIdWithProfile(id: string) {
  return prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      username: true,
      email: true,
      isAdmin: true,
      preferences: true,
      createdAt: true,
      twoFactorEnabled: true,
      password: true,
    },
  });
}

/**
 * Check if user exists
 */
export async function exists(id: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { id },
  });
  return count > 0;
}

/**
 * Create a new user
 */
export async function create(data: Prisma.UserCreateInput): Promise<User> {
  return prisma.user.create({ data });
}

/**
 * Create a new user with select
 */
export async function createWithSelect<T extends Prisma.UserSelect>(
  data: Prisma.UserCreateInput,
  select: T
) {
  return prisma.user.create({ data, select });
}

/**
 * Update a user
 */
export async function update(
  id: string,
  data: Prisma.UserUpdateInput
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data,
  });
}

/**
 * Update a user with select
 */
export async function updateWithSelect<T extends Prisma.UserSelect>(
  id: string,
  data: Prisma.UserUpdateInput,
  select: T
) {
  return prisma.user.update({
    where: { id },
    data,
    select,
  });
}

/**
 * Apply an admin-initiated user update. Role-bearing updates use a serializable
 * transaction so concurrent demotions cannot commit a zero-admin state.
 */
export async function updateFromAdmin<T extends Prisma.UserSelect>(
  id: string,
  data: AdminUserUpdateData,
  select: T,
) {
  return executeAdminUserUpdate(id, data, select);
}

/**
 * Advance a user's session version to invalidate existing access and refresh JWTs.
 */
export async function incrementSessionVersion(id: string): Promise<number> {
  const user = await prisma.user.update({
    where: { id },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return user.sessionVersion;
}

/**
 * Delete a user by ID
 */
export async function deleteById(id: string): Promise<void> {
  await prisma.user.delete({
    where: { id },
  });
}

/** Delete a user without allowing the administrator set to reach zero. */
export async function deleteFromAdmin(id: string) {
  return executeAdminUserDelete(id);
}

/**
 * Update email verification status
 */
export async function updateEmailVerification(
  id: string,
  verified: boolean
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      emailVerified: verified,
      emailVerifiedAt: verified ? new Date() : null,
    },
  });
}

/**
 * Update user email (triggers need for re-verification)
 */
export async function updateEmail(
  id: string,
  email: string
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data: {
      email: normalizeEmail(email),
      emailVerified: false,
      emailVerifiedAt: null,
    },
  });
}

async function attemptPreferenceUpdate<T>(
  id: string,
  updater: PreferenceUpdater<T>,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id },
      select: { preferences: true },
    });
    if (!current) throw new NotFoundError('User not found');

    const update = updater(current.preferences);
    const user = await tx.user.update({
      where: { id },
      data: { preferences: update.preferences },
      select: PREFERENCE_USER_SELECT,
    });
    return { user, result: update.result };
  }, { isolationLevel: 'Serializable' });
}

/**
 * Atomically reread and replace a user's preference document. The updater is
 * pure and reruns against a fresh document after serialization conflicts.
 */
export async function updatePreferencesAtomically<T>(
  id: string,
  updater: PreferenceUpdater<T>,
) {
  for (let attempt = 1; attempt <= MAX_PREFERENCE_UPDATE_ATTEMPTS; attempt += 1) {
    try {
      return await attemptPreferenceUpdate(id, updater);
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt === MAX_PREFERENCE_UPDATE_ATTEMPTS) {
        throw new ConflictError('Preferences changed concurrently; please retry');
      }
    }
  }

  /* v8 ignore next -- every loop path returns or throws */
  throw new ConflictError('Preferences changed concurrently; please retry');
}

/**
 * Search users by username (case-insensitive, limited results)
 */
export async function searchByUsername(query: string, take = 10) {
  return prisma.user.findMany({
    where: {
      username: {
        contains: query,
        mode: 'insensitive',
      },
    },
    select: {
      id: true,
      username: true,
    },
    take,
  });
}

/**
 * Update 2FA settings
 */
export async function update2FA(
  id: string,
  data: { twoFactorEnabled: boolean; twoFactorSecret?: string | null }
): Promise<User> {
  return prisma.user.update({
    where: { id },
    data,
  });
}

/**
 * Consume a 2FA backup-code JSON update only if it still matches the value that
 * was verified. This prevents concurrent requests from reusing the same
 * one-time backup code after both pass bcrypt comparison against the same
 * pre-update JSON.
 */
export async function consumeBackupCodesIfUnchanged(
  id: string,
  expectedBackupCodesJson: string,
  updatedBackupCodesJson: string
): Promise<boolean> {
  const result = await prisma.user.updateMany({
    where: {
      id,
      twoFactorEnabled: true,
      twoFactorSecret: { not: null },
      twoFactorBackupCodes: expectedBackupCodesJson,
    },
    data: {
      twoFactorBackupCodes: updatedBackupCodesJson,
    },
  });
  return result.count === 1;
}

/**
 * Check if email is already in use
 */
export async function emailExists(email: string): Promise<boolean> {
  const count = await prisma.user.count({
    where: { email: normalizeEmail(email) },
  });
  return count > 0;
}

/**
 * Find all users with access to a wallet (direct or via group)
 * with preferences included. Used by notification services.
 */
export async function findByWalletAccess(
  walletId: string,
  options?: { includePushDeviceCount?: boolean; walletRoles?: string[] }
) {
  /* v8 ignore start -- wallet-role filters are covered by route/service level authorization tests */
  const walletRoleFilter = options?.walletRoles?.length
    ? { role: { in: options.walletRoles } }
    : {};
  const groupWalletRoleFilter = options?.walletRoles?.length
    ? { groupRole: { in: options.walletRoles } }
    : {};
  /* v8 ignore stop */

  return prisma.user.findMany({
    where: {
      OR: [
        { wallets: { some: { walletId, ...walletRoleFilter } } },
        { groupMemberships: { some: { group: { wallets: { some: { id: walletId, ...groupWalletRoleFilter } } } } } },
      ],
    },
    select: {
      id: true,
      username: true,
      preferences: true,
      ...(options?.includePushDeviceCount
        ? { _count: { select: { pushDevices: true } } }
        : {}),
    },
  });
}

/**
 * Find all users with their wallet associations and preferences.
 * Used by intelligence/autopilot settings scan.
 */
export async function findAllWithWalletAssociations() {
  return prisma.user.findMany({
    select: {
      id: true,
      preferences: true,
      wallets: {
        select: {
          wallet: { select: { id: true, name: true } },
        },
      },
      groupMemberships: {
        select: {
          group: {
            select: {
              wallets: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Find all users with autopilot preferences set, including wallet and group memberships.
 * Used by autopilot settings scan.
 */
export async function findWithAutopilotPreferences() {
  return prisma.user.findMany({
    where: {
      preferences: {
        path: ['autopilot'],
        not: Prisma.DbNull,
      },
    },
    select: {
      id: true,
      preferences: true,
      wallets: {
        select: {
          wallet: { select: { id: true, name: true } },
        },
      },
      groupMemberships: {
        select: {
          group: {
            select: {
              wallets: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
}

/**
 * Find all users with a custom select shape.
 */
export async function findAllWithSelect<T extends Prisma.UserSelect>(
  select: T,
  where?: Prisma.UserWhereInput,
) {
  return prisma.user.findMany({ where, select });
}

// Export as namespace
export const userRepository = {
  findById,
  findByIdWithSelect,
  findByUsername,
  findByEmail,
  findAllSummary,
  findByIdWithProfile,
  exists,
  create,
  createWithSelect,
  update,
  updateWithSelect,
  updateFromAdmin,
  incrementSessionVersion,
  deleteById,
  deleteFromAdmin,
  updateEmailVerification,
  updateEmail,
  updatePreferencesAtomically,
  searchByUsername,
  update2FA,
  consumeBackupCodesIfUnchanged,
  emailExists,
  findByWalletAccess,
  findAllWithWalletAssociations,
  findAllWithSelect,
  findWithAutopilotPreferences,
};

export default userRepository;
