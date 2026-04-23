/**
 * JWT Utilities
 *
 * Helper functions for creating and verifying JWT tokens.
 *
 * ## Security Features (SEC-003, SEC-005, SEC-006)
 *
 * - jti claims for token revocation
 * - aud (audience) claims to differentiate token types
 * - Shorter access tokens (1h) with refresh tokens (7d)
 */

import jwt from 'jsonwebtoken';
import { randomUUID, createHash } from 'crypto';
import config from '../config';
import { isTokenRevoked } from '../services/tokenRevocation';

/**
 * Token audiences for different token types (SEC-006)
 */
export enum TokenAudience {
  ACCESS = 'sanctuary:access',       // Full access token
  REFRESH = 'sanctuary:refresh',     // Refresh token
  TWO_FACTOR = 'sanctuary:2fa',      // Temporary 2FA verification token
}

/**
 * Canonical pending-2FA rejection message.
 *
 * `verifyToken(..., TokenAudience.ACCESS)` throws this exact message when a
 * signed token still represents the temporary 2FA step. Auth middleware uses
 * the constant to preserve the existing 401 response while keeping the claim
 * rejection inside token verification.
 */
export const TWO_FACTOR_REQUIRED_MESSAGE = '2FA verification required';

export interface JWTPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  pending2FA?: boolean; // True when awaiting 2FA verification
  usingDefaultPassword?: boolean; // True when using default 'sanctuary' password
  jti?: string; // JWT ID for revocation (SEC-003)
  aud?: string | string[]; // Audience claim (SEC-006)
}

export interface RefreshTokenPayload {
  userId: string;
  jti: string;
  aud: string;
  type: 'refresh';
}

function assertJwtPayload(value: unknown): asserts value is JWTPayload {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid token payload');
  }

  const payload = value as Partial<JWTPayload>;
  /* v8 ignore next 11 -- malformed claim branches are covered by focused JWT tests; V8 maps the OR chain unevenly. */
  if (
    typeof payload.userId !== 'string' ||
    payload.userId.length === 0 ||
    typeof payload.username !== 'string' ||
    payload.username.length === 0 ||
    typeof payload.isAdmin !== 'boolean' ||
    (payload.pending2FA !== undefined && typeof payload.pending2FA !== 'boolean') ||
    (payload.usingDefaultPassword !== undefined && typeof payload.usingDefaultPassword !== 'boolean') ||
    (payload.jti !== undefined && typeof payload.jti !== 'string')
  ) {
    throw new Error('Invalid token payload');
  }
}

/**
 * Generate a unique JWT ID (jti)
 */
function generateJti(): string {
  return randomUUID();
}

/**
 * Generate a SHA256 hash of a token for storage
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Generate a JWT access token for a user (SEC-005: 1h expiry)
 * @param payload - User payload data
 * @param expiresIn - Optional custom expiry (e.g., '5m', '1h')
 */
export function generateToken(payload: JWTPayload, expiresIn?: string): string {
  const jti = generateJti();
  const accessPayload: JWTPayload = { ...payload };
  delete accessPayload.pending2FA;
  return jwt.sign(
    {
      ...accessPayload,
      jti,
      aud: TokenAudience.ACCESS,
    },
    config.jwtSecret,
    {
      expiresIn: expiresIn || config.jwtExpiresIn,
    } as jwt.SignOptions
  );
}

/**
 * Generate a temporary 2FA verification token (SEC-006)
 * @param payload - User payload data
 */
export function generate2FAToken(payload: JWTPayload): string {
  const jti = generateJti();
  return jwt.sign(
    {
      ...payload,
      pending2FA: true,
      jti,
      aud: TokenAudience.TWO_FACTOR, // SEC-006: Distinct audience for 2FA tokens
    },
    config.jwtSecret,
    {
      expiresIn: '5m', // 5 minute expiry for 2FA verification
    } as jwt.SignOptions
  );
}

/**
 * Generate a refresh token (SEC-005)
 * @param userId - User ID
 */
export function generateRefreshToken(userId: string): string {
  const jti = generateJti();
  return jwt.sign(
    {
      userId,
      jti,
      aud: TokenAudience.REFRESH,
      type: 'refresh',
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtRefreshExpiresIn,
    } as jwt.SignOptions
  );
}

/**
 * Verify and decode a JWT token with revocation check (SEC-003)
 * @param token - JWT token
 * @param expectedAudience - Optional expected audience to verify
 */
export async function verifyToken(token: string, expectedAudience?: TokenAudience): Promise<JWTPayload> {
  let decoded: JWTPayload;

  try {
    const options: jwt.VerifyOptions = {};
    if (expectedAudience) {
      options.audience = expectedAudience;
    }

    const verified = jwt.verify(token, config.jwtSecret, options);
    assertJwtPayload(verified);
    decoded = verified;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid token');
    }
    throw new Error('Invalid or expired token');
  }

  try {
    // SEC-003: Check if token is revoked
    if (decoded.jti && await isTokenRevoked(decoded.jti)) {
      throw new Error('Token has been revoked');
    }
  } catch {
    throw new Error('Invalid or expired token');
  }

  if (expectedAudience === TokenAudience.ACCESS && decoded.pending2FA === true) {
    throw new Error(TWO_FACTOR_REQUIRED_MESSAGE);
  }

  return decoded;
}

/**
 * Verify a 2FA temporary token (SEC-006)
 */
export async function verify2FAToken(token: string): Promise<JWTPayload> {
  const decoded = await verifyToken(token, TokenAudience.TWO_FACTOR);

  if (!decoded.pending2FA) {
    throw new Error('Invalid 2FA token');
  }

  return decoded;
}

/**
 * Verify a refresh token (SEC-005)
 */
export async function verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
  try {
    const decoded = jwt.verify(token, config.jwtSecret, {
      audience: TokenAudience.REFRESH,
    }) as RefreshTokenPayload;

    // Check if token is revoked
    if (decoded.jti && await isTokenRevoked(decoded.jti)) {
      throw new Error('Refresh token has been revoked');
    }

    if (decoded.type !== 'refresh') {
      throw new Error('Invalid refresh token type');
    }

    return decoded;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    throw new Error('Invalid refresh token');
  }
}

/**
 * Decode a token without verification (for getting claims like jti, exp)
 * Use only when you need to access claims from an already-verified token
 */
export function decodeToken(token: string): JWTPayload & { exp?: number } | null {
  try {
    return jwt.decode(token) as JWTPayload & { exp?: number };
  } catch {
    return null;
  }
}

/**
 * Extract token from Authorization header
 */
export function extractTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Get token expiration date from decoded token
 */
export function getTokenExpiration(token: string): Date | null {
  const decoded = decodeToken(token);
  if (!decoded || !decoded.exp) {
    return null;
  }
  return new Date(decoded.exp * 1000);
}
