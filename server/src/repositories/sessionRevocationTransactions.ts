import type { PrismaTxClient } from '../models/prisma';
import { lockRefreshSessionFamily } from './sessionFamilyLock';

export interface RevokedAccessTokenLineage {
  jti: string;
  expiresAt: Date;
}

interface LogoutCredentialsInput {
  userId: string;
  accessTokenJti: string;
  accessTokenExpiresAt: Date;
  refreshTokenHash?: string;
  refreshSessionFamilyId?: string;
  refreshTokenExpiresAt?: Date;
}

type LogoutCredentialsWithFamily = LogoutCredentialsInput & Required<Pick<
  LogoutCredentialsInput,
  'refreshTokenHash' | 'refreshSessionFamilyId' | 'refreshTokenExpiresAt'
>>;

function hasRefreshSessionFamily(
  input: LogoutCredentialsInput
): input is LogoutCredentialsWithFamily {
  return Boolean(
    input.refreshTokenHash
    && input.refreshSessionFamilyId
    && input.refreshTokenExpiresAt
  );
}

export async function revokeSessionByIdWithClient(
  tx: PrismaTxClient,
  sessionId: string,
  userId: string,
  revokedAt: Date
): Promise<RevokedAccessTokenLineage | null> {
  const session = await tx.refreshToken.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== userId) {
    return null;
  }

  await lockRefreshSessionFamily(tx, session.sessionFamilyId);
  const lockedSession = await tx.refreshToken.findUnique({ where: { id: sessionId } });
  if (!lockedSession || lockedSession.userId !== userId) {
    return null;
  }
  await tx.revokedRefreshSessionFamily.upsert({
    where: { sessionFamilyId: lockedSession.sessionFamilyId },
    update: {
      reason: 'session_revoked',
      revokedAt,
      expiresAt: lockedSession.expiresAt,
    },
    create: {
      sessionFamilyId: lockedSession.sessionFamilyId,
      userId,
      reason: 'session_revoked',
      expiresAt: lockedSession.expiresAt,
    },
  });
  const deleted = await tx.refreshToken.deleteMany({
    where: { sessionFamilyId: lockedSession.sessionFamilyId, userId },
  });
  if (deleted.count !== 1) {
    throw new Error('Refresh session family deletion invariant violated');
  }

  await tx.revokedToken.upsert({
    where: { jti: lockedSession.accessTokenJti },
    update: {
      userId,
      reason: 'session_revoked',
      revokedAt,
      expiresAt: lockedSession.accessTokenExpiresAt,
    },
    create: {
      jti: lockedSession.accessTokenJti,
      userId,
      reason: 'session_revoked',
      expiresAt: lockedSession.accessTokenExpiresAt,
    },
  });
  return { jti: lockedSession.accessTokenJti, expiresAt: lockedSession.accessTokenExpiresAt };
}

export async function revokeLogoutCredentialsWithClient(
  tx: PrismaTxClient,
  input: LogoutCredentialsInput,
  revokedAt: Date
): Promise<'not-supplied' | 'revoked' | 'already-revoked' | 'not-found'> {
  const hasRefreshFamily = hasRefreshSessionFamily(input);
  if (hasRefreshFamily) {
    await lockRefreshSessionFamily(tx, input.refreshSessionFamilyId);
  }
  await tx.revokedToken.upsert({
    where: { jti: input.accessTokenJti },
    update: {
      userId: input.userId,
      reason: 'user_logout',
      revokedAt,
      expiresAt: input.accessTokenExpiresAt,
    },
    create: {
      jti: input.accessTokenJti,
      userId: input.userId,
      reason: 'user_logout',
      expiresAt: input.accessTokenExpiresAt,
    },
  });
  if (!hasRefreshFamily) {
    return 'not-supplied';
  }

  const { refreshSessionFamilyId: sessionFamilyId, refreshTokenExpiresAt } = input;
  const [existingRevocation, latestSession] = await Promise.all([
    tx.revokedRefreshSessionFamily.findUnique({
      where: { sessionFamilyId },
      select: { sessionFamilyId: true },
    }),
    tx.refreshToken.findFirst({
      where: {
        sessionFamilyId,
        userId: input.userId,
      },
      orderBy: { expiresAt: 'desc' },
      select: { expiresAt: true },
    }),
  ]);
  const expiresAt = latestSession && latestSession.expiresAt > refreshTokenExpiresAt
    ? latestSession.expiresAt
    : refreshTokenExpiresAt;
  await tx.revokedRefreshSessionFamily.upsert({
    where: { sessionFamilyId },
    update: { expiresAt, reason: 'user_logout', revokedAt },
    create: {
      sessionFamilyId,
      userId: input.userId,
      reason: 'user_logout',
      expiresAt,
    },
  });
  const deleted = await tx.refreshToken.deleteMany({
    where: {
      sessionFamilyId,
      userId: input.userId,
    },
  });
  if (deleted.count > 0) {
    return 'revoked';
  }
  return existingRevocation ? 'already-revoked' : 'not-found';
}
