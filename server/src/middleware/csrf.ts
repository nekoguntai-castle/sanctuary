/**
 * CSRF Middleware
 *
 * Double-submit CSRF protection for browser cookie-based authentication.
 *
 * Per ADR 0001 (`docs/adr/0001-browser-auth-token-storage.md`), the browser
 * frontend authenticates by sending a `sanctuary_access` HttpOnly cookie. To
 * prevent CSRF on state-changing requests, the same auth response sets a
 * non-HttpOnly `sanctuary_csrf` cookie that the frontend reads and echoes in
 * the `X-CSRF-Token` header on POST/PUT/PATCH/DELETE. This module configures
 * `csrf-csrf` to verify the header against the cookie using an HMAC bound to
 * the access token value.
 *
 * The Authorization-header path (mobile/gateway) is exempt because cross-site
 * requests cannot attach a custom Authorization header without an explicit
 * cross-origin opt-in. The exemption is enforced via `skipCsrfProtection`.
 *
 * Phase 1 scope: this middleware is wired but no route currently issues the
 * `sanctuary_access` cookie, so `skipCsrfProtection` always returns true and
 * the middleware is effectively a no-op on every real request. Phase 2 turns
 * it on by setting the cookie in `/auth/login`, `/auth/2fa/verify`, and
 * `/auth/refresh`.
 *
 * ## Lazy initialization
 *
 * The `doubleCsrf` factory call and the HMAC-based secret derivation happen
 * inside `getCsrfInstance()` rather than at module load. This lets test files
 * that mock `../../src/config` import this module transitively (e.g. via
 * `middleware/auth.ts` which uses the SANCTUARY_ACCESS_COOKIE_NAME constant)
 * without crashing if their mocked config does not happen to include
 * `jwtSecret`. Production code paths invoke `doubleCsrfProtection` per
 * request, so the first request after server start does the one-time setup.
 */

import { createHmac } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { doubleCsrf } from 'csrf-csrf';
import config from '../config';
import { decodeToken, extractTokenFromHeader } from '../utils/jwt';
import {
  SANCTUARY_ACCESS_COOKIE_NAME,
  SANCTUARY_ACCESS_EXPIRES_AT_HEADER,
  SANCTUARY_CSRF_COOKIE_NAME,
  SANCTUARY_CSRF_HEADER_NAME,
  SANCTUARY_REFRESH_COOKIE_NAME,
  SANCTUARY_REFRESH_COOKIE_PATH,
} from './authCookieNames';

// Re-export the names so existing imports from `./csrf` still work. The
// canonical source is `./authCookieNames`, which has zero transitive
// config imports and is safe to pull into the WebSocket upgrade path.
export {
  SANCTUARY_ACCESS_COOKIE_NAME,
  SANCTUARY_ACCESS_EXPIRES_AT_HEADER,
  SANCTUARY_CSRF_COOKIE_NAME,
  SANCTUARY_CSRF_HEADER_NAME,
  SANCTUARY_REFRESH_COOKIE_NAME,
  SANCTUARY_REFRESH_COOKIE_PATH,
};

// Refresh cookie max-age in milliseconds. Must stay in sync with
// config.jwtRefreshExpiresIn which drives the JWT refresh token expiry in
// tokenRepository. The default is 7 days per ADR 0002.
const REFRESH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type CsrfInstance = ReturnType<typeof doubleCsrf>;
let cachedCsrfInstance: CsrfInstance | null = null;

