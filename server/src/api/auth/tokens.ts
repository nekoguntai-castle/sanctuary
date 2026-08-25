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
import {
  generateToken,
  verifyRefreshToken,
  getRefreshSessionLineage,
  getTokenLineage,
  type RefreshSessionLineage,
} from '../../utils/jwt';
import { revokeAllUserTokens } from '../../services/tokenRevocation';
import { isEmailVerificationBlockingAuth } from '../../services/accessTokenSessionService';
import * as refreshTokenService from '../../services/refreshTokenService';
import { auditService, AuditAction, AuditCategory, getClientInfo } from '../../services/auditService';
import { authenticate, extractAccessToken, requireAuthenticatedUser } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import {
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
 *      Phase 2 cookie migration, scoped to `/api/v1/auth` so refresh and
 *      logout can both consume and revoke it without exposing it to app routes.
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
 * Invalid/expired refresh JWTs and terminal session failures clear the browser
 * cookies. Rotation classifies a missing row while holding the stable session-
 * family lock: a committed successor is `superseded` and must not clear, while
 * a family with no successor is terminal and can clear without racing a winner.
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

  // Get user from database
  const user = await userRepository.findById(decoded.userId);

  if (!user) {
    clearAuthCookies(res);
    throw new UnauthorizedError('User not found');
  }

  if (decoded.sessionVersion !== user.sessionVersion) {
    log.warn('Refresh token rejected because user session version changed', { userId: user.id });
    clearAuthCookies(res);
    throw new UnauthorizedError('Refresh token has been revoked');
  }

  if (await isEmailVerificationBlockingAuth(user)) {
    log.warn('Refresh token rejected because email verification is required', { userId: user.id });
    clearAuthCookies(res);
    throw new UnauthorizedError('Email verification required');
  }

  // Get device info for rotation
  const { ipAddress, userAgent } = getClientInfo(req);
  const deviceInfo = { userAgent, ipAddress };

  const newAccessToken = generateToken({
    userId: user.id,
    username: user.username,
    isAdmin: user.isAdmin,
    sessionVersion: user.sessionVersion,
  });

  // Always rotate refresh token (security: limits window of stolen tokens)
  const rotation = await refreshTokenService.rotateRefreshToken(
    refreshTokenStr,
    deviceInfo,
    user.sessionVersion,
    decoded.userId,
    getTokenLineage(newAccessToken),
  );

  if (rotation.status !== 'rotated') {
    if (rotation.status === 'terminal') {
      clearAuthCookies(res);
    }
    log.warn('Refresh token could not be consumed during rotation', {
      userId: user.id,
      status: rotation.status,
    });
    throw new UnauthorizedError('Refresh token has been revoked');
  }

  log.debug('Token refreshed with rotation', { userId: user.id });

  // ADR 0001 / 0002 — Phase 6: rotated tokens are delivered via cookies only.
  // The X-Access-Expires-At header (set by setAuthCookies) lets the client
  // reschedule its proactive refresh timer without reading the token body.
  setAuthCookies(req, res, {
    accessToken: newAccessToken,
    refreshToken: rotation.refreshToken,
  });

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
 * and the refresh token is revoked from the sanctuary_refresh cookie or
 * req.body.refreshToken, with the cookie taking precedence when both exist.
 */
router.post('/logout', authenticate, validate({ body: LogoutSchema }), asyncHandler(async (req, res) => {
  const bodyRefresh = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : null;
  const cookieRefresh = typeof req.cookies?.[SANCTUARY_REFRESH_COOKIE_NAME] === 'string'
    ? req.cookies[SANCTUARY_REFRESH_COOKIE_NAME]
    : null;
  const refreshTokenStr = cookieRefresh || bodyRefresh;

  // Revoke access token. Source precedence matches the auth middleware:
  // Authorization header first, then sanctuary_access cookie. Both paths
  // yield the same JTI, so revocation works regardless of which the client
  // uses to authenticate the logout request itself.
  const accessToken = extractAccessToken(req);

  if (!accessToken) {
    throw new UnauthorizedError('Access token is required');
  }
  const userId = requireAuthenticatedUser(req).userId;
  let refreshLineage: RefreshSessionLineage | undefined;
  let invalidRefreshCredential = false;
  if (refreshTokenStr) {
    try {
      const decodedRefresh = await verifyRefreshToken(refreshTokenStr);
      if (decodedRefresh.userId !== userId) {
        throw new Error('Refresh token user does not match logout user');
      }
      refreshLineage = getRefreshSessionLineage(refreshTokenStr);
    } catch {
      invalidRefreshCredential = true;
    }
  }
  const refreshStatus = await refreshTokenService.revokeLogoutCredentials({
    userId,
    accessToken: getTokenLineage(accessToken),
    refreshToken: invalidRefreshCredential ? undefined : refreshTokenStr ?? undefined,
    refreshSessionFamilyId: refreshLineage?.sessionFamilyId,
    refreshTokenExpiresAt: refreshLineage?.expiresAt,
  });
  log.debug('Logout credentials revoked', { userId, refreshStatus });

  // Clear the browser auth cookies. No-op for callers that never set them
  // (mobile/gateway via Authorization header).
  clearAuthCookies(res);

  if (invalidRefreshCredential || refreshStatus === 'not-found') {
    throw new UnauthorizedError('Refresh session not found');
  }

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

  const revokedCount = await revokeAllUserTokens(userId, 'logout_all_devices');

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
