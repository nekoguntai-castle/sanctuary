/**
 * CSRF Middleware Tests
 *
 * Verifies the conditional CSRF protection added in Phase 1 of the
 * HttpOnly cookie auth migration (ADR 0001 / 0002 — see docs/adr/).
 *
 * The middleware is wired into server/src/index.ts after cookieParser and
 * before the routes, but it only enforces CSRF when the request actually
 * authenticated via the sanctuary_access HttpOnly cookie. Mobile and
 * gateway callers using the Authorization: Bearer header path are exempt
 * via skipCsrfProtection. GET/HEAD/OPTIONS are exempt by csrf-csrf default.
 *
 * Phase 1 ships the middleware but no route currently issues the cookie,
 * so on real traffic the middleware is a no-op. These tests use
 * generateCsrfToken to mint a valid token, set the cookies on a synthetic
 * request, and verify the middleware behaves correctly across:
 *   - exempt: no cookie present (the production hot path in Phase 1)
 *   - exempt: GET / HEAD / OPTIONS even when the cookie is present
 *   - enforced: state-changing methods with the cookie present
 *     - rejects when no header
 *     - rejects when header is wrong
 *     - accepts when header matches the cookie
 */

// Set JWT_SECRET BEFORE importing config (the config module reads it at load time).
process.env.JWT_SECRET = 'test-jwt-secret-for-csrf-middleware-tests-32+chars';
process.env.NODE_ENV = 'test';

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import {
  doubleCsrfProtection,
  generateCsrfToken,
  SANCTUARY_ACCESS_COOKIE_NAME,
  SANCTUARY_CSRF_COOKIE_NAME,
  SANCTUARY_CSRF_HEADER_NAME,
} from '../../../src/middleware/csrf';

/**
 * Build a tiny Express app that mirrors the production wiring order:
 *   cookieParser → doubleCsrfProtection → handler
 */
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  // A token-issuing endpoint that mints a CSRF token tied to a synthetic
  // sanctuary_access cookie value. In production this happens inside
  // /auth/login, /auth/2fa/verify, and /auth/refresh during Phase 2 — the
  // route handler sets the access cookie THEN calls generateCsrfToken, and
  // the session identifier used by csrf-csrf is read from req.cookies on the
  // follow-up request. Here we have to mirror that lifecycle inside one
  // request, so mutate req.cookies in lockstep with res.cookie before
  // generating the token; otherwise the token is bound to an empty session
  // identifier and follow-up requests with a non-empty cookie are rejected.
  app.get('/test/issue-token', (req, res) => {
    const accessValue = (req.query.access as string) || 'synthetic-access-cookie';
    res.cookie(SANCTUARY_ACCESS_COOKIE_NAME, accessValue, {
      httpOnly: true,
      sameSite: 'strict',
      secure: false, // false in tests; production Phase 2 sets true
      path: '/',
    });
    req.cookies = { ...(req.cookies ?? {}), [SANCTUARY_ACCESS_COOKIE_NAME]: accessValue };
    const csrfToken = generateCsrfToken(req, res);
    res.json({ csrfToken });
  });

  app.use(doubleCsrfProtection);

  app.get('/test/protected', (_req, res) => res.json({ ok: true, method: 'GET' }));
  app.post('/test/protected', (_req, res) => res.json({ ok: true, method: 'POST' }));
  app.put('/test/protected', (_req, res) => res.json({ ok: true, method: 'PUT' }));
  app.patch('/test/protected', (_req, res) => res.json({ ok: true, method: 'PATCH' }));
  app.delete('/test/protected', (_req, res) => res.json({ ok: true, method: 'DELETE' }));

  // Express 5 + csrf-csrf throw HttpError; surface as JSON for assertions.
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.statusCode || 500).json({
      error: 'CsrfError',
      message: err.message,
      code: err.code,
    });
  });

  return app;
}

interface IssuedTokens {
  csrfHeader: string;
  cookieJar: string[];
}

/**
 * Hit the issue-token endpoint, parse the Set-Cookie headers and CSRF token,
 * and return everything a follow-up request needs to authenticate as the
 * cookie-bearing browser.
 */
