/**
 * Auth - Token Management Router
 *
 * Endpoints for token refresh and logout (SEC-003, SEC-005)
 */

import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../errors/errorHandler';
import { userRepository } from '../../repositories/userRepository';
import { InvalidInputError, UnauthorizedError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { generateToken, verifyRefreshToken, decodeToken } from '../../utils/jwt';
import { revokeToken, revokeAllUserTokens } from '../../services/tokenRevocation';
import * as refreshTokenService from '../../services/refreshTokenService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import { authenticate, requireAuthenticatedUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
  SANCTUARY_ACCESS_COOKIE_NAME,
  SANCTUARY_REFRESH_COOKIE_NAME,
  clearAuthCookies,
  setAuthCookies,
} from '../../middleware/csrf';
import { LogoutSchema } from '../schemas/auth';

const router = Router();
const log = createLogger('AUTH_TOKEN:ROUTE');

const RefreshBodySchema = z.preprocess(
  /* v8 ignore next -- request body middleware provides an object or undefined only */
  (body) => body === undefined ? {} : body,
  z.object({
    refreshToken: z.string().optional(),
  }).passthrough()
);

/**
 * POST /api/v1/auth/refresh
 * Exchange a refresh token for a new access token (SEC-005)
 * Always rotates the refresh token on success for enhanced security.
 *
 * The refresh token can be supplied in one of two ways, matching the dual
 * auth surface in ADR 0001 / 0002:
 *
 *   1. `sanctuary_refresh` HttpOnly cookie — the browser path after the
 *      Phase 2 cookie migration, scoped to `/api/v1/auth/refresh` so it is
 *      never sent to any other endpoint.
 *   2. `req.body.refreshToken` — used by mobile/gateway callers that
 *      cannot set browser cookies, and by browser clients during the
 *      Phase 2-6 rollback window if the frontend is rolled back to the
 *      legacy JSON-token storage path.
 *
 * When both sources are present the **cookie wins**, per ADR 0002 migration
 * plan item 2 ("both present uses the cookie"). The cookie is the modern
 * browser path and the body field is the legacy fallback, so preferring the
 * cookie ensures a cleanly-rolled-forward browser uses the rotated cookie
 * it already has rather than a stale sessionStorage copy.
 *
 * On terminal failure (invalid/expired/revoked refresh token) the three
 * browser auth cookies are cleared before the 401 response is sent, so a
 * browser that hit this endpoint with a stale cookie does not keep sending
 * the same stale credentials on every subsequent request. This matches
 * ADR 0002's required test "refresh clears cookies on failure (revoked
 * refresh token)" and is the backend half of the Phase 4 terminal-logout
 * flow.
 *
 * The gateway's own request validation still requires body.refreshToken on
 * mobile routes, so the precedence change does not affect the mobile path
 * (no cookie is ever present there).
 */
router.post('/refresh', validate({ body: RefreshBodySchema }), asyncHandler(async (req, res) => {
  const bodyToken = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const cookieToken = typeof req.cookies?.[SANCTUARY_REFRESH_COOKIE_NAME] === 'string'
    ? req.cookies[SANCTUARY_REFRESH_COOKIE_NAME]
    : null;
  // Cookie wins when both are present, per ADR 0002. Mobile/gateway
  // callers only ever have the body field, so this has no effect on them.
  const refreshTokenStr = cookieToken && cookieToken.length > 0
    ? cookieToken
    : (bodyToken && bodyToken.length > 0 ? bodyToken : null);

  if (!refreshTokenStr) {
    throw new InvalidInputError('Refresh token is required');
  }

  // Verify refresh token JWT signature and expiration
  // Keep inner try/catch: specific error handling for token verification
  let decoded;
  try {
    decoded = await verifyRefreshToken(refreshTokenStr);
  } catch (err) {
    log.debug('Refresh token verification failed', { error: (err as Error).message });
    // ADR 0002: clear the browser cookies on terminal refresh failure so
    // the client is evicted cleanly instead of looping 401s on a stale
    // refresh cookie. No-op on mobile/gateway callers (no cookies set).
    clearAuthCookies(res);
    throw new UnauthorizedError('Invalid or expired refresh token');
  }

  // Verify token exists in database (not already revoked)
  const tokenExists = await refreshTokenService.verifyRefreshTokenExists(refreshTokenStr);
  if (!tokenExists) {
    log.warn('Refresh token not found in database', { userId: decoded.userId });
    clearAuthCookies(res);
    throw new UnauthorizedError('Refresh token has been revoked');
  }

  // Get user from database
  const user = await userRepository.findById(decoded.userId);

  if (!user) {
    clearAuthCookies(res);
    throw new UnauthorizedError('User not found');
  }

  // Generate new access token
  const newAccessToken = generateToken({
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
  });

  // Get device info for rotation
  const { ipAddress, userAgent } = getClientInfo(req);
  const deviceInfo = { userAgent, ipAddress };

  // Always rotate refresh token (security: limits window of stolen tokens)
  const newRefreshToken = await refreshTokenService.rotateRefreshToken(refreshTokenStr, deviceInfo);

  if (!newRefreshToken) {
    // Transient server error, NOT a terminal auth failure. The refresh
    // token has already been verified as valid (JWT signature OK, not
    // revoked, user exists), so clearing the cookies here would punish
    // the client for a server-side rotation bug — they would have no
    // credentials left to retry with, even though their session is
    // actually fine. ADR 0002's clear-on-failure rule specifically
    // names "revoked refresh token" (terminal auth), not "any 500".
    // Leave the cookies alone and let the client retry.
    log.error('Token rotation failed', { userId: user.id });
    throw new Error('Failed to rotate refresh token');
  }

  log.debug('Token refreshed with rotation', { userId: user.id });

  // ADR 0001 / 0002 — Phase 6: rotated tokens are delivered via cookies only.
  // The X-Access-Expires-At header (set by setAuthCookies) lets the client
  // reschedule its proactive refresh timer without reading the token body.
  setAuthCookies(req, res, { accessToken: newAccessToken, refreshToken: newRefreshToken });

  res.json({
    expiresIn: 3600, // 1 hour in seconds
  });
}));

