/**
 * Authentication Middleware
 *
 * Middleware to protect routes and verify JWT tokens.
 *
 * ## Security Features (SEC-003, SEC-006)
 *
 * - Verifies JWT audience claim to prevent token misuse
 * - Checks token revocation status via jti claim
 * - Rejects 2FA pending tokens for regular endpoints
 *
 * ## Token sources (ADR 0001)
 *
 * The middleware accepts the access token from either of two sources, in
 * order of precedence:
 *   1. `Authorization: Bearer <token>` header — used by mobile/gateway clients
 *      and any caller that does not maintain cookies.
 *   2. `sanctuary_access` HttpOnly cookie — used by the browser frontend.
 *
 * If both are present the Authorization header wins, which matches the
 * Phase 1 backwards-compatibility window in `tasks/todo.md` where browser
 * clients can still send the JSON token via header during the migration.
 * CSRF protection for the cookie path is enforced separately by
 * `middleware/csrf.ts`.
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken, extractTokenFromHeader, JWTPayload, TokenAudience, TWO_FACTOR_REQUIRED_MESSAGE } from '../utils/jwt';
import { requestContext } from '../utils/requestContext';
import { UnauthorizedError } from '../errors/ApiError';
import { SANCTUARY_ACCESS_COOKIE_NAME } from './authCookieNames';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

export interface AuthenticatedRequest extends Request {
  user: JWTPayload;
}

export function requireAuthenticatedUser(req: Request): JWTPayload {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  return req.user;
}

/**
 * Extract the access token from the request, preferring the Authorization
 * header and falling back to the sanctuary_access HttpOnly cookie.
 */
function extractAccessToken(req: Request): string | null {
  const headerToken = extractTokenFromHeader(req.headers.authorization);
  if (headerToken) {
    return headerToken;
  }
  const cookieToken = req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME];
  return typeof cookieToken === 'string' && cookieToken.length > 0 ? cookieToken : null;
}

/**
 * Middleware to verify JWT token and attach user to request
 *
 * SEC-003: Verifies token is not revoked via jti claim
 * SEC-006: Verifies token audience is 'sanctuary:access'
 */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractAccessToken(req);

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'No authentication token provided',
      });
    }

    // SEC-006: Verify token with expected audience
    const payload = await verifyToken(token, TokenAudience.ACCESS);

    // Attach user to request
    req.user = payload;

    // Set user in request context for logging correlation
    requestContext.setUser(payload.userId, payload.username);

    next();
  } catch (error) {
    if (error instanceof Error && error.message === TWO_FACTOR_REQUIRED_MESSAGE) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: TWO_FACTOR_REQUIRED_MESSAGE,
      });
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or expired token',
    });
  }
}

/**
 * Middleware to check if authenticated user is an admin
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required',
    });
  }

  if (!req.user.isAdmin) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Admin access required',
    });
  }

  next();
}

/**
 * Optional authentication - attaches user if token is present but doesn't require it
 *
 * SEC-006: Verifies token audience if present
 *
 * Accepts the access token from the Authorization header or the
 * sanctuary_access cookie (header takes precedence), matching `authenticate`.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractAccessToken(req);

    if (token) {
      // SEC-006: Verify with expected audience
      const payload = await verifyToken(token, TokenAudience.ACCESS);

      req.user = payload;
      // Set user in request context for logging correlation
      requestContext.setUser(payload.userId, payload.username);
    }

    next();
  } catch (error) {
    // Token invalid, but optional so just continue
    next();
  }
}
