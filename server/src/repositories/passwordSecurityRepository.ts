/**
 * Password Security Repository
 *
 * Owns the atomic credential and session invalidation boundary.
 */

import prisma from '../models/prisma';
import { ConflictError, NotFoundError } from '../errors';

export interface PasswordSecurityMutationResult {
  sessionVersion: number;
  revokedRefreshTokenCount: number;
}

/**
 * Replace a verified password and invalidate every existing session as one
 * compare-and-swap transaction. Matching the exact hash observed by the route
 * prevents a stale concurrent password-change request from overwriting the
 * winner after both requests verified the same old credential.
 */
export async function changePasswordAndRevokeSessions(
  id: string,
  expectedPasswordHash: string,
  newPasswordHash: string,
): Promise<PasswordSecurityMutationResult> {
  return prisma.$transaction(async (tx) => {
    const passwordUpdate = await tx.user.updateMany({
      where: { id, password: expectedPasswordHash },
      data: {
        password: newPasswordHash,
        sessionVersion: { increment: 1 },
      },
    });
    if (passwordUpdate.count !== 1) {
      throw new ConflictError('Password changed concurrently; please retry');
    }

    const updatedUser = await tx.user.findUnique({
      where: { id },
      select: { sessionVersion: true },
    });
    if (!updatedUser) throw new NotFoundError('User not found');

    const revokedTokens = await tx.refreshToken.deleteMany({ where: { userId: id } });
    return {
      sessionVersion: updatedUser.sessionVersion,
      revokedRefreshTokenCount: revokedTokens.count,
    };
  });
}

export const passwordSecurityRepository = {
  changePasswordAndRevokeSessions,
};

export default passwordSecurityRepository;
