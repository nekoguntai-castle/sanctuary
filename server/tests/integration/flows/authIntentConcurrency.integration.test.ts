import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHash } from 'crypto';
import type { Express } from 'express';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import { SystemSettingKeys } from '../../../src/repositories';
import { updateEmailWithVerification, verifyEmail } from '../../../src/services/email/emailVerificationService';
import { hashBackupCodes } from '../../../src/services/twoFactorService';
import { generate2FAToken } from '../../../src/utils/jwt';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import {
  createTestUser,
  getTestUser,
  loginTestUserWithTokens,
} from '../setup/helpers';

vi.setConfig({ testTimeout: 30000 });

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

async function releaseTogether<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = tasks.map(async (task) => {
    await gate;
    return task();
  });
  release();
  return Promise.all(started);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describeWithDb('Auth intent concurrency integration', () => {
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
  });

  it('allows only one concurrent refresh-token rotation for the same old token', async () => {
    const testUser = getTestUser();
    const { id: userId } = await createTestUser(prisma, testUser);
    const { refreshToken } = await loginTestUserWithTokens(app, testUser);

    const responses = await releaseTogether([
      () => request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
      () => request(app).post('/api/v1/auth/refresh').send({ refreshToken }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    const replayResponse = responses.find((response) => response.status === 401);
    expect(replayResponse?.headers['set-cookie']).toBeUndefined();
    const storedTokens = await prisma.refreshToken.findMany({ where: { userId } });
    expect(storedTokens).toHaveLength(1);
    expect(storedTokens[0].tokenHash).not.toBe(hashToken(refreshToken));
  });

  it('allows only one concurrent 2FA backup-code verification to issue a session', async () => {
    const testUser = getTestUser();
    const { id: userId } = await createTestUser(prisma, testUser);
    const backupCode = 'ABCD1234';
    await prisma.user.update({
      where: { id: userId },
      data: {
        twoFactorEnabled: true,
        twoFactorSecret: 'JBSWY3DPEHPK3PXP',
        twoFactorBackupCodes: await hashBackupCodes([backupCode]),
      },
    });
    const tempToken = generate2FAToken({
      userId,
      username: testUser.username,
      isAdmin: false,
      sessionVersion: 0,
    });

    const responses = await releaseTogether([
      () => request(app).post('/api/v1/auth/2fa/verify').send({ tempToken, code: backupCode }),
      () => request(app).post('/api/v1/auth/2fa/verify').send({ tempToken, code: backupCode }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    await expect(prisma.refreshToken.findMany({ where: { userId } })).resolves.toHaveLength(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const backupCodes = JSON.parse(user.twoFactorBackupCodes ?? '[]') as Array<{ used: boolean }>;
    expect(backupCodes).toHaveLength(1);
    expect(backupCodes[0].used).toBe(true);
  });

  it('allows only one concurrent email verification token consumption', async () => {
    const testUser = getTestUser();
    const { id: userId } = await createTestUser(prisma, testUser);
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: false, emailVerifiedAt: null },
    });
    const rawToken = `verify-${Date.now()}`;
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        email: testUser.email,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });

    const results = await releaseTogether([
      () => verifyEmail(rawToken),
      () => verifyEmail(rawToken),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(1);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.emailVerified).toBe(true);
    const storedToken = await prisma.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash: hashToken(rawToken) },
    });
    expect(storedToken.usedAt).toBeInstanceOf(Date);
  });

  it('invalidates old email intents before an SMTP-disabled email update can leave stale takeover tokens', async () => {
    const testUser = getTestUser();
    const { id: userId } = await createTestUser(prisma, testUser);
    const oldToken = `old-email-${Date.now()}`;
    await prisma.user.update({
      where: { id: userId },
      data: { emailVerified: false, emailVerifiedAt: null },
    });
    await prisma.emailVerificationToken.create({
      data: {
        userId,
        email: testUser.email,
        tokenHash: hashToken(oldToken),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
    await prisma.systemSetting.deleteMany({
      where: {
        key: {
          in: [
            SystemSettingKeys.SMTP_HOST,
            SystemSettingKeys.SMTP_FROM_ADDRESS,
          ],
        },
      },
    });

    const newEmail = `new-${testUser.email}`;
    const updateResult = await updateEmailWithVerification(userId, newEmail, testUser.username);
    expect(updateResult.verification.success).toBe(false);
    expect(updateResult.verification.error).toBe('SMTP not configured');

    await expect(verifyEmail(oldToken)).resolves.toEqual({
      success: false,
      error: 'INVALID_TOKEN',
    });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.email).toBe(newEmail);
    expect(user.emailVerified).toBe(false);
  });
});