function getCsrfInstance(): CsrfInstance {
  if (cachedCsrfInstance) {
    return cachedCsrfInstance;
  }

  // Derive a stable CSRF secret from the existing JWT secret so deployers do
  // not need to add a new env var. The HMAC ensures the JWT secret is never
  // directly exposed to csrf-csrf, and a leak of the CSRF secret cannot be
  // used to forge JWTs (HMAC is one-way). Uses the same flat `config.jwtSecret`
  // shape that `server/src/utils/jwt.ts` reads.
  const csrfSecret = createHmac('sha256', config.jwtSecret)
    .update('sanctuary-csrf-double-submit-v1')
    .digest('hex');

  cachedCsrfInstance = doubleCsrf({
    getSecret: () => csrfSecret,
    getSessionIdentifier: (req: Request) => {
      // Bind the CSRF token to the access cookie value so the token rotates
      // with the access token. Phase 2 will issue a new csrf cookie alongside
      // every new access cookie on login, 2FA verify, and refresh.
      return req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME] ?? '';
    },
    cookieName: SANCTUARY_CSRF_COOKIE_NAME,
    cookieOptions: {
      sameSite: 'strict',
      secure: config.nodeEnv === 'production',
      httpOnly: false, // frontend reads this to inject into X-CSRF-Token header
      path: '/',
    },
    size: 64,
    getCsrfTokenFromRequest: (req: Request) => {
      // Node concatenates duplicate request headers into a single
      // comma-separated string for any header not on the small array-allow
      // list (set-cookie, etc.), so X-CSRF-Token is always string|undefined
      // in practice. The typeof guard satisfies the TokenRetriever return
      // type union from csrf-csrf without an unreachable Array.isArray branch.
      const header = req.headers[SANCTUARY_CSRF_HEADER_NAME];
      return typeof header === 'string' ? header : undefined;
    },
    skipCsrfProtection: (req: Request) => {
      // The skip rule must mirror the auth middleware's source-selection
      // precedence (header wins over cookie); otherwise we break the
      // browser bearer-header rollback path during the Phase 2-6 cookie
      // migration window, where a browser client may legitimately send
      // BOTH an Authorization header (legacy persisted token) AND have
      // the cookie auto-attached by the browser. The auth middleware
      // would use the header — and would expect no CSRF token because the
      // request never authenticated via the cookie — but a naive
      // "cookie present → enforce CSRF" rule would 403 it.
      //
      // 1. Request will authenticate via the Authorization header
      //    (mobile/gateway path, OR browser rollback path) → skip CSRF.
      // 2. No access cookie at all → skip CSRF (the request will fail at
      //    the auth middleware with 401, or hit a public endpoint).
      // 3. Otherwise the request will authenticate via the cookie →
      //    enforce CSRF.
      //
      // Uses extractTokenFromHeader (not just !!authorization) so that a
      // malformed Authorization header like "Bearer " or "Basic ..." is
      // treated as "no header present" and the cookie path's CSRF
      // enforcement still applies. This matches extractAccessToken in
      // middleware/auth.ts exactly.
      if (extractTokenFromHeader(req.headers.authorization)) {
        return true;
      }
      return !req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME];
    },
  });

  return cachedCsrfInstance;
}

export function doubleCsrfProtection(req: Request, res: Response, next: NextFunction): void {
  return getCsrfInstance().doubleCsrfProtection(req, res, next);
}

export function generateCsrfToken(
  req: Request,
  res: Response,
  options?: Parameters<CsrfInstance['generateCsrfToken']>[2],
): string {
  return getCsrfInstance().generateCsrfToken(req, res, options);
}

/**
 * Issue the browser auth cookies after a successful login, 2FA verify, or
 * refresh. Called by route handlers in Phase 2 of the cookie auth migration
 * (ADR 0001 / 0002).
 *
 * Sets three cookies:
 *   - sanctuary_access: HttpOnly, Secure (prod), SameSite=Strict, path=/,
 *     expires at the access token's JWT exp claim.
 *   - sanctuary_refresh: HttpOnly, Secure (prod), SameSite=Strict,
 *     path=/api/v1/auth/refresh, max-age 7 days.
 *   - sanctuary_csrf: non-HttpOnly (readable by the frontend), Secure (prod),
 *     SameSite=Strict, path=/, bound to the access cookie value via HMAC.
 *
 * Also sets the X-Access-Expires-At response header (ISO 8601) so the
 * frontend can schedule a refresh without an extra round trip.
 *
 * Requires `req.cookies` to be populated by `cookie-parser`. Mutates
 * `req.cookies.sanctuary_access` in-memory so that `generateCsrfToken`'s
 * `getSessionIdentifier` reads the new token value when computing the HMAC
 * binding — otherwise the CSRF token would be bound to the PREVIOUS access
 * cookie and the frontend's first state-changing request after refresh
 * would fail with 403. The in-memory mutation is scoped to this request
 * only; it never leaks out of the handler.
 */
