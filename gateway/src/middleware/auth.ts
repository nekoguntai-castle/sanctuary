/**
 * Authentication Middleware
 *
 * Validates JWT tokens for mobile app requests. This is the gateway's
 * first line of defense - all protected routes must pass through here.
 *
 * ## How It Works
 *
 * 1. Mobile app includes `Authorization: Bearer <token>` header
 * 2. This middleware extracts and verifies the JWT
 * 3. If valid, attaches user info to request and continues
 * 4. If invalid/expired, returns 401 Unauthorized
 *
 * ## JWT Payload
 *
 * The JWT contains:
 * - `userId` - UUID of the authenticated user
 * - `username` - Username for logging/display
 * - `isAdmin` - Whether user has admin privileges (mostly unused in gateway)
 * - `iat` - Issued at timestamp
 * - `exp` - Expiration timestamp
 *
 * ## Security Notes
 *
 * - JWT_SECRET must match the backend's secret exactly
 * - Tokens are verified locally (no backend call needed)
 * - Expired tokens are rejected immediately
 * - Invalid signatures are rejected immediately
 *
 * ## Device ID Header
 *
 * Mobile apps can include `X-Device-Id` header to identify the device.
 * This is optional but useful for push notification management.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { createLogger } from '../utils/logger';
import { logSecurityEvent, logAuditEvent } from './requestLogger';

const log = createLogger('AUTH');

export interface JwtPayload {
  userId: string;
  username: string;
  isAdmin: boolean;
  iat: number;
  exp: number;
  jti?: string; // JWT ID for revocation (SEC-003)
  aud?: string | string[]; // Audience claim (SEC-006)
  pending2FA?: boolean; // True when awaiting 2FA verification
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  deviceId?: string;
}

/**
 * Extract JWT from Authorization header
 */
function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  return parts[1];
}

/**
 * Middleware to authenticate requests via JWT
 */
export function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (!token) {
    logSecurityEvent('AUTH_MISSING_TOKEN', {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent'],
    });
    res.status(401).json({ error: 'Unauthorized', message: 'Missing authorization token' });
    return;
  }

  try {
    // SEC-006: Verify token with expected audience for access tokens
    const payload = jwt.verify(token, config.jwtSecret, {
      audience: 'sanctuary:access',
    }) as JwtPayload;

    // SEC-006: Reject 2FA pending tokens
    if (payload.pending2FA) {
      logSecurityEvent('AUTH_2FA_TOKEN_MISUSE', {
        ip: req.ip,
        path: req.path,
        userAgent: req.headers['user-agent'],
        severity: 'medium',
      });
      res.status(401).json({ error: 'Unauthorized', message: '2FA verification required' });
      return;
    }

    req.user = payload;

    // Extract device ID from header if present (for push notifications)
    const deviceId = req.headers['x-device-id'];
    if (typeof deviceId === 'string') {
      req.deviceId = deviceId;
    }

    log.debug('Request authenticated', { userId: payload.userId, path: req.path });
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      logSecurityEvent('AUTH_TOKEN_EXPIRED', {
        ip: req.ip,
        path: req.path,
        userAgent: req.headers['user-agent'],
      });
      res.status(401).json({ error: 'Unauthorized', message: 'Token expired' });
    } else if (err instanceof jwt.JsonWebTokenError) {
      logSecurityEvent('AUTH_INVALID_TOKEN', {
        ip: req.ip,
        path: req.path,
        userAgent: req.headers['user-agent'],
        error: (err as Error).message,
        // Invalid tokens could indicate an attack attempt
        severity: 'medium',
      });
      res.status(401).json({ error: 'Unauthorized', message: 'Invalid token' });
    } else {
      log.error('Auth error', { error: (err as Error).message });
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
}

/**
 * Optional authentication - doesn't fail if no token, but sets user if present
 */
export function optionalAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const token = extractToken(req);

  if (token) {
    try {
      // SEC-006: Verify with expected audience
      const payload = jwt.verify(token, config.jwtSecret, {
        audience: 'sanctuary:access',
      }) as JwtPayload;

      // Don't set user for 2FA pending tokens
      if (!payload.pending2FA) {
        req.user = payload;
      }
    } catch (error) {
      log.debug('Optional auth token verification failed', { error });
      // Token invalid, but that's ok for optional auth
    }
  }

  next();
}
