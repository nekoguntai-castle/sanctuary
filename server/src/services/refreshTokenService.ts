/**
 * Refresh Token Service
 *
 * Manages refresh tokens with PostgreSQL persistence for durability.
 * Supports session management across multiple devices.
 *
 * ## Security Design
 *
 * - Stores SHA256 hash of refresh tokens (never raw tokens)
 * - Supports token rotation for enhanced security
 * - Tracks device info for session management
 * - Enables "logout from all devices" functionality
 */

import { sessionRepository } from '../repositories';
import { generateRefreshToken, decodeToken } from '../utils/jwt';
import type { TokenLineage } from '../utils/jwt';
import { randomUUID } from 'crypto';
import { publishRevokedToken } from './tokenRevocation';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';

const log = createLogger('REFRESH_TOKEN:SVC');

export interface DeviceInfo {
  deviceId?: string;
  deviceName?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface Session {
  id: string;
  deviceId: string | null;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  isCurrent: boolean;
}

export type RefreshRotationResult =
  | { status: 'rotated'; refreshToken: string }
  | { status: 'superseded' | 'terminal' };

function getRefreshTokenExpiry(refreshToken: string): Date {
  const decoded = decodeToken(refreshToken);
  if (!decoded?.exp) {
    throw new Error('Generated refresh token is missing expiry');
  }
  return new Date(decoded.exp * 1000);
}

/**
 * Create a new refresh token and store its hash in the database
 */
export async function createRefreshToken(
  userId: string,
  deviceInfo: DeviceInfo | undefined,
  sessionVersion: number | undefined,
  accessToken: TokenLineage
): Promise<string> {
  // Generate the actual refresh token
  const sessionFamilyId = randomUUID();
  const refreshToken = generateRefreshToken(userId, sessionVersion ?? 0, sessionFamilyId);
  const expiresAt = getRefreshTokenExpiry(refreshToken);

  try {
    await sessionRepository.createRefreshToken({
      userId,
      token: refreshToken,
      expiresAt,
      accessTokenJti: accessToken.jti,
      accessTokenExpiresAt: accessToken.expiresAt,
      sessionFamilyId,
      deviceId: deviceInfo?.deviceId,
      deviceName: deviceInfo?.deviceName,
      userAgent: deviceInfo?.userAgent,
      ipAddress: deviceInfo?.ipAddress,
    });

    log.debug('Refresh token created', { userId, deviceId: deviceInfo?.deviceId });
    return refreshToken;
  } catch (error) {
    log.error('Failed to create refresh token', { error: getErrorMessage(error), userId });
    throw error;
  }
}

/**
 * Verify a refresh token exists in the database and update lastUsedAt.
 *
 * Returns false only for absent or expired tokens. Storage/last-used persistence
 * errors are rethrown so callers return a server error instead of treating an
 * infrastructure failure as revoked credentials.
 */
export async function verifyRefreshTokenExists(token: string): Promise<boolean> {
  try {
    const existing = await sessionRepository.findRefreshToken(token);

    if (!existing) {
      return false;
    }

    // Check if expired
    if (existing.expiresAt < new Date()) {
      // Clean up expired token
      await sessionRepository.revokeRefreshToken(token);
      return false;
    }

    // Update last used time
    await sessionRepository.updateLastUsed(token);

    return true;
  } catch (error) {
    log.error('Failed to verify refresh token', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Rotate refresh token by atomically consuming the old row and creating one
 * replacement. A null result means the token was missing, expired, owned by the
 * wrong user, or already consumed by a concurrent request.
 */
export async function rotateRefreshToken(
  oldToken: string,
  deviceInfo: DeviceInfo | undefined,
  sessionVersion: number | undefined,
  expectedUserId: string | undefined,
  accessToken: TokenLineage
): Promise<RefreshRotationResult> {
  try {
    const decodedOldToken = decodeToken(oldToken);
    const userId = expectedUserId ?? decodedOldToken?.userId;
    if (!userId) {
      log.warn('Attempted to rotate refresh token without a user id');
      return { status: 'terminal' };
    }
    const newSessionVersion = sessionVersion ?? decodedOldToken?.sessionVersion ?? 0;
    const sessionFamilyId = decodedOldToken?.sessionFamilyId;
    if (!sessionFamilyId) {
      log.warn('Attempted to rotate refresh token without session-family lineage');
      return { status: 'terminal' };
    }
    const newToken = generateRefreshToken(userId, newSessionVersion, sessionFamilyId);
    const replacement = await sessionRepository.consumeAndReplaceRefreshToken({
      oldToken,
      expectedUserId: userId,
      newToken,
      expiresAt: getRefreshTokenExpiry(newToken),
      accessTokenJti: accessToken.jti,
      accessTokenExpiresAt: accessToken.expiresAt,
      sessionFamilyId,
      deviceId: deviceInfo?.deviceId,
      deviceName: deviceInfo?.deviceName,
      userAgent: deviceInfo?.userAgent,
      ipAddress: deviceInfo?.ipAddress,
    });

    if (replacement.status !== 'rotated') {
      log.warn('Refresh token rotation did not mint a replacement', {
        userId,
        status: replacement.status,
      });
      return replacement;
    }

    await publishRevokedToken(
      replacement.revokedAccessToken.jti,
      replacement.revokedAccessToken.expiresAt
    );
    log.debug('Refresh token rotated', { userId: replacement.replacement.userId });

    return { status: 'rotated', refreshToken: newToken };
  } catch (error) {
    log.error('Failed to rotate refresh token', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Revoke a specific refresh token by its hash
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  try {
    await sessionRepository.revokeRefreshToken(token);
    log.debug('Refresh token revoked');
    return true;
  } catch (error) {
    log.error('Failed to revoke refresh token', { error: getErrorMessage(error) });
    throw error;
  }
}

/**
 * Revoke a specific session by its ID
 *
 * Security: Enforces ownership - users can only revoke their own sessions.
 * Returns false if the session doesn't exist or belongs to another user.
 *
 * @param sessionId - The refresh token ID (not the token itself)
 * @param userId - The requesting user's ID for ownership verification
 * @returns true if revoked, false if not found or unauthorized
 */
export async function revokeSession(sessionId: string, userId: string): Promise<boolean> {
  try {
    const revoked = await sessionRepository.revokeSessionById(sessionId, userId);
    if (!revoked) {
      log.debug('Session not found or belongs to another user', { sessionId, userId });
      return false;
    }
    await publishRevokedToken(revoked.jti, revoked.expiresAt);
    log.info('Session revoked', { sessionId, userId });
    return true;
  } catch (error) {
    log.error('Failed to revoke session', { error: getErrorMessage(error), sessionId });
    throw error;
  }
}

export async function revokeLogoutCredentials(input: {
  userId: string;
  accessToken: TokenLineage;
  refreshToken?: string;
  refreshSessionFamilyId?: string;
  refreshTokenExpiresAt?: Date;
}): Promise<'not-supplied' | 'revoked' | 'already-revoked' | 'not-found'> {
  const status = await sessionRepository.revokeLogoutCredentials({
    userId: input.userId,
    accessTokenJti: input.accessToken.jti,
    accessTokenExpiresAt: input.accessToken.expiresAt,
    refreshToken: input.refreshToken,
    refreshSessionFamilyId: input.refreshSessionFamilyId,
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
  });
  await publishRevokedToken(input.accessToken.jti, input.accessToken.expiresAt);
  return status;
}

/**
 * Revoke all refresh tokens for a user (logout from all devices)
 */
export async function revokeAllUserRefreshTokens(userId: string): Promise<number> {
  try {
    const count = await sessionRepository.revokeAllUserTokens(userId);
    log.info('All user refresh tokens revoked', { userId, count });
    return count;
  } catch (error) {
    log.error('Failed to revoke all user refresh tokens', { error: getErrorMessage(error), userId });
    throw error;
  }
}

/**
 * Get all active sessions for a user
 *
 * Returns all non-expired refresh tokens for the user, with each session
 * marked as `isCurrent: true` if it matches the provided token hash.
 *
 * @param userId - The user's ID
 * @param currentTokenHash - SHA256 hash of the current refresh token (from X-Refresh-Token header)
 *                          Used to mark which session is the caller's current session
 * @returns Array of sessions with device info and current session indicator
 */
export async function getUserSessions(
  userId: string,
  currentTokenHash?: string
): Promise<Session[]> {
  try {
    // Resolve the token hash to get the actual token ID for marking current session
    let currentTokenId: string | undefined;
    if (currentTokenHash) {
      const currentToken = await sessionRepository.findRefreshTokenByHash(currentTokenHash);
      if (currentToken && currentToken.userId === userId) {
        currentTokenId = currentToken.id;
      }
    }

    // Use the repository's getSessionsForUser method with the resolved token ID
    const sessions = await sessionRepository.getSessionsForUser(userId, currentTokenId);

    return sessions.map(session => ({
      id: session.id,
      deviceId: session.deviceId,
      deviceName: session.deviceName,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      lastUsedAt: session.lastUsedAt,
      isCurrent: session.isCurrent,
    }));
  } catch (error) {
    log.error('Failed to get user sessions', { error: getErrorMessage(error), userId });
    throw error;
  }
}

/**
 * Clean up expired refresh tokens
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  try {
    const count = await sessionRepository.deleteExpiredRefreshTokens();

    if (count > 0) {
      log.debug('Cleaned up expired refresh tokens', { count });
    }

    return count;
  } catch (error) {
    log.error('Failed to cleanup expired refresh tokens', { error: getErrorMessage(error) });
    return 0;
  }
}

/**
 * Get the count of active sessions for a user
 */
export async function getActiveSessionCount(userId: string): Promise<number> {
  try {
    return await sessionRepository.countActiveSessions(userId);
  } catch (error) {
    log.error('Failed to get active session count', { error: getErrorMessage(error), userId });
    return 0;
  }
}
