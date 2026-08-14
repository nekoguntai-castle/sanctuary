import { Prisma } from '../generated/prisma/client';
import prisma from '../models/prisma';
import { ConflictError, NotFoundError } from '../errors';
import { isSerializableTransactionConflict } from '../utils/prismaSerializableConflict';

const MAX_ADMIN_FLOOR_ATTEMPTS = 3;

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
