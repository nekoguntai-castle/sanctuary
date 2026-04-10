/**
 * Session Repository
 *
 * Abstracts database operations for authentication tokens and sessions.
 */

import prisma from '../models/prisma';
import crypto from 'crypto';
import type { RefreshToken, RevokedToken } from '../generated/prisma/client';
import { createLogger } from '../utils/logger';

const log = createLogger('SESSION:REPO');

/**
 * Create refresh token input
 */
export interface CreateRefreshTokenInput {
  userId: string;
  token: string; // Plain token - will be hashed
  expiresAt: Date;
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
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      deviceId: input.deviceId,
      deviceName: input.deviceName,
    },
  });
}

/**
 * Delete a refresh token (revoke)
 */
export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = hashToken(token);
  await prisma.refreshToken.delete({
    where: { tokenHash },
  }).catch((err) => {
    log.debug('Token may already be deleted', { error: String(err) });
  });
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
 * Delete a refresh token by ID
 */
export async function deleteRefreshTokenById(id: string): Promise<void> {
  await prisma.refreshToken.delete({
    where: { id },
  }).catch((err) => {
    log.debug('Token may already be deleted', { error: String(err) });
  });
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
  await prisma.refreshToken.update({
    where: { tokenHash },
    data: { lastUsedAt: new Date() },
  }).catch((err) => {
    log.debug('Token may not exist for lastUsed update', { error: String(err) });
  });
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
): Promise<RevokedToken | null> {
  return prisma.revokedToken.findUnique({
    where: { jti },
    select: { jti: true },
  }) as Promise<RevokedToken | null>;
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
  revokeRefreshToken,
  revokeAllUserTokens,
  deleteRefreshTokenById,
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
