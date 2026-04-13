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

export const SANCTUARY_ACCESS_COOKIE_NAME = 'sanctuary_access';
export const SANCTUARY_CSRF_COOKIE_NAME = 'sanctuary_csrf';
export const SANCTUARY_CSRF_HEADER_NAME = 'x-csrf-token';

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
      // Only enforce CSRF when the request authenticated via the
      // sanctuary_access cookie. Authorization-header (mobile/gateway)
      // callers are exempt because cross-site requests cannot attach a
      // custom Authorization header without explicit cross-origin opt-in.
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
