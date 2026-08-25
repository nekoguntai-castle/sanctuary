import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-for-csrf-recovery-tests-32+chars';
  process.env.NODE_ENV = 'test';
  process.env.CLIENT_URL = 'http://localhost:3000';
  process.env.CORS_ALLOWED_ORIGINS = 'https://admin.example.com';
});

import { errorHandler } from '../../../src/errors/errorHandler';
import {
  clearAuthCookies,
  csrfRecoveryErrorHandler,
  doubleCsrfProtection,
  generateCsrfToken,
  SANCTUARY_ACCESS_COOKIE_NAME,
  SANCTUARY_CSRF_COOKIE_NAME,
  SANCTUARY_CSRF_HEADER_NAME,
} from '../../../src/middleware/csrf';
import { createCsrfRecoveryErrorHandler } from '../../../src/middleware/csrfRecovery';

const TRUSTED_ORIGIN = 'http://localhost:3000';
const CREDENTIAL_PATHS = [
  '/api/v1/auth/register',
  '/api/v1/auth/login',
  '/api/v1/auth/2fa/verify',
  '/api/v1/auth/refresh',
] as const;

type AppHarness = {
  app: Express;
  credentialHandler: ReturnType<typeof vi.fn>;
  destructiveHandler: ReturnType<typeof vi.fn>;
};

function buildApp(): AppHarness {
  const app = express();
  const credentialHandler = vi.fn((_req, res) => res.status(204).end());
  const destructiveAuth = (req: Request, res: Response, next: NextFunction) => {
    if (req.cookies?.[SANCTUARY_ACCESS_COOKIE_NAME] === 'invalid-access') {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  };
  const destructiveHandler = vi.fn((_req, res) => {
    clearAuthCookies(res);
    res.json({ success: true });
  });

  app.use(express.json());
  app.use(cookieParser());

  app.get('/test/issue-token', (req, res) => {
    const accessToken = String(req.query.access ?? 'access-A');
    req.cookies = {
      ...(req.cookies ?? {}),
      [SANCTUARY_ACCESS_COOKIE_NAME]: accessToken,
    };
    const csrfToken = generateCsrfToken(req, res, { overwrite: true });
    res.json({ csrfToken });
  });

  app.use(doubleCsrfProtection);
  app.use(csrfRecoveryErrorHandler);

  for (const path of CREDENTIAL_PATHS) {
    app.post(path, credentialHandler);
  }
  app.post('/api/v1/auth/logout', destructiveAuth, destructiveHandler);
  app.post('/api/v1/auth/logout-all', destructiveAuth, destructiveHandler);
  app.post('/api/v1/wallets/protected', credentialHandler);
  app.use(errorHandler);

  return { app, credentialHandler, destructiveHandler };
}

function authCookies(options: { access?: string; csrf?: string } = {}): string[] {
  const cookies: string[] = [];
  if (options.access !== undefined) {
    cookies.push(`${SANCTUARY_ACCESS_COOKIE_NAME}=${options.access}`);
  }
  if (options.csrf !== undefined) {
    cookies.push(`${SANCTUARY_CSRF_COOKIE_NAME}=${options.csrf}`);
  }
  return cookies;
}

function clearedCookieNames(response: request.Response): string[] {
  const headers = response.headers['set-cookie'];
  const values = Array.isArray(headers) ? headers : headers ? [headers] : [];
  return values
    .filter((header) => /Expires=Thu, 01 Jan 1970 00:00:00 GMT/i.test(header))
    .map((header) => header.slice(0, header.indexOf('=')));
}

async function issueCsrfToken(app: Express, access: string): Promise<string> {
  const response = await request(app)
    .get('/test/issue-token')
    .query({ access })
    .expect(200);
  return response.body.csrfToken as string;
}

function invalidCsrfError(): Error {
  return Object.assign(new Error('invalid csrf token'), {
    code: 'EBADCSRFTOKEN',
    statusCode: 403,
  });
}

function recoveryRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: 'POST',
    originalUrl: '/api/v1/auth/login',
    protocol: 'http',
    headers: { origin: TRUSTED_ORIGIN },
    cookies: {},
    get: ((name: string) => name.toLowerCase() === 'host' ? 'localhost:3000' : undefined),
    ...overrides,
  } as Request;
}

