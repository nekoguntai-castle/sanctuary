import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
/**
 * 2FA per-account attempt cap (Redis-backed)
 *
 * The per-IP limiter is mocked globally in integration tests, and the shared
 * integration server never initialises the rate limiter (consume would throw
 * and verify fails closed with 503). This suite initialises the real Redis
 * limiter so the cap itself is observable.
 *
 * Requires PostgreSQL and Redis (REDIS_URL). Skipped without REDIS_URL unless
 * SANCTUARY_REQUIRE_REDIS_INTEGRATION=true, which fails at collection.
 */

import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '../../../../src/generated/prisma/client';
import { initializeRedis, shutdownRedis } from '../../../../src/infrastructure/redis';
import { rateLimitService } from '../../../../src/services/rateLimiting';
import { TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE } from '../../../../src/services/rateLimiting/policyMessages';
import { generate2FAToken } from '../../../../src/utils/jwt';
import { canRunIntegrationTests, cleanupTestData, setupTestDatabase, teardownTestDatabase } from '../../setup/testDatabase';
import { describeWithRedis } from '../../setup/redis';
import { createTestApp, resetTestApp } from '../../setup/testServer';
import { createTestUser, getTestUser } from '../../setup/helpers';

vi.setConfig({ testTimeout: 30000 });

const ATTEMPT_CAP = 10;

describeWithRedis('2FA per-account rate limit (Redis)', () => {
  const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

  describeWithDb('POST /auth/2fa/verify', () => {
    let app: Express;
    let prisma: PrismaClient;

    beforeAll(async () => {
      prisma = await setupTestDatabase();
      await initializeRedis();
      rateLimitService.initialize();
      app = createTestApp();
    });

    afterAll(async () => {
      resetTestApp();
      await shutdownRedis();
      await teardownTestDatabase();
    });

    beforeEach(async () => {
      await cleanupTestData();
    });

    it('caps wrong-code attempts per account and returns 429 with Retry-After', async () => {
      const testUser = getTestUser();
      const { id: userId } = await createTestUser(prisma, testUser);
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true, twoFactorSecret: 'JBSWY3DPEHPK3PXP' },
      });
      const tempToken = generate2FAToken({
        userId,
        username: testUser.username,
        isAdmin: false,
        sessionVersion: 0,
      });

      for (let attempt = 1; attempt <= ATTEMPT_CAP; attempt += 1) {
        const response = await request(app)
          .post('/api/v1/auth/2fa/verify')
          .set('X-Forwarded-For', `203.0.113.${attempt}`)
          .send({ tempToken, code: '000000' });
        expect(response.status).toBe(401);
      }

      const blocked = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .set('X-Forwarded-For', '203.0.113.200')
        .send({ tempToken, code: '000000' });

      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toBe(TWO_FA_ACCOUNT_RATE_LIMIT_MESSAGE);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });
  });
});
