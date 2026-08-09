/**
 * Session Repository
 *
 * Abstracts database operations for authentication tokens and sessions.
 */

import prisma from '../models/prisma';
import crypto from 'crypto';
import { Prisma, type RefreshToken, type RevokedToken } from '../generated/prisma/client';
import { createLogger } from '../utils/logger';
import {
  consumeAndReplaceRefreshTokenWithClient,
  type RotateRefreshTokenInput,
} from './sessionRefreshTokenRotation';
import {
  revokeLogoutCredentialsWithClient,
  revokeSessionByIdWithClient,
  type RevokedAccessTokenLineage,
} from './sessionRevocationTransactions';

const log = createLogger('SESSION:REPO');

/**
 * Create refresh token input
 */
export interface CreateRefreshTokenInput {
  userId: string;
  token: string; // Plain token - will be hashed
  expiresAt: Date;
  accessTokenJti: string;
  accessTokenExpiresAt: Date;
  sessionFamilyId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  deviceId?: string | null;
  deviceName?: string | null;
}

/**
 * Hash a token for storage
 */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/**
 * Find refresh token by token value
 */
export async function findRefreshToken(
  token: string
): Promise<RefreshToken | null> {
  const tokenHash = hashToken(token);
  return prisma.refreshToken.findUnique({
    where: { tokenHash },
  });
}

/**
 * Find refresh token by its database ID
 *
 * Used for session management operations like revocation where we need
 * to verify ownership before deletion.
 *
 * @param id - The refresh token's database ID (UUID)
 */
export async function findRefreshTokenById(
  id: string
): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({
    where: { id },
  });
}

/**
 * Find refresh token by its SHA256 hash
 *
 * Used to resolve a token hash back to its record, primarily for
 * identifying the current session when listing all user sessions.
 *
 * @param tokenHash - SHA256 hash of the raw refresh token
 */
export async function findRefreshTokenByHash(
  tokenHash: string
): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({
    where: { tokenHash },
  });
}

/**
 * Find all refresh tokens for a user
 */
export async function findRefreshTokensByUserId(
  userId: string
): Promise<RefreshToken[]> {
  return prisma.refreshToken.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Find active (non-expired) refresh tokens for a user
 */
export async function findActiveRefreshTokens(
  userId: string
): Promise<RefreshToken[]> {
  return prisma.refreshToken.findMany({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Count active sessions for a user
 */
export async function countActiveSessions(userId: string): Promise<number> {
  return prisma.refreshToken.count({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
  });
}

/**
 * Create a new refresh token
 */
export async function createRefreshToken(
  input: CreateRefreshTokenInput
): Promise<RefreshToken> {
  return prisma.refreshToken.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(input.token),
      expiresAt: input.expiresAt,
      accessTokenJti: input.accessTokenJti,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      sessionFamilyId: input.sessionFamilyId,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
    },
  });
}

/**
 * Atomically consume one unexpired refresh token and replace it.
 *
 * Returns a classified result when the old credential was already superseded or
 * its family is terminal. Database errors are propagated so the caller does not
 * misclassify storage failures as invalid credentials. The stable-row update and
 * access-token revocation commit in the same transaction.
 */
export async function consumeAndReplaceRefreshToken(
  input: RotateRefreshTokenInput
): ReturnType<typeof consumeAndReplaceRefreshTokenWithClient> {
  const oldTokenHash = hashToken(input.oldToken);
  const newTokenHash = hashToken(input.newToken);
  const now = new Date();

  return prisma.$transaction((tx) =>
    consumeAndReplaceRefreshTokenWithClient(tx, input, {
      oldTokenHash,
      newTokenHash,
      now,
    })
  );
}

export async function revokeSessionById(
  sessionId: string,
  userId: string
): Promise<RevokedAccessTokenLineage | null> {
  return prisma.$transaction((tx) =>
    revokeSessionByIdWithClient(tx, sessionId, userId, new Date())
  );
}

export async function revokeLogoutCredentials(input: {
  userId: string;
  accessTokenJti: string;
  accessTokenExpiresAt: Date;
  refreshToken?: string;
  refreshSessionFamilyId?: string;
  refreshTokenExpiresAt?: Date;
}): ReturnType<typeof revokeLogoutCredentialsWithClient> {
  return prisma.$transaction((tx) => revokeLogoutCredentialsWithClient(tx, {
    userId: input.userId,
    accessTokenJti: input.accessTokenJti,
    accessTokenExpiresAt: input.accessTokenExpiresAt,
    refreshTokenHash: input.refreshToken ? hashToken(input.refreshToken) : undefined,
    refreshSessionFamilyId: input.refreshSessionFamilyId,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
  }, new Date()));
}

/**
 * Delete a refresh token (revoke)
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  try {
    await prisma.refreshToken.delete({
      where: { tokenHash },
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      log.debug('Token may already be deleted', { error: String(error) });
      return;
    }
    throw error;
  }
}

/**
 * Delete all refresh tokens for a user (revoke all sessions)
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: { userId },
  });
  return result.count;
}

/**
 * Delete expired refresh tokens
 */
export async function deleteExpiredRefreshTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Update last used timestamp
 */
export async function updateLastUsed(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  try {
    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { lastUsedAt: new Date() },
    });
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      log.debug('Token may not exist for lastUsed update', { error: String(error) });
      return;
    }
    throw error;
  }
}

