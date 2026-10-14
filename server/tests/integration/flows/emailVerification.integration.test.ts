import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * Email verification flows (real tokens, real database)
 *
 * Unverified users never receive a session, so completing verification and
 * requesting a new link both have to work without one:
 * - register -> login 403 -> pre-auth resend -> verify -> login
 * - change email -> login 403 -> pre-auth resend -> verify -> login
 *
 * Only the token hash is stored, so the raw token is captured from the mocked
 * mail transport.
 *
 * Requires a running PostgreSQL database.
 */

import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { rateLimitService } from '../../../src/services/rateLimiting';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { createTestUser, getTestUser, loginTestUser } from '../setup/helpers';

vi.setConfig({ testTimeout: 30000 });

const sentMail = vi.hoisted(() => ({ messages: [] as Array<{ to: string; text: string }> }));

// Plain functions (not vi.fn): restoreMocks would reset a vi.fn implementation.
vi.mock('../../../src/services/email/emailService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/email/emailService')>();
  return {
    ...actual,
    isSmtpConfigured: async () => true,
    sendEmail: async (message: { to: string; text: string }) => {
      sentMail.messages.push(message);
      return { success: true };
    },
  };
});

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;
const SETTING_KEYS = ['registrationEnabled', 'email.verificationRequired'];

function lastMailedToken(): string {
  const message = sentMail.messages[sentMail.messages.length - 1];
  const match = /\/#\/verify-email\?token=([A-Za-z0-9_-]+)/.exec(message?.text ?? '');
  if (!match) throw new Error('No verification token in the last mail');
  return match[1];
}

describeWithDb('Email verification flows', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    await cleanupTestData();
    sentMail.messages.length = 0;
    // The integration server never initialises the limiter, so the in-handler
    // consume would throw and skip the send. spyOn is restored per test.
    vi.spyOn(rateLimitService, 'consume').mockResolvedValue({
      allowed: true, remaining: 4, limit: 5, resetAt: Date.now() + 1000,
    });
  });

  async function setSystemSetting(key: string, value: string): Promise<void> {
    await prisma.systemSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
  }

  async function resendPending(credentials: { username: string; password: string }, expectMail = true) {
    const sentBefore = sentMail.messages.length;
    const response = await request(app).post('/api/v1/auth/email/resend-pending').send(credentials);
    expect(response.status).toBe(202);
    // The send runs after the response, so wait for it.
    if (expectMail) await vi.waitFor(() => expect(sentMail.messages.length).toBeGreaterThan(sentBefore));
    return response;
  }

  async function expectLoginBlocked(credentials: { username: string; password: string }) {
    const response = await request(app).post('/api/v1/auth/login').send(credentials);
    expect(response.status).toBe(403);
    expect(response.body.emailVerificationRequired).toBe(true);
    expect(response.body.canResend).toBe(true);
  }

  async function verifyStaleThenFresh(staleToken: string) {
    // resend-pending replaced every unused token, so the earlier one is dead.
    const stale = await request(app).post('/api/v1/auth/email/verify').send({ token: staleToken });
    expect(stale.status).toBe(400);
    expect(stale.body.details?.code ?? stale.body.code).toBeDefined();
    await request(app).post('/api/v1/auth/email/verify').send({ token: lastMailedToken() }).expect(200);
  }

  it('lets a self-registered user resend and verify without a session', async () => {
    const testUser = getTestUser();
    await setSystemSetting('registrationEnabled', 'true');
    await setSystemSetting('email.verificationRequired', 'true');

    try {
      await request(app).post('/api/v1/auth/register').send(testUser).expect(201);
      const registrationToken = lastMailedToken();
      await expectLoginBlocked(testUser);

      await resendPending(testUser);
      expect(sentMail.messages).toHaveLength(2);
      expect(lastMailedToken()).not.toBe(registrationToken);

      await verifyStaleThenFresh(registrationToken);
      expect(await loginTestUser(app, testUser)).not.toBe('');
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    }
  });

  it('lets a user who changed their email resend and verify, ending up on the new address', async () => {
    const testUser = getTestUser();
    await createTestUser(prisma, testUser);
    await setSystemSetting('email.verificationRequired', 'true');

    try {
      const token = await loginTestUser(app, testUser);
      const newEmail = `new-${testUser.email}`;
      await request(app)
        .put('/api/v1/auth/me/email')
        .set('Authorization', `Bearer ${token}`)
        .send({ email: newEmail, password: testUser.password })
        .expect(200);
      const changeToken = lastMailedToken();
      await expectLoginBlocked(testUser);

      await resendPending(testUser);
      expect(sentMail.messages).toHaveLength(2);

      await verifyStaleThenFresh(changeToken);
      expect(await loginTestUser(app, testUser)).not.toBe('');
      const user = await prisma.user.findUniqueOrThrow({ where: { username: testUser.username } });
      expect(user.email).toBe(newEmail);
      expect(user.emailVerified).toBe(true);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    }
  });

  it('returns the identical 202 and sends nothing for a wrong password or an unknown user', async () => {
    const testUser = getTestUser();
    await createTestUser(prisma, testUser);
    await prisma.user.update({
      where: { username: testUser.username },
      data: { emailVerified: false, emailVerifiedAt: null },
    });
    await setSystemSetting('email.verificationRequired', 'true');

    try {
      const wrongPassword = await resendPending({ username: testUser.username, password: 'WrongPassword123!' }, false);
      const unknownUser = await resendPending({ username: 'no_such_user_xyz', password: 'WrongPassword123!' }, false);

      expect(wrongPassword.body).toEqual(unknownUser.body);
      expect(sentMail.messages).toHaveLength(0);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    }
  });

  it('returns the identical 202 and sends nothing when the per-user limiter throws', async () => {
    const testUser = getTestUser();
    await createTestUser(prisma, testUser);
    await prisma.user.update({
      where: { username: testUser.username },
      data: { emailVerified: false, emailVerifiedAt: null },
    });
    await setSystemSetting('email.verificationRequired', 'true');
    vi.mocked(rateLimitService.consume).mockRejectedValue(new Error('Redis rate limiter unavailable'));

    try {
      await resendPending(testUser, false);
      await vi.waitFor(() => expect(rateLimitService.consume).toHaveBeenCalled());
      await new Promise((resolve) => setImmediate(resolve));
      expect(sentMail.messages).toHaveLength(0);
    } finally {
      await prisma.systemSetting.deleteMany({ where: { key: { in: SETTING_KEYS } } });
    }
  });
});
