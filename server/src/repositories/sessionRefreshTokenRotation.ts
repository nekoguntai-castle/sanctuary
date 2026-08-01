/**
 * Single-use refresh-token rotation helpers.
 *
 * The repository caller supplies old and new token hashes so this module can
 * enforce the consume-then-replace invariant inside one Prisma transaction. A
 * null result means the old row was absent, expired, owned by another user, or
 * already consumed by a concurrent request; storage errors are allowed to throw.
 */

import type { RefreshToken } from '../generated/prisma/client';
import type { PrismaTxClient } from '../models/prisma';

/**
 * Raw rotation inputs. `expectedUserId` is checked against the stored row so a
 * valid refresh JWT cannot be used to replace another user's stored token row.
 */
export interface RotateRefreshTokenInput {
  oldToken: string;
  expectedUserId: string;
  newToken: string;
  expiresAt: Date;
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
}

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
    && token.expiresAt > now;
}

async function consumeRefreshTokenRow(
  tx: PrismaTxClient,
  token: RefreshToken,
  input: RotateRefreshTokenInput,
  oldTokenHash: string,
  now: Date
): Promise<boolean> {
  const consumed = await tx.refreshToken.deleteMany({
    where: {
      id: token.id,
      userId: input.expectedUserId,
      tokenHash: oldTokenHash,
      expiresAt: { gt: now },
    },
  });
  return consumed.count === 1;
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

function createReplacementRefreshToken(
  tx: PrismaTxClient,
  oldToken: RefreshToken,
  input: RotateRefreshTokenInput,
  newTokenHash: string
): Promise<RefreshToken> {
  return tx.refreshToken.create({
    data: {
      userId: oldToken.userId,
      tokenHash: newTokenHash,
      expiresAt: input.expiresAt,
      userAgent: preferReplacementMetadata(input.userAgent, oldToken.userAgent),
      ipAddress: preferReplacementMetadata(input.ipAddress, oldToken.ipAddress),
      deviceId: preferReplacementMetadata(input.deviceId, oldToken.deviceId),
      deviceName: preferReplacementMetadata(input.deviceName, oldToken.deviceName),
    },
  });
}

/**
 * Consume the old unexpired row once and create its replacement in the same
 * transaction client. Only the transaction that deletes exactly one matching row
 * may mint a replacement token.
 */
export async function consumeAndReplaceRefreshTokenWithClient(
  tx: PrismaTxClient,
  input: RotateRefreshTokenInput,
  context: RefreshTokenRotationContext
): Promise<RefreshToken | null> {
  const oldToken = await tx.refreshToken.findUnique({
    where: { tokenHash: context.oldTokenHash },
  });

  if (!isConsumableRefreshToken(oldToken, input, context.now)) {
    return null;
  }

  const consumed = await consumeRefreshTokenRow(
    tx,
    oldToken,
    input,
    context.oldTokenHash,
    context.now
  );
  if (!consumed) {
    return null;
  }

  return createReplacementRefreshToken(tx, oldToken, input, context.newTokenHash);
}