/**
 * Check if a JWT is revoked
 */
export async function isTokenRevoked(jti: string): Promise<boolean> {
  const count = await prisma.revokedToken.count({
    where: { jti },
  });
  return count > 0;
}

/**
 * Add a JWT to the revoked list
 */
export async function revokeJwt(
  jti: string,
  expiresAt: Date,
  userId?: string,
  reason?: string
): Promise<RevokedToken> {
  return prisma.revokedToken.create({
    data: {
      jti,
      expiresAt,
      userId,
      reason,
    },
  });
}

/**
 * Clean up expired revoked tokens
 */
export async function cleanupExpiredRevokedTokens(): Promise<number> {
  const result = await prisma.revokedToken.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });
  return result.count;
}

/**
 * Upsert a revoked token (create or update)
 */
export async function upsertRevokedToken(
  jti: string,
  expiresAt: Date,
  userId?: string,
  reason?: string
): Promise<RevokedToken> {
  return prisma.revokedToken.upsert({
    where: { jti },
    update: {
      userId,
      reason,
      revokedAt: new Date(),
      expiresAt,
    },
    create: {
      jti,
      userId,
      reason,
      expiresAt,
    },
  });
}

/**
 * Find a revoked token by JTI
 */
export async function findRevokedTokenByJti(
  jti: string
): Promise<Pick<RevokedToken, 'jti' | 'expiresAt'> | null> {
  return prisma.revokedToken.findUnique({
    where: { jti },
    select: { jti: true, expiresAt: true },
  });
}

/**
 * Count all revoked tokens
 */
export async function countRevokedTokens(): Promise<number> {
  return prisma.revokedToken.count();
}

/**
 * Delete all revoked tokens
 */
export async function deleteAllRevokedTokens(): Promise<void> {
  await prisma.revokedToken.deleteMany();
}

/**
 * Get session info (refresh tokens as sessions)
 */
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  deviceId: string | null;
  deviceName: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  isCurrent: boolean;
}

export async function getSessionsForUser(
  userId: string,
  currentTokenId?: string
): Promise<SessionInfo[]> {
  const tokens = await prisma.refreshToken.findMany({
    where: {
      userId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userAgent: true,
      ipAddress: true,
      deviceId: true,
      deviceName: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });

  return tokens.map(token => ({
    id: token.id,
    userAgent: token.userAgent,
    ipAddress: token.ipAddress,
    deviceId: token.deviceId,
    deviceName: token.deviceName,
    createdAt: token.createdAt,
    lastUsedAt: token.lastUsedAt,
    expiresAt: token.expiresAt,
    isCurrent: token.id === currentTokenId,
  }));
}

// Export as namespace
export const sessionRepository = {
  findRefreshToken,
  findRefreshTokenById,
  findRefreshTokenByHash,
  findRefreshTokensByUserId,
  findActiveRefreshTokens,
  countActiveSessions,
  createRefreshToken,
  consumeAndReplaceRefreshToken,
  revokeSessionById,
  revokeLogoutCredentials,
  revokeRefreshToken,
  revokeAllUserTokens,
  deleteExpiredRefreshTokens,
  updateLastUsed,
  isTokenRevoked,
  revokeJwt,
  cleanupExpiredRevokedTokens,
  upsertRevokedToken,
  findRevokedTokenByJti,
  countRevokedTokens,
  deleteAllRevokedTokens,
  getSessionsForUser,
};

export default sessionRepository;
