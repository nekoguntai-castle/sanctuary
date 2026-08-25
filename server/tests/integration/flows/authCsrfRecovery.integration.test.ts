import type { Express } from 'express';
import request from 'supertest';
import { vi } from 'vitest';

import config from '../../../src/config';
import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  canRunIntegrationTests,
  cleanupTestData,
  setupTestDatabase,
  teardownTestDatabase,
} from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { createTestUser, extractAuthTokens, getTestUser } from '../setup/helpers';
import { mockElectrumForAuthIntegration } from './authIntegrationTestHarness';

vi.setConfig({ testTimeout: 30000 });

const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Authentication CSRF stale-session recovery', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    mockElectrumForAuthIntegration();
    prisma = await setupTestDatabase();
    app = createTestApp();
  });

  afterAll(async () => {
    resetTestApp();
    await teardownTestDatabase();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await cleanupTestData();
  });

  it.each([
    ['/api/v1/auth/register', {
      username: 'should_not_be_created',
      password: 'StrongP@ssword123',
      email: 'should-not-be-created@example.com',
    }],
    ['/api/v1/auth/login', {
      username: 'should_not_authenticate',
      password: 'StrongP@ssword123',
    }],
    ['/api/v1/auth/2fa/verify', {
      tempToken: 'should-not-be-consumed',
      code: '123456',
    }],
    ['/api/v1/auth/refresh', {}],
  ] as const)(
    'rejects and clears before executing the real credential handler: %s',
    async (path, body) => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: testUser.username, password: testUser.password })
        .expect(200);
      const { token, refreshToken } = extractAuthTokens(loginResponse);
      const countsBefore = {
        users: await prisma.user.count(),
        refreshTokens: await prisma.refreshToken.count(),
        auditLogs: await prisma.auditLog.count(),
      };

      const staleResponse = await request(app)
        .post(path)
        .set('Origin', config.clientUrl)
        .set('Cookie', [`sanctuary_access=${token}`])
        .send(path.endsWith('/refresh') ? { refreshToken } : body)
        .expect(403);

      expect(staleResponse.body).toMatchObject({
        error: 'AuthCsrfSessionStale',
        code: 'AUTH_CSRF_SESSION_STALE',
      });
      expect(staleResponse.headers['set-cookie']).toEqual(expect.arrayContaining([
        expect.stringMatching(/^sanctuary_access=;/),
        expect.stringMatching(/^sanctuary_refresh=;/),
        expect.stringMatching(/^sanctuary_csrf=;/),
      ]));
      expect({
        users: await prisma.user.count(),
        refreshTokens: await prisma.refreshToken.count(),
        auditLogs: await prisma.auditLog.count(),
      }).toEqual(countsBefore);

      if (path.endsWith('/refresh')) {
        await request(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken })
          .expect(200);
      }
    },
  );

  it('keeps a protected unsafe route as an ordinary 403 without clearing cookies', async () => {
    const testUser = getTestUser();
    await createTestUser(prisma, testUser);
    const loginResponse = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: testUser.username, password: testUser.password })
      .expect(200);
    const { token } = extractAuthTokens(loginResponse);

    const response = await request(app)
      .patch('/api/v1/auth/me/preferences')
      .set('Origin', config.clientUrl)
      .set('Cookie', [`sanctuary_access=${token}`])
      .send({ unit: 'btc' })
      .expect(403);

    expect(response.body.code).toBe('FORBIDDEN');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each(['/api/v1/auth/logout', '/api/v1/auth/logout-all'])(
    'clears stale browser cookies even when authentication rejects %s',
    async (path) => {
      const response = await request(app)
        .post(path)
        .set('Origin', config.clientUrl)
        .set('Cookie', ['sanctuary_access=invalid-access-token'])
        .send({})
        .expect(401);

      expect(response.headers['set-cookie']).toEqual(expect.arrayContaining([
        expect.stringMatching(/^sanctuary_access=;/),
        expect.stringMatching(/^sanctuary_refresh=;/),
        expect.stringMatching(/^sanctuary_csrf=;/),
      ]));
    },
  );
});
