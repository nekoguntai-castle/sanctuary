import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import { ConflictError, NotFoundError } from '../errors';
import { isSerializableTransactionConflict } from '../utils/prismaSerializableConflict';

const MAX_ADMIN_FLOOR_ATTEMPTS = 3;

type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export interface AdminUpdateTransitions {
  adminRoleChanged: boolean;
  passwordChanged: boolean;
}

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

    const user = await tx.user.update({
      where: { id },
      data: data as Prisma.UserUpdateInput,
      select,
    });
    return { user, transitions };
  }, { isolationLevel: 'Serializable' });
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

  const user = await prisma.user.update({
    where: { id },
    data: data as Prisma.UserUpdateInput,
    select,
  });
  return {
    user,
    transitions: getAdminUpdateTransitions(false, data),
  };
}

export async function executeAdminUserDelete(id: string) {
  return executeWithAdminFloorRetry(() => attemptAdminUserDelete(id));
}