export function setAuthCookies(
  req: Request,
  res: Response,
  options: { accessToken: string; refreshToken: string },
): Date {
  const { accessToken, refreshToken } = options;
  const isProd = config.nodeEnv === 'production';

  // Derive the access-token expiry from the JWT itself so the cookie's
  // max-age and the X-Access-Expires-At header both match the authoritative
  // source (the signed exp claim). Fall back to 1h if decode fails — that
  // should never happen because we just generated the token, but defending
  // against a malformed token is cheaper than debugging a mismatch.
  const decoded = decodeToken(accessToken);
  const accessExpiresAt = decoded?.exp
    ? new Date(decoded.exp * 1000)
    : new Date(Date.now() + 60 * 60 * 1000);

  res.cookie(SANCTUARY_ACCESS_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
    expires: accessExpiresAt,
  });

  res.cookie(SANCTUARY_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: SANCTUARY_REFRESH_COOKIE_PATH,
    maxAge: REFRESH_COOKIE_MAX_AGE_MS,
  });

  // Mutate req.cookies so the CSRF token is bound to the NEW access cookie
  // value, not the one that was on the request. This matches the lifecycle
  // of an authenticated browser session: login/refresh rotates the access
  // cookie and the csrf cookie in lockstep.
  req.cookies = {
    ...(req.cookies ?? {}),
    [SANCTUARY_ACCESS_COOKIE_NAME]: accessToken,
  };
  generateCsrfToken(req, res);

  res.setHeader(SANCTUARY_ACCESS_EXPIRES_AT_HEADER, accessExpiresAt.toISOString());

  return accessExpiresAt;
}

/**
 * Clear all three browser auth cookies. Called on logout and on terminal
 * refresh failure so the browser is immediately de-authenticated and cannot
 * fall back to stale cookies on the next request.
 *
 * The cookie attributes passed here must match the ones used when setting
 * the cookies — some browsers are strict about matching SameSite and Path
 * before expiring a cookie.
 */
export function clearAuthCookies(res: Response): void {
  const isProd = config.nodeEnv === 'production';

  res.clearCookie(SANCTUARY_ACCESS_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
  });

  res.clearCookie(SANCTUARY_REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'strict',
    path: SANCTUARY_REFRESH_COOKIE_PATH,
  });

  res.clearCookie(SANCTUARY_CSRF_COOKIE_NAME, {
    httpOnly: false,
    secure: isProd,
    sameSite: 'strict',
    path: '/',
  });
}

/**
 * Set the X-Access-Expires-At response header for endpoints that verify the
 * caller's current access token but do not issue a new one — specifically
 * GET /auth/me, which the frontend calls on app boot to hydrate user state
 * and schedule its first refresh.
 *
 * Reads the token source the same way the auth middleware does (header
 * first, then cookie) so the expiry reported matches the token that
 * authenticated the request. If no token is present (defensive), the
 * header is simply not set and the caller gets the response unchanged.
 */
export function setAccessExpiresAtHeader(req: Request, res: Response): void {
  const headerToken = extractTokenFromHeader(req.headers.authorization);
  const cookieToken = req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME];
  const token = headerToken ?? (typeof cookieToken === 'string' ? cookieToken : null);

  if (!token) {
    return;
  }

  const decoded = decodeToken(token);
  if (decoded?.exp) {
    res.setHeader(SANCTUARY_ACCESS_EXPIRES_AT_HEADER, new Date(decoded.exp * 1000).toISOString());
  }
}
