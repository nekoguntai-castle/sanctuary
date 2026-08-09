/**
 * Single-use refresh-token rotation helpers.
 *
 * The repository caller supplies old and new token hashes so this module can
 * serialize the session family and update its stable row inside one Prisma
 * transaction. The result distinguishes a concurrent winner from a terminal
 * family; storage errors are allowed to throw.
 */

import type { RefreshToken } from '../generated/prisma/client';
import type { PrismaTxClient } from '../models/prisma';
import { lockRefreshSessionFamily } from './sessionFamilyLock';

/**
 * Raw rotation inputs. `expectedUserId` is checked against the stored row so a
 * valid refresh JWT cannot be used to replace another user's stored token row.
 */
export interface RotateRefreshTokenInput {
  oldToken: string;
  expectedUserId: string;
  newToken: string;
  expiresAt: Date;
  accessTokenJti: string;
  accessTokenExpiresAt: Date;
  sessionFamilyId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
}

export type RotateRefreshTokenResult =
  | {
    status: 'rotated';
    replacement: RefreshToken;
    revokedAccessToken: { jti: string; expiresAt: Date };
  }
  | { status: 'superseded' | 'terminal' };

interface RefreshTokenRotationContext {
  oldTokenHash: string;
  newTokenHash: string;
  now: Date;
}

function isConsumableRefreshToken(
  token: RefreshToken | null,
  input: RotateRefreshTokenInput,
  now: Date
): token is RefreshToken {
  return token !== null
    && token.userId === input.expectedUserId
    && token.sessionFamilyId === input.sessionFamilyId
    && token.expiresAt > now;
}

async function classifyMissingToken(
  tx: PrismaTxClient,
  input: RotateRefreshTokenInput,
  now: Date
): Promise<RotateRefreshTokenResult> {
  const successor = await tx.refreshToken.findFirst({
    where: {
      sessionFamilyId: input.sessionFamilyId,
      userId: input.expectedUserId,
      expiresAt: { gt: now },
    },
    select: { id: true },
  });
  return { status: successor ? 'superseded' : 'terminal' };
}

async function replaceRefreshTokenRow(
  tx: PrismaTxClient,
  token: RefreshToken,
  input: RotateRefreshTokenInput,
  context: RefreshTokenRotationContext,
  now: Date
): Promise<RefreshToken | null> {
  const replaced = await tx.refreshToken.updateMany({
    where: {
      id: token.id,
      userId: input.expectedUserId,
      tokenHash: context.oldTokenHash,
      expiresAt: { gt: now },
    },
    data: {
      tokenHash: context.newTokenHash,
      expiresAt: input.expiresAt,
      accessTokenJti: input.accessTokenJti,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      lastUsedAt: now,
      userAgent: preferReplacementMetadata(input.userAgent, token.userAgent),
      ipAddress: preferReplacementMetadata(input.ipAddress, token.ipAddress),
      deviceId: preferReplacementMetadata(input.deviceId, token.deviceId),
      deviceName: preferReplacementMetadata(input.deviceName, token.deviceName),
    },
  });
  if (replaced.count !== 1) {
    return null;
  }
  return tx.refreshToken.findUnique({ where: { id: token.id } });
}

function preferReplacementMetadata(
  next?: string | null,
  previous?: string | null
): string | undefined {
  if (next !== undefined && next !== null) {
    return next;
  }
  if (previous !== undefined && previous !== null) {
    return previous;
  }
  return undefined;
}

/**
 * Consume the old unexpired credential once by conditionally updating its stable
 * session row. Only the transaction that updates exactly one matching row may
 * return a replacement credential.
 */
export async function consumeAndReplaceRefreshTokenWithClient(
  tx: PrismaTxClient,
  input: RotateRefreshTokenInput,
  context: RefreshTokenRotationContext
): Promise<RotateRefreshTokenResult> {
  await lockRefreshSessionFamily(tx, input.sessionFamilyId);
  const revokedFamily = await tx.revokedRefreshSessionFamily.findUnique({
    where: { sessionFamilyId: input.sessionFamilyId },
    select: { sessionFamilyId: true },
  });
  if (revokedFamily) {
    return { status: 'terminal' };
  }

  const oldToken = await tx.refreshToken.findUnique({
    where: { tokenHash: context.oldTokenHash },
  });

  if (!isConsumableRefreshToken(oldToken, input, context.now)) {
    return classifyMissingToken(tx, input, context.now);
  }

  const replacement = await replaceRefreshTokenRow(
    tx,
    oldToken,
    input,
    context,
    context.now
  );
  if (!replacement) {
    return classifyMissingToken(tx, input, context.now);
  }

  await tx.revokedToken.upsert({
    where: { jti: oldToken.accessTokenJti },
    update: {
      userId: oldToken.userId,
      reason: 'refresh_rotation',
      revokedAt: context.now,
      expiresAt: oldToken.accessTokenExpiresAt,
    },
    create: {
      jti: oldToken.accessTokenJti,
      userId: oldToken.userId,
      reason: 'refresh_rotation',
      expiresAt: oldToken.accessTokenExpiresAt,
    },
  });

  return {
    status: 'rotated',
    replacement,
    revokedAccessToken: {
      jti: oldToken.accessTokenJti,
      expiresAt: oldToken.accessTokenExpiresAt,
    },
  };
}