async function issueTokens(app: express.Express, accessValue?: string): Promise<IssuedTokens> {
  const url = accessValue
    ? `/test/issue-token?access=${encodeURIComponent(accessValue)}`
    : '/test/issue-token';
  const res = await request(app).get(url).expect(200);

  const setCookie = res.headers['set-cookie'];
  const cookieJar = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  if (cookieJar.length === 0) {
    throw new Error('issue-token did not return any Set-Cookie headers');
  }

  return {
    csrfHeader: res.body.csrfToken as string,
    // supertest accepts the raw Set-Cookie strings on follow-up requests.
    cookieJar,
  };
}

describe('csrf middleware (ADR 0001 / 0002 Phase 1)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = buildApp();
  });

  describe('skipCsrfProtection: no sanctuary_access cookie (Authorization-header / mobile / gateway path)', () => {
    it('allows a state-changing POST without any CSRF token when no access cookie is present', async () => {
      await request(app).post('/test/protected').expect(200, { ok: true, method: 'POST' });
    });

    it('allows PUT/PATCH/DELETE without CSRF when no access cookie is present', async () => {
      await request(app).put('/test/protected').expect(200);
      await request(app).patch('/test/protected').expect(200);
      await request(app).delete('/test/protected').expect(200);
    });

    it('allows a GET without any CSRF token when no access cookie is present', async () => {
      await request(app).get('/test/protected').expect(200, { ok: true, method: 'GET' });
    });
  });

  describe('skipCsrfProtection: Authorization header takes precedence (browser bearer-header rollback path)', () => {
    // Phase 2-6 ships the cookie + the JSON token field in parallel for one
    // release as a rollback safety net. During that window a browser client
    // may legitimately send BOTH an Authorization: Bearer header (legacy
    // persisted token) AND have the sanctuary_access cookie auto-attached
    // by the browser. The auth middleware uses the header (header wins),
    // and the CSRF middleware must mirror that precedence — otherwise it
    // 403s a request that the rest of the stack would happily authenticate.

    it('allows a state-changing POST when Authorization header AND cookie are present, even with no CSRF token (rollback path)', async () => {
      const { cookieJar } = await issueTokens(app);
      await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .set('Authorization', 'Bearer some-legacy-bearer-token')
        // No X-CSRF-Token — the legacy bearer-header client doesn't have one.
        .expect(200, { ok: true, method: 'POST' });
    });

    it('allows PUT/PATCH/DELETE on the rollback path (header + cookie + no CSRF token)', async () => {
      const { cookieJar } = await issueTokens(app);
      await request(app)
        .put('/test/protected')
        .set('Cookie', cookieJar)
        .set('Authorization', 'Bearer legacy-token')
        .expect(200);
      await request(app)
        .patch('/test/protected')
        .set('Cookie', cookieJar)
        .set('Authorization', 'Bearer legacy-token')
        .expect(200);
      await request(app)
        .delete('/test/protected')
        .set('Cookie', cookieJar)
        .set('Authorization', 'Bearer legacy-token')
        .expect(200);
    });

    it('still ENFORCES CSRF when Authorization header is malformed and cookie is present (auth would fall back to cookie)', async () => {
      // The auth middleware uses extractTokenFromHeader, which returns null
      // for "Basic ..." or "Bearer " (no token). Auth then falls through to
      // the cookie. CSRF must enforce in that case because the actual auth
      // path used is the cookie. The skip rule matches extractTokenFromHeader
      // exactly, not just !!req.headers.authorization, so this works.
      const { cookieJar } = await issueTokens(app);
      const res = await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .set('Authorization', 'Basic dXNlcjpwYXNzd29yZA==')
        // No X-CSRF-Token. The auth middleware will use the cookie because
        // extractTokenFromHeader returns null on the Basic header.
        .expect(403);
      expect(res.body.error).toBe('CsrfError');
    });

    it('still ENFORCES CSRF when Authorization header is empty Bearer and cookie is present', async () => {
      const { cookieJar } = await issueTokens(app);
      const res = await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .set('Authorization', 'Bearer ')
        .expect(403);
      expect(res.body.error).toBe('CsrfError');
    });
  });

  describe('exempt methods when the access cookie IS present', () => {
    it('allows a GET when the access cookie is present but no CSRF header', async () => {
      const { cookieJar } = await issueTokens(app);
      await request(app).get('/test/protected').set('Cookie', cookieJar).expect(200);
    });
  });

  describe('enforced: state-changing requests with sanctuary_access cookie', () => {
    it('rejects POST when the cookie is present but no X-CSRF-Token header is sent', async () => {
      const { cookieJar } = await issueTokens(app);
      const res = await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .expect(403);
      expect(res.body.error).toBe('CsrfError');
    });

    it('rejects POST when the X-CSRF-Token header is wrong', async () => {
      const { cookieJar } = await issueTokens(app);
      const res = await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .set(SANCTUARY_CSRF_HEADER_NAME, 'tampered-csrf-token')
        .expect(403);
      expect(res.body.error).toBe('CsrfError');
    });

    it('accepts POST when the X-CSRF-Token header matches the issued token', async () => {
      const { cookieJar, csrfHeader } = await issueTokens(app);
      await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .set(SANCTUARY_CSRF_HEADER_NAME, csrfHeader)
        .expect(200, { ok: true, method: 'POST' });
    });

    it('accepts PUT/PATCH/DELETE with valid header', async () => {
      const { cookieJar, csrfHeader } = await issueTokens(app);
      await request(app)
        .put('/test/protected')
        .set('Cookie', cookieJar)
        .set(SANCTUARY_CSRF_HEADER_NAME, csrfHeader)
        .expect(200);
      await request(app)
        .patch('/test/protected')
        .set('Cookie', cookieJar)
        .set(SANCTUARY_CSRF_HEADER_NAME, csrfHeader)
        .expect(200);
      await request(app)
        .delete('/test/protected')
        .set('Cookie', cookieJar)
        .set(SANCTUARY_CSRF_HEADER_NAME, csrfHeader)
        .expect(200);
    });

    it('rejects when X-CSRF-Token is delivered as duplicate headers (Node merges them into a comma-joined string that does not match either token)', async () => {
      const { cookieJar, csrfHeader } = await issueTokens(app);
      // When supertest .set is called with an array, Node concatenates the
      // values into "<a>, <b>" because X-CSRF-Token is not on the http
      // array-allow list. Neither the joined value nor either constituent
      // matches the issued token's expected exact value, so csrf-csrf
      // rejects. This is the right behavior — a misconfigured proxy injecting
      // a second token must not be allowed to validate as the first.
      const res = await request(app)
        .post('/test/protected')
        .set('Cookie', cookieJar)
        .set(SANCTUARY_CSRF_HEADER_NAME, [csrfHeader, 'second-bogus-value'] as unknown as string)
        .expect(403);
      expect(res.body.error).toBe('CsrfError');
    });

    it('rejects when a CSRF token issued for one access cookie is replayed against a different access cookie', async () => {
      // Tokens are bound to the access cookie value via getSessionIdentifier,
      // so swapping the access cookie out from under a token must invalidate it.
      const issued = await issueTokens(app, 'access-cookie-A');
      const otherCookies = await issueTokens(app, 'access-cookie-B');
      // Send the CSRF header from session A but the access cookie from session B.
      const accessB = otherCookies.cookieJar.find((c) => c.startsWith(`${SANCTUARY_ACCESS_COOKIE_NAME}=`));
      const csrfA = issued.cookieJar.find((c) => c.startsWith(`${SANCTUARY_CSRF_COOKIE_NAME}=`));
      if (!accessB || !csrfA) throw new Error('expected both cookies');

      const res = await request(app)
        .post('/test/protected')
        .set('Cookie', [accessB, csrfA])
        .set(SANCTUARY_CSRF_HEADER_NAME, issued.csrfHeader)
        .expect(403);
      expect(res.body.error).toBe('CsrfError');
    });
  });
});