describe('CSRF stale-session recovery boundary', () => {
  let harness: AppHarness;

  beforeEach(() => {
    harness = buildApp();
  });

  it('forwards non-CSRF errors unchanged', () => {
    const next = vi.fn() as unknown as NextFunction;
    const error = new Error('different middleware failure');
    const handler = createCsrfRecoveryErrorHandler(vi.fn());

    handler(error, recoveryRequest(), {} as Response, next);

    expect(next).toHaveBeenCalledWith(error);
  });

  it.each([
    ['missing access cookie', {}],
    ['wrong method', { method: 'PUT', cookies: { sanctuary_access: 'access' } }],
    ['selected bearer', {
      headers: { origin: TRUSTED_ORIGIN, authorization: 'Bearer selected-token' },
      cookies: { sanctuary_access: 'access' },
    }],
  ])('forwards an invalid CSRF error for %s', (_label, overrides) => {
    const next = vi.fn() as unknown as NextFunction;
    const error = invalidCsrfError();
    const clearCookies = vi.fn();
    const handler = createCsrfRecoveryErrorHandler(clearCookies);

    handler(error, recoveryRequest(overrides as Partial<Request>), {} as Response, next);

    expect(next).toHaveBeenCalledWith(error);
    expect(clearCookies).not.toHaveBeenCalled();
  });

  it.each(CREDENTIAL_PATHS)(
    'rejects the first stale credential request, clears all auth cookies, and does not run %s',
    async (path) => {
      const response = await request(harness.app)
        .post(path)
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', authCookies({ access: 'stale-access' }))
        .send({ preserved: 'body' })
        .expect(403);

      expect(response.body).toMatchObject({
        error: 'AuthCsrfSessionStale',
        code: 'AUTH_CSRF_SESSION_STALE',
      });
      expect(clearedCookieNames(response).sort()).toEqual([
        'sanctuary_access',
        'sanctuary_csrf',
        'sanctuary_refresh',
      ]);
      expect(harness.credentialHandler).not.toHaveBeenCalled();
    },
  );

  it.each([
    '/api/v1/auth/login/',
    '/api/v1/auth/login?source=browser',
  ])('normalizes a route-equivalent v1 credential endpoint: %s', async (path) => {
    const response = await request(harness.app)
      .post(path)
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ access: 'stale-access' }))
      .send({})
      .expect(403);

    expect(response.body.code).toBe('AUTH_CSRF_SESSION_STALE');
    expect(clearedCookieNames(response)).toHaveLength(3);
  });

  it('classifies an echoed CSRF cookie that is bound to the previous access token', async () => {
    const oldCsrf = await issueCsrfToken(harness.app, 'access-A');

    const response = await request(harness.app)
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ access: 'access-B', csrf: oldCsrf }))
      .set(SANCTUARY_CSRF_HEADER_NAME, oldCsrf)
      .send({ username: 'alice', password: 'secret' })
      .expect(403);

    expect(response.body.code).toBe('AUTH_CSRF_SESSION_STALE');
    expect(clearedCookieNames(response)).toHaveLength(3);
    expect(harness.credentialHandler).not.toHaveBeenCalled();
  });

  it.each(['/api/v1/auth/logout', '/api/v1/auth/logout-all'])(
    'continues a classified destruction-only request into the real route: %s',
    async (path) => {
      const response = await request(harness.app)
        .post(path)
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', authCookies({ access: 'stale-access' }))
        .send({})
        .expect(200);

      expect(response.body).toEqual({ success: true });
      expect(harness.destructiveHandler).toHaveBeenCalledOnce();
      expect(clearedCookieNames(response)).toHaveLength(3);
    },
  );

  it.each(['/api/v1/auth/logout', '/api/v1/auth/logout-all'])(
    'clears a classified stale pair before invalid access authentication rejects %s',
    async (path) => {
      const response = await request(harness.app)
        .post(path)
        .set('Origin', TRUSTED_ORIGIN)
        .set('Cookie', authCookies({ access: 'invalid-access' }))
        .send({})
        .expect(401);

      expect(clearedCookieNames(response).sort()).toEqual([
        'sanctuary_access',
        'sanctuary_csrf',
        'sanctuary_refresh',
      ]);
      expect(harness.destructiveHandler).not.toHaveBeenCalled();
    },
  );

  it('does not continue logout when a present CSRF cookie has no header', async () => {
    const response = await request(harness.app)
      .post('/api/v1/auth/logout')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ access: 'stale-access', csrf: 'present-csrf' }))
      .send({})
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(clearedCookieNames(response)).toEqual([]);
    expect(harness.destructiveHandler).not.toHaveBeenCalled();
  });

  it.each([
    ['originless', undefined],
    ['opaque null', 'null'],
    ['malformed', 'not a URL'],
    ['sibling', 'http://evil.localhost:3000'],
    ['wrong scheme', 'https://localhost:3000'],
    ['wrong port', 'http://localhost:3001'],
  ])('does not recover a %s origin', async (_label, origin) => {
    let pending = request(harness.app)
      .post('/api/v1/auth/login')
      .set('Cookie', authCookies({ access: 'stale-access' }))
      .send({});
    if (origin) {
      pending = pending.set('Origin', origin);
    }
    const response = await pending.expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(clearedCookieNames(response)).toEqual([]);
    expect(harness.credentialHandler).not.toHaveBeenCalled();
  });

  it.each([
    ['missing header', undefined],
    ['wrong header', 'wrong-token'],
  ])('does not clear when the CSRF cookie exists with a %s', async (_label, header) => {
    let pending = request(harness.app)
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ access: 'stale-access', csrf: 'present-csrf' }))
      .send({});
    if (header) {
      pending = pending.set(SANCTUARY_CSRF_HEADER_NAME, header);
    }
    const response = await pending.expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(clearedCookieNames(response)).toEqual([]);
  });

  it('never recovers a protected application mutation', async () => {
    const response = await request(harness.app)
      .post('/api/v1/wallets/protected')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ access: 'stale-access' }))
      .send({})
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(clearedCookieNames(response)).toEqual([]);
    expect(harness.credentialHandler).not.toHaveBeenCalled();
  });

  it('preserves Authorization-header precedence even when stale cookies are present', async () => {
    await request(harness.app)
      .post('/api/v1/wallets/protected')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Authorization', 'Bearer authoritative-header-token')
      .set('Cookie', authCookies({ access: 'stale-access' }))
      .send({})
      .expect(204);

    expect(harness.credentialHandler).toHaveBeenCalledOnce();
  });

  it('uses cookie recovery when a malformed Authorization header cannot be selected', async () => {
    const response = await request(harness.app)
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Authorization', 'Basic not-a-bearer-token')
      .set('Cookie', authCookies({ access: 'stale-access' }))
      .send({})
      .expect(403);

    expect(response.body.code).toBe('AUTH_CSRF_SESSION_STALE');
    expect(clearedCookieNames(response)).toHaveLength(3);
  });

  it('does not classify an orphan CSRF cookie without an access cookie', async () => {
    await request(harness.app)
      .post('/api/v1/auth/login')
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ csrf: 'orphan-csrf' }))
      .send({})
      .expect(204);

    expect(harness.credentialHandler).toHaveBeenCalledOnce();
  });

  it.each([
    '/api/v1/auth/login-extra',
    '/api/v2/auth/login',
    '/api/v01/auth/login',
    '/api/v1/auth//login',
    '/api/v1/auth/%2flogin',
  ])('does not recover an endpoint near-miss: %s', async (path) => {
    const response = await request(harness.app)
      .post(path)
      .set('Origin', TRUSTED_ORIGIN)
      .set('Cookie', authCookies({ access: 'stale-access' }))
      .send({})
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(clearedCookieNames(response)).toEqual([]);
  });
});
