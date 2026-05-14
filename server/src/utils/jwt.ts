/**
 * JWT Utilities
 *
 * Helper functions for creating and verifying JWT tokens.
 *
 * ## Security Features (SEC-003, SEC-005, SEC-006)
 *
 * - jti claims for token revocation
 * - sessionVersion claims for per-user access/refresh token revocation
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
  // Per-user revocation marker. Mismatch with the current DB value forces re-authentication.
  sessionVersion?: number;
  jti?: string; // JWT ID for revocation (SEC-003)
  aud?: string | string[]; // Audience claim (SEC-006)
}

export interface RefreshTokenPayload {
  userId: string;
  sessionVersion: number;
  jti: string;
  aud: string;
  type: 'refresh';
}

type DecodedTokenPayload = Partial<JWTPayload & RefreshTokenPayload> & { exp?: number; iat?: number };

const isValidSessionVersion = (value: unknown): boolean => {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
};

const sessionVersionOrZero = (sessionVersion: number | undefined): number => {
  if (!isValidSessionVersion(sessionVersion)) {
    return 0;
  }
  return sessionVersion as number;
};

const ensureSessionVersion = (value: unknown): void => {
  if (!isValidSessionVersion(value)) {
    throw new Error('Invalid token payload');
  }
};

const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

const hasRequiredJwtClaims = (payload: Partial<JWTPayload>): boolean => {
  return (
    isNonEmptyString(payload.userId) &&
    isNonEmptyString(payload.username) &&
    typeof payload.isAdmin === 'boolean'
  );
};

const hasValidOptionalJwtClaims = (payload: Partial<JWTPayload>): boolean => {
  return (
    (payload.pending2FA === undefined || typeof payload.pending2FA === 'boolean') &&
    (payload.usingDefaultPassword === undefined || typeof payload.usingDefaultPassword === 'boolean') &&
    (payload.sessionVersion === undefined || isValidSessionVersion(payload.sessionVersion)) &&
    (payload.jti === undefined || typeof payload.jti === 'string')
  );
};

const parseJwtPayload = (value: unknown): JWTPayload => {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid token payload');
  }

  const payload = value as Partial<JWTPayload>;
  if (!hasRequiredJwtClaims(payload) || !hasValidOptionalJwtClaims(payload)) {
    throw new Error('Invalid token payload');
  }

  return payload as JWTPayload;
};

const parseRefreshTokenPayload = (value: unknown): RefreshTokenPayload => {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid refresh token payload');
  }

  const payload = value as Partial<RefreshTokenPayload>;
  if (
    typeof payload.userId !== 'string' ||
    payload.userId.length === 0 ||
    typeof payload.jti !== 'string' ||
    payload.jti.length === 0 ||
    payload.type !== 'refresh' ||
    !isValidSessionVersion(payload.sessionVersion)
  ) {
    throw new Error('Invalid refresh token payload');
  }

  return payload as RefreshTokenPayload;
};

async function ensureTokenNotRevoked(jti: string | undefined, revokedMessage: string): Promise<void> {
  if (!jti) {
    return;
  }

  let revoked: boolean;
  try {
    revoked = await isTokenRevoked(jti);
  } catch {
    throw new Error('Token revocation check unavailable');
  }

  if (revoked) {
    throw new Error(revokedMessage);
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
  const accessPayload: JWTPayload = {
    ...payload,
    sessionVersion: sessionVersionOrZero(payload.sessionVersion),
  };
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
      sessionVersion: sessionVersionOrZero(payload.sessionVersion),
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
 * @param sessionVersion - Per-user revocation marker
 */
export function generateRefreshToken(userId: string, sessionVersion = 0): string {
  const jti = generateJti();
  return jwt.sign(
    {
      userId,
      sessionVersion: sessionVersionOrZero(sessionVersion),
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

    const verified = parseJwtPayload(jwt.verify(token, config.jwtSecret, options));
    if (expectedAudience === TokenAudience.ACCESS || expectedAudience === TokenAudience.TWO_FACTOR) {
      ensureSessionVersion(verified.sessionVersion);
    }
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

  // SEC-003: Check if token is revoked without hiding revocation-store outages.
  await ensureTokenNotRevoked(decoded.jti, 'Token has been revoked');

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
  let decoded: RefreshTokenPayload;

  try {
    decoded = parseRefreshTokenPayload(jwt.verify(token, config.jwtSecret, {
      audience: TokenAudience.REFRESH,
    }));
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new Error('Refresh token expired');
    }
    if (error instanceof jwt.JsonWebTokenError) {
      throw new Error('Invalid refresh token');
    }
    throw new Error('Invalid refresh token');
  }

  // Check if token is revoked without hiding revocation-store outages.
  await ensureTokenNotRevoked(decoded.jti, 'Refresh token has been revoked');

  /* v8 ignore next -- parseRefreshTokenPayload already rejects non-refresh types; keep this as defense-in-depth. */
  if (decoded.type !== 'refresh') {
    throw new Error('Invalid refresh token type');
  }

  return decoded;
}

/**
 * Decode a token without verification (for getting claims like jti, exp)
 * Use only when you need to access claims from an already-verified token
 */
export function decodeToken(token: string): DecodedTokenPayload | null {
  try {
    return jwt.decode(token) as DecodedTokenPayload;
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
