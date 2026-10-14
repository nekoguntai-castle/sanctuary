/**
 * Pre-auth verification resend (POST /auth/email/resend-pending)
 *
 * Unverified users never get a session, so the resend has to work from
 * credentials alone. Every outcome returns the identical 202 so the route is
 * neither an account oracle nor a password oracle.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const {
  mockEmailService,
  mockUserRepository,
  mockAuditService,
  mockRateLimitService,
  mockLog,
} = vi.hoisted(() => ({
  mockEmailService: {
    verifyEmail: vi.fn(),
    resendVerification: vi.fn(),
    updateEmailWithVerification: vi.fn(),
    isVerificationRequired: vi.fn(),
    assertEmailChangeDeliverable: vi.fn(),
  },
  mockUserRepository: {
    findById: vi.fn(),
    findByUsername: vi.fn(),
    emailExists: vi.fn(),
  },
  mockAuditService: {
    auditService: { log: vi.fn().mockResolvedValue(undefined) },
    AuditAction: {
      AUTH_EMAIL_VERIFICATION_SENT: 'auth.email_verification_sent',
      AUTH_EMAIL_VERIFIED: 'auth.email_verified',
      AUTH_EMAIL_VERIFICATION_FAILED: 'auth.email_verification_failed',
      USER_EMAIL_UPDATED: 'user.email_updated',
    },
    AuditCategory: { AUTH: 'auth', USER: 'user' },
    getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test-agent' }),
  },
  mockRateLimitService: { rateLimitService: { consume: vi.fn() } },
  mockLog: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../src/services/email', () => mockEmailService);
vi.mock('../../../src/repositories', () => ({ userRepository: mockUserRepository }));
vi.mock('../../../src/services/auditService', () => mockAuditService);
vi.mock('../../../src/services/rateLimiting', () => mockRateLimitService);
vi.mock('../../../src/utils/password', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(async () => '$2b$10$runtimeDummyHashFixture'),
}));
vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: vi.fn(),
  authenticate: vi.fn(),
}));
vi.mock('../../../src/utils/logger', () => ({ createLogger: () => mockLog }));

import { hashPassword, verifyPassword } from '../../../src/utils/password';
import { createEmailRouter } from '../../../src/api/auth/email';
import { errorHandler } from '../../../src/errors/errorHandler';

const EXPECTED_BODY = {
  success: true,
  message: 'If the account needs verification, a new email has been sent.',
};

const loginLimiter = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());
const resendPendingLimiter = vi.fn((_req: express.Request, _res: express.Response, next: express.NextFunction) => next());

function createTestApp(routerFactory: typeof createEmailRouter = createEmailRouter) {
  const app = express();
  app.use(express.json());
  const noop = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next();
  app.use('/api/v1/auth', routerFactory(noop, noop, noop, {
    login: loginLimiter,
    resendPending: resendPendingLimiter,
  }));
  app.use(errorHandler);
  return app;
}

describe('POST /api/v1/auth/email/resend-pending', () => {
  const unverifiedUser = {
    id: 'user-1',
    username: 'alice',
    password: 'hashed',
    email: 'alice@example.com',
    emailVerified: false,
  };
  let app: express.Application;

  const post = (body: Record<string, unknown> = { username: 'Alice', password: 'pw' }) =>
    request(app).post('/api/v1/auth/email/resend-pending').send(body);

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
    mockUserRepository.findByUsername.mockResolvedValue(unverifiedUser);
    vi.mocked(verifyPassword).mockResolvedValue(true);
    mockEmailService.isVerificationRequired.mockResolvedValue(true);
    mockEmailService.resendVerification.mockResolvedValue({ success: true, expiresAt: new Date() });
    mockRateLimitService.rateLimitService.consume.mockResolvedValue({
      allowed: true, remaining: 4, limit: 5, resetAt: Date.now() + 1000,
    });
  });

  /** A fresh module instance, so the once-per-process dummy hash starts empty. */
  async function freshModuleApp() {
    vi.resetModules();
    const fresh = await import('../../../src/api/auth/email');
    return createTestApp(fresh.createEmailRouter);
  }

  function expectNoSend(response: request.Response) {
    expect(response.status).toBe(202);
    expect(response.body).toEqual(EXPECTED_BODY);
    expect(mockEmailService.resendVerification).not.toHaveBeenCalled();
    expect(mockAuditService.auditService.log).not.toHaveBeenCalled();
  }

  it('sends a fresh verification email for valid credentials of an unverified user', async () => {
    const response = await post();

    expect(response.status).toBe(202);
    expect(response.body).toEqual(EXPECTED_BODY);
    expect(mockUserRepository.findByUsername).toHaveBeenCalledWith('alice');
    expect(mockRateLimitService.rateLimitService.consume).toHaveBeenCalledWith('auth:email-resend', 'user:user-1');
    await vi.waitFor(() => expect(mockAuditService.auditService.log).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      action: 'auth.email_verification_sent',
    })));
    expect(mockEmailService.resendVerification).toHaveBeenCalledWith('user-1');
  });

  it('runs the login and resend-pending limiters', async () => {
    await post();

    expect(loginLimiter).toHaveBeenCalledTimes(1);
    expect(resendPendingLimiter).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed body without leaking account state', async () => {
    const response = await post({ username: 'alice' });

    expect(response.status).toBe(400);
    expect(mockEmailService.resendVerification).not.toHaveBeenCalled();
  });

  it('returns the identical 202 and sends nothing for a wrong password, without consuming the bucket', async () => {
    vi.mocked(verifyPassword).mockResolvedValue(false);

    expectNoSend(await post());
    expect(mockRateLimitService.rateLimitService.consume).not.toHaveBeenCalled();
  });

  it('returns the identical 202 for an unknown user and still runs a password comparison', async () => {
    mockUserRepository.findByUsername.mockResolvedValue(null);
    vi.mocked(verifyPassword).mockResolvedValue(false);

    app = await freshModuleApp();

    expectNoSend(await post());
    expectNoSend(await post());
    // A runtime hash (no committed secret), computed once per process.
    expect(verifyPassword).toHaveBeenNthCalledWith(1, 'pw', '$2b$10$runtimeDummyHashFixture');
    expect(verifyPassword).toHaveBeenNthCalledWith(2, 'pw', '$2b$10$runtimeDummyHashFixture');
    expect(hashPassword).toHaveBeenCalledTimes(1);
  });

  it('retries the dummy hash after a failure instead of caching the rejection', async () => {
    mockUserRepository.findByUsername.mockResolvedValue(null);
    vi.mocked(verifyPassword).mockResolvedValue(false);
    app = await freshModuleApp();
    vi.mocked(hashPassword).mockRejectedValueOnce(new Error('bcrypt unavailable'));

    expect((await post()).status).toBe(500);
    expectNoSend(await post());
    expect(hashPassword).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['has no email', { email: null }],
    ['is already verified', { emailVerified: true }],
  ])('returns the identical 202 and sends nothing when the user %s', async (_name, overrides) => {
    mockUserRepository.findByUsername.mockResolvedValue({ ...unverifiedUser, ...overrides });

    expectNoSend(await post());
  });

  it('returns the identical 202 and sends nothing when verification is not required', async () => {
    mockEmailService.isVerificationRequired.mockResolvedValue(false);

    expectNoSend(await post());
  });

  it('returns the identical 202 (not 429) and sends nothing when the per-user bucket is exhausted', async () => {
    mockRateLimitService.rateLimitService.consume.mockResolvedValue({
      allowed: false, remaining: 0, limit: 5, resetAt: Date.now() + 1000, retryAfter: 60,
    });

    expectNoSend(await post());
  });

  it('returns the identical 202 (not 500), logs a warning and sends nothing when the limiter throws', async () => {
    mockRateLimitService.rateLimitService.consume.mockRejectedValue(new Error('Redis rate limiter unavailable'));

    expectNoSend(await post());
    expect(mockLog.warn).toHaveBeenCalledWith(
      expect.stringContaining('resend'),
      expect.objectContaining({ error: 'Redis rate limiter unavailable' })
    );
  });

  it('returns the identical 202 without an audit row when the resend itself reports failure', async () => {
    mockEmailService.resendVerification.mockResolvedValue({ success: false, error: 'SMTP not configured' });

    const response = await post();

    expect(response.status).toBe(202);
    expect(response.body).toEqual(EXPECTED_BODY);
    await vi.waitFor(() => expect(mockEmailService.resendVerification).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockAuditService.auditService.log).not.toHaveBeenCalled();
  });

  it('answers before the send finishes, so latency does not reveal a correct password', async () => {
    mockEmailService.resendVerification.mockReturnValue(new Promise(() => undefined));

    const response = await post().timeout(2000);

    expect(response.status).toBe(202);
    expect(response.body).toEqual(EXPECTED_BODY);
  });

  it('returns the identical 202 (not 500) when the post-send audit write throws', async () => {
    mockAuditService.auditService.log.mockRejectedValueOnce(new Error('audit db down'));

    const response = await post();

    expect(response.status).toBe(202);
    expect(response.body).toEqual(EXPECTED_BODY);
    await vi.waitFor(() => expect(mockAuditService.auditService.log).toHaveBeenCalledTimes(1));
  });
});