/**
 * POST /api/v1/auth/logout
 * Revoke current access token and optionally the refresh token (SEC-003)
 *
 * ADR 0001 / 0002: Clears all three browser auth cookies on success so a
 * cookie-authenticated browser session is immediately de-authenticated.
 * The access token JTI is revoked regardless of source (header or cookie),
 * and the refresh token is revoked from either req.body.refreshToken or
 * the sanctuary_refresh cookie — whichever the caller supplied.
 */
router.post('/logout', authenticate, validate({ body: LogoutSchema }), asyncHandler(async (req, res) => {
  const bodyRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const cookieRefresh = typeof req.cookies?.[SANCTUARY_REFRESH_COOKIE_NAME] === 'string'
    ? req.cookies[SANCTUARY_REFRESH_COOKIE_NAME]
    : null;
  const refreshTokenStr = bodyRefresh || cookieRefresh;

  // Revoke access token. Source precedence matches the auth middleware:
  // Authorization header first, then sanctuary_access cookie. Both paths
  // yield the same JTI, so revocation works regardless of which the client
  // uses to authenticate the logout request itself.
  const authHeader = req.headers.authorization;
  let accessToken: string | null = null;
  if (authHeader?.startsWith('Bearer ')) {
    accessToken = authHeader.substring(7);
  } else if (typeof req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME] === 'string') {
    accessToken = req.cookies[SANCTUARY_ACCESS_COOKIE_NAME];
  }

  if (accessToken) {
    const decoded = decodeToken(accessToken);

    if (decoded?.jti && decoded?.exp) {
      const expiresAt = new Date(decoded.exp * 1000);
      await revokeToken(decoded.jti, expiresAt, req.user?.userId, 'user_logout');
      log.debug('Access token revoked on logout', { userId: req.user?.userId });
    }
  }

  // Revoke refresh token if provided (body field or cookie).
  if (refreshTokenStr) {
    await refreshTokenService.revokeRefreshToken(refreshTokenStr);
    log.debug('Refresh token revoked on logout', { userId: req.user?.userId });
  }

  // Clear the browser auth cookies. No-op for callers that never set them
  // (mobile/gateway via Authorization header).
  clearAuthCookies(res);

  // Audit logout
  const { ipAddress, userAgent } = getClientInfo(req);
  await auditService.log({
    userId: req.user?.userId,
    username: req.user?.username || 'unknown',
    action: AuditAction.LOGOUT,
    category: AuditCategory.AUTH,
    ipAddress,
    userAgent,
    success: true,
  });

  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}));

/**
 * POST /api/v1/auth/logout-all
 * Revoke all sessions for the current user (logout from all devices)
 *
 * ADR 0001 / 0002: Clears all three browser auth cookies on the calling
 * tab in addition to revoking server-side sessions for all devices. The
 * caller's other tabs will pick up the logout via the frontend's
 * BroadcastChannel propagation in Phase 4.
 */
router.post('/logout-all', authenticate, asyncHandler(async (req, res) => {
  const userId = requireAuthenticatedUser(req).userId;

  // Revoke all refresh tokens for this user
  const revokedCount = await refreshTokenService.revokeAllUserRefreshTokens(userId);

  // Also revoke all access tokens (via the token revocation list)
  await revokeAllUserTokens(userId, 'logout_all_devices');

  // Clear the browser auth cookies on this response. Other tabs on this
  // device will be signalled via the BroadcastChannel propagation added
  // in Phase 4; their cookies are cleared when they run the shared logout
  // handler.
  clearAuthCookies(res);

  // Audit the action
  const { ipAddress, userAgent } = getClientInfo(req);
  await auditService.log({
    userId,
    username: req.user?.username || 'unknown',
    action: AuditAction.LOGOUT,
    category: AuditCategory.AUTH,
    ipAddress,
    userAgent,
    success: true,
    details: { action: 'logout_all', sessionsRevoked: revokedCount },
  });

  log.info('User logged out from all devices', { userId, sessionsRevoked: revokedCount });

  res.json({
    success: true,
    message: 'Logged out from all devices',
    sessionsRevoked: revokedCount,
  });
}));

export default router;
