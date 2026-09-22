import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import { ConflictError, NotFoundError } from '../errors';
import {
  getAdminSessionInvalidationReason,
  type AdminUpdateTransitions,
} from '../utils/adminSessionInvalidation';
import { isSerializableTransactionConflict } from '../utils/prismaSerializableConflict';

const MAX_ADMIN_FLOOR_ATTEMPTS = 3;

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export type AdminUserUpdateData = Record<string, unknown> & {
  isAdmin?: boolean;
};

function getAdminUpdateTransitions(
  currentIsAdmin: boolean,
  data: AdminUserUpdateData,
): AdminUpdateTransitions {
  return {
    adminRoleChanged:
      typeof data.isAdmin === 'boolean' && data.isAdmin !== currentIsAdmin,
    passwordChanged: 'password' in data,
  };
}

async function attemptAdminRoleUpdate<T extends Prisma.UserSelect>(
  id: string,
  data: AdminUserUpdateData,
  select: T,
) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id },
      select: { isAdmin: true },
    });
    if (!current) throw new NotFoundError('User not found');

    const adminCount = await tx.user.count({ where: { isAdmin: true } });
    const transitions = getAdminUpdateTransitions(current.isAdmin, data);
    if (
      transitions.adminRoleChanged
      && data.isAdmin === false
      && adminCount <= 1
    ) {
      throw new ConflictError('Cannot demote the final administrator');
    }

    const user = await updateUserAndInvalidateSessions(
      tx,
      id,
      data,
      select,
      transitions,
    );
    return { user, transitions };
  }, { isolationLevel: 'Serializable' });
}

async function updateUserAndInvalidateSessions<T extends Prisma.UserSelect>(
  tx: TxClient,
  id: string,
  data: AdminUserUpdateData,
  select: T,
  transitions: AdminUpdateTransitions,
) {
  // Credential or privilege changes and durable token invalidation must commit
  // together so no observer can authenticate against a partially applied state.
  // Access JWTs carry sessionVersion, and authentication rejects the old claim
  // after this increment; deleting refresh rows closes the renewal path.
  const invalidatesSessions = getAdminSessionInvalidationReason(transitions) !== null;
  const updateData = invalidatesSessions
    ? { ...data, sessionVersion: { increment: 1 } }
    : data;
  const user = await tx.user.update<{
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
    select: T;
  }>({
    where: { id },
    data: updateData as Prisma.UserUpdateInput,
    select,
  });
  if (invalidatesSessions) {
    // This is the transaction-scoped SEC-003 equivalent of
    // tokenRevocation.revokeAllUserTokens. Keep the sessionVersion increment
    // and refresh-token deletion contract aligned with that service; both
    // writes stay here so they commit with the admin security update.
    await tx.refreshToken.deleteMany({ where: { userId: id } });
  }
  return user;
}

async function attemptAdminSecurityUpdate<T extends Prisma.UserSelect>(
  id: string,
  data: AdminUserUpdateData,
  select: T,
  transitions: AdminUpdateTransitions,
) {
  // This path cannot change the administrator floor, so it needs atomicity but
  // not the Serializable isolation used by role-bearing updates.
  return prisma.$transaction(async (tx) => {
    const user = await updateUserAndInvalidateSessions(
      tx,
      id,
      data,
      select,
      transitions,
    );
    return { user, transitions };
  });
}

async function executeWithAdminFloorRetry<T>(
  operation: () => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ADMIN_FLOOR_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializableTransactionConflict(error)) throw error;
      if (attempt === MAX_ADMIN_FLOOR_ATTEMPTS) {
        throw new ConflictError(
          'Administrator roles changed concurrently; please retry',
        );
      }
    }
  }

  /* v8 ignore next -- every loop path returns or throws */
  throw new ConflictError('Administrator roles changed concurrently; please retry');
}

/**
 * Wallets have no owner/user column (only `groupRole`/`syncExecutionOwner`,
 * neither a user reference); the `WalletUser` row *is* the ownership link,
 * and it cascade-deletes with its user. For a non-group wallet, that cascade
 * on the user's sole membership would leave the wallet reachable by zero
 * users with no admin surface to reattach one, so those wallets are
 * reported here for the caller to refuse. Group-owned wallets are exempt:
 * the group, not a per-user membership, is the surface that reattaches
 * access, so losing one member's `WalletUser` row does not strand them.
 */
async function findSoleOwnedNonGroupWalletIds(
  tx: TxClient,
  userId: string,
): Promise<string[]> {
  const memberships = await tx.walletUser.findMany({
    where: { userId, wallet: { groupId: null } },
    select: {
      walletId: true,
      wallet: {
        select: {
          groupId: true,
          _count: { select: { users: true } },
        },
      },
    },
  });

  return memberships
    .filter((membership) => (
      membership.wallet.groupId === null && membership.wallet._count.users === 1
    ))
    .map((membership) => membership.walletId);
}

async function attemptAdminUserDelete(id: string) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.user.findUnique({
      where: { id },
      select: { id: true, username: true, isAdmin: true },
    });
    if (!current) throw new NotFoundError('User not found');

    const adminCount = await tx.user.count({ where: { isAdmin: true } });
    if (current.isAdmin && adminCount <= 1) {
      throw new ConflictError('Cannot delete the final administrator');
    }

    const strandedWalletIds = await findSoleOwnedNonGroupWalletIds(tx, id);
    if (strandedWalletIds.length > 0) {
      throw new ConflictError(
        `Cannot delete user: sole member of wallet(s) ${strandedWalletIds.join(', ')}; `
        + 'reassign or delete the wallet(s) first',
      );
    }

    await tx.user.delete({ where: { id } });
    return current;
  }, { isolationLevel: 'Serializable' });
}

/**
 * Commits the user update and durable access/refresh-token invalidation.
 * Callers use the returned transition metadata for post-commit transport
 * cleanup, which cannot participate in the database transaction.
 */
export async function executeAdminUserUpdate<T extends Prisma.UserSelect>(
  id: string,
  data: AdminUserUpdateData,
  select: T,
) {
  if ('isAdmin' in data) {
    return executeWithAdminFloorRetry(
      () => attemptAdminRoleUpdate(id, data, select),
    );
  }

  // With isAdmin absent, false is the complete role-transition baseline; this
  // also keeps every future invalidating transition on the atomic path below.
  const transitions = getAdminUpdateTransitions(false, data);
  if (getAdminSessionInvalidationReason(transitions) !== null) {
    return attemptAdminSecurityUpdate(id, data, select, transitions);
  }

  const user = await prisma.user.update<{
    where: Prisma.UserWhereUniqueInput;
    data: Prisma.UserUpdateInput;
    select: T;
  }>({
    where: { id },
    data: data as Prisma.UserUpdateInput,
    select,
  });
  return {
    user,
    transitions,
  };
}

export async function executeAdminUserDelete(id: string) {
  return executeWithAdminFloorRetry(() => attemptAdminUserDelete(id));
}
