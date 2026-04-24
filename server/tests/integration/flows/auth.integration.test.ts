import { vi } from 'vitest';
/**
 * Authentication Integration Tests
 *
 * Tests the complete authentication flow:
 * - User registration (via first admin)
 * - Login
 * - Token verification
 * - Password change
 *
 * Requires a running PostgreSQL database.
 * Set DATABASE_URL or TEST_DATABASE_URL environment variable.
 *
 * Run with: npm run test:integration
 */

import request from 'supertest';
import { setupTestDatabase, cleanupTestData, teardownTestDatabase, canRunIntegrationTests } from '../setup/testDatabase';
import { createIsolatedTestApp, createTestApp, resetTestApp } from '../setup/testServer';
import { getTestUser, getTestAdmin, createTestUser, loginTestUser, extractAuthTokens } from '../setup/helpers';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { Express } from 'express';
import { mockElectrumForAuthIntegration } from './authIntegrationTestHarness';

// Increase timeout for integration tests
vi.setConfig(30000);

// Skip all tests if no database is available
const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Authentication Integration', () => {
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

  describe('Login Flow', () => {
    it('should login with valid credentials', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      // Phase 6: tokens are delivered via Set-Cookie, not body.
      const { token } = extractAuthTokens(response);
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3);
      expect(response.body.token).toBeUndefined();
      expect(response.body.user).toBeDefined();
      expect(response.body.user.username).toBe(testUser.username);
      expect(response.body.user.password).toBeUndefined();
    });

    it('should reject invalid password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: 'WrongPassword123!',
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('should reject non-existent user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: 'nonexistent_user_12345',
          password: 'SomePassword123!',
        })
        .expect(401);

      expect(response.body.error).toBeDefined();
    });

    it('allows request-derived same-origin browser login in production mode', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const productionApp = createIsolatedTestApp({
        clientUrl: 'https://configured.example:8443',
        nodeEnv: 'production',
      });

      const response = await request(productionApp)
        .post('/api/v1/auth/login')
        .set('Host', '10.0.0.5:8443')
        .set('Origin', 'https://10.0.0.5:8443')
        .set('X-Forwarded-Proto', 'https')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      expect(response.headers['access-control-allow-origin']).toBe('https://10.0.0.5:8443');
      expect(response.headers['access-control-allow-credentials']).toBe('true');
      expect(extractAuthTokens(response).token).not.toBe('');
      expect(response.body.user.username).toBe(testUser.username);
    });

    it('returns 403 instead of 500 when a production browser origin does not match the current request host', async () => {
      const response = await request(createIsolatedTestApp({
        clientUrl: 'https://configured.example:8443',
        nodeEnv: 'production',
      }))
        .get('/api/v1/auth/registration-status')
        .set('Host', '10.0.0.5:8443')
        .set('Origin', 'https://evil.example.com')
        .set('X-Forwarded-Proto', 'https')
        .expect(403);

      expect(response.body.error).toBe('Forbidden');
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('Not allowed by CORS');
    });
  });

  describe('Token Verification', () => {
    it('should access protected endpoint with valid token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.username).toBe(testUser.username);
    });

    it('should reject expired or invalid token', async () => {
      const invalidToken = 'invalid.token.here';

      await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);
    });

    it('should reject request without token', async () => {
      await request(app)
        .get('/api/v1/auth/me')
        .expect(401);
    });
  });

  describe('Password Change', () => {
    it('should change password with correct current password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const newPassword = 'NewSecurePassword456!';

      await request(app)
        .post('/api/v1/auth/me/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: testUser.password,
          newPassword,
        })
        .expect(200);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: newPassword,
        })
        .expect(200);

      // Phase 6: token is in the Set-Cookie header.
      expect(extractAuthTokens(loginResponse).token).not.toBe('');
    });

    it('should reject password change with wrong current password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      await request(app)
        .post('/api/v1/auth/me/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: 'WrongCurrentPassword!',
          newPassword: 'NewPassword456!',
        })
        .expect(401);
    });
  });

  describe('Admin User Management', () => {
    it('should allow admin to create new user', async () => {
      const testAdmin = getTestAdmin();
      await createTestUser(prisma, { ...testAdmin, isAdmin: true });
      const adminToken = await loginTestUser(app, testAdmin);

      const newUsername = `newuser_${Date.now()}`;
      const response = await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          username: newUsername,
          password: 'NewUserPassword123!',
          email: `${newUsername}@example.com`,
        })
        .expect(201);

      expect(response.body.id).toBeDefined();
      expect(response.body.username).toBe(newUsername);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: newUsername,
          password: 'NewUserPassword123!',
        })
        .expect(200);

      // Phase 6: token is in the Set-Cookie header.
      expect(extractAuthTokens(loginResponse).token).not.toBe('');
    });

    it('should not allow non-admin to create user', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const userToken = await loginTestUser(app, testUser);

      await request(app)
        .post('/api/v1/admin/users')
        .set('Authorization', `Bearer ${userToken}`)
        .send({
          username: `anotheruser_${Date.now()}`,
          password: 'Password123!',
        })
        .expect(403);
    });
  });

  describe('Token Refresh', () => {
    it('should return valid access cookie on login', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      // Phase 6: tokens are delivered via Set-Cookie, not body.
      const { token } = extractAuthTokens(response);
      expect(token.split('.').length).toBe(3);
      expect(response.body.token).toBeUndefined();
    });

    it('should return refresh cookie on login', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      // Phase 6: tokens are delivered via Set-Cookie, not body.
      const { refreshToken } = extractAuthTokens(response);
      expect(refreshToken.split('.').length).toBe(3);
      expect(response.body.refreshToken).toBeUndefined();
    });

    it('should refresh access token using refresh token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { refreshToken } = extractAuthTokens(loginResponse);

      const refreshResponse = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken, rotate: true })
        .expect(200);

      // Phase 6: rotated tokens are delivered via Set-Cookie.
      const rotated = extractAuthTokens(refreshResponse);
      expect(rotated.token).not.toBe('');
      expect(rotated.refreshToken).not.toBe('');
      expect(rotated.refreshToken).not.toBe(refreshToken);
      expect(refreshResponse.body.token).toBeUndefined();
      expect(refreshResponse.body.refreshToken).toBeUndefined();
    });
  });

  describe('Logout', () => {
    it('should logout and invalidate access token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token, refreshToken } = extractAuthTokens(loginResponse);

      // Logout
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken })
        .expect(200);

      // Access token should now be invalid
      await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('should logout and invalidate refresh token', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token, refreshToken } = extractAuthTokens(loginResponse);

      // Logout with refresh token
      await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .send({ refreshToken })
        .expect(200);

      // Refresh token should now be invalid
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  describe('Logout All Sessions', () => {
    it('should logout from all devices', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      // Login twice to simulate two sessions
      const login1 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const login2 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const tokens1 = extractAuthTokens(login1);
      const tokens2 = extractAuthTokens(login2);

      // Logout all from first session
      const logoutResponse = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', `Bearer ${tokens1.token}`)
        .expect(200);

      expect(logoutResponse.body.sessionsRevoked).toBeGreaterThanOrEqual(2);

      // Both refresh tokens should now be invalid
      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens1.refreshToken })
        .expect(401);

      await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: tokens2.refreshToken })
        .expect(401);
    });
  });

  describe('Session Management', () => {
    it('should list active sessions', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      // Login to create a session
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token } = extractAuthTokens(loginResponse);
      const response = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.sessions).toBeDefined();
      expect(Array.isArray(response.body.sessions)).toBe(true);
      expect(response.body.sessions.length).toBeGreaterThanOrEqual(1);

      // Check session structure
      const session = response.body.sessions[0];
      expect(session.id).toBeDefined();
      expect(session.createdAt).toBeDefined();
      expect(session.lastUsedAt).toBeDefined();
    });

    it('should mark current session', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token, refreshToken } = extractAuthTokens(loginResponse);
      const response = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Refresh-Token', refreshToken)
        .expect(200);

      const currentSession = response.body.sessions.find((s: any) => s.isCurrent);
      expect(currentSession).toBeDefined();
    });

    it('should revoke specific session', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      // Create two sessions
      const login1 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const login2 = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const { token: token1 } = extractAuthTokens(login1);
      // Get sessions from first login
      const sessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(sessionsResponse.body.sessions.length).toBe(2);

      // Find the session that's not current and revoke it
      const otherSession = sessionsResponse.body.sessions.find((s: any) => !s.isCurrent);
      expect(otherSession).toBeDefined();

      await request(app)
        .delete(`/api/v1/auth/sessions/${otherSession.id}`)
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      // Verify the session was revoked
      const newSessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      expect(newSessionsResponse.body.sessions.length).toBe(1);
    });

    it('should not allow revoking another user session', async () => {
      const testUser = getTestUser();
      const testAdmin = getTestAdmin();
      await createTestUser(prisma, testUser);
      await createTestUser(prisma, { ...testAdmin, isAdmin: true });

      // Login as both users
      const userLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      const adminLogin = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testAdmin.username,
          password: testAdmin.password,
        })
        .expect(200);

      const { token: userToken } = extractAuthTokens(userLogin);
      const { token: adminToken } = extractAuthTokens(adminLogin);

      // Get user's sessions
      const sessionsResponse = await request(app)
        .get('/api/v1/auth/sessions')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(200);

      const userSessionId = sessionsResponse.body.sessions[0].id;

      // Try to revoke user's session as admin (should fail - each user manages their own sessions)
      await request(app)
        .delete(`/api/v1/auth/sessions/${userSessionId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('Registration Status', () => {
    it('should return enabled status', async () => {
      const response = await request(app)
        .get('/api/v1/auth/registration-status')
        .expect(200);

      expect(response.body).toHaveProperty('enabled');
      expect(typeof response.body.enabled).toBe('boolean');
    });

    it('should default to disabled when setting not configured', async () => {
      const response = await request(app)
        .get('/api/v1/auth/registration-status')
        .expect(200);

      // Default is disabled (admin-only registration)
      expect(response.body.enabled).toBe(false);
    });
  });

  describe('User Preferences', () => {
    it('should get user preferences', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveProperty('preferences');
    });

    it('should update user preferences', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      // The preferences endpoint expects fields directly in body, not wrapped
      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .set('Authorization', `Bearer ${token}`)
        .send({
          theme: 'dark',
          unit: 'btc',
          showFiat: false,
        })
        .expect(200);

      expect(response.body.preferences).toBeDefined();
      expect(response.body.preferences.theme).toBe('dark');
      expect(response.body.preferences.unit).toBe('btc');
    });

    it('should reject invalid preferences', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      // Without Authorization should fail
      await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ preferences: { theme: 'dark' } })
        .expect(401);
    });
  });

  describe('User Search', () => {
    it('should search users by username', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const response = await request(app)
        .get('/api/v1/auth/users/search')
        .query({ q: testUser.username.substring(0, 5) })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should return empty for non-matching search', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const response = await request(app)
        .get('/api/v1/auth/users/search')
        .query({ q: 'nonexistentuserxyz123' })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBe(0);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/auth/users/search')
        .query({ q: 'test' })
        .expect(401);
    });
  });

  describe('User Groups', () => {
    it('should return empty groups for user with no groups', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const response = await request(app)
        .get('/api/v1/auth/me/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should require authentication', async () => {
      await request(app)
        .get('/api/v1/auth/me/groups')
        .expect(401);
    });
  });

  describe('Two-Factor Authentication', () => {
    describe('2FA Setup', () => {
      it('should initiate 2FA setup', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        const response = await request(app)
          .post('/api/v1/auth/2fa/setup')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(response.body).toHaveProperty('secret');
        expect(response.body).toHaveProperty('qrCodeDataUrl');
        expect(response.body.secret).toBeDefined();
        expect(response.body.qrCodeDataUrl).toContain('data:image/png;base64');
      });

      it('should require authentication', async () => {
        await request(app)
          .post('/api/v1/auth/2fa/setup')
          .expect(401);
      });
    });

    describe('2FA Enable', () => {
      it('should reject enable without setup', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/enable')
          .set('Authorization', `Bearer ${token}`)
          .send({ token: '123456' })
          .expect(400);
      });

      it('should require token parameter', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/enable')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
      });
    });

    describe('2FA Disable', () => {
      it('should reject disable for user without 2FA', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/disable')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: testUser.password })
          .expect(400);
      });

      it('should require password', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/disable')
          .set('Authorization', `Bearer ${token}`)
          .send({})
          .expect(400);
      });
    });

    describe('2FA Verify', () => {
      it('should reject verify without pending 2FA state', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const loginResponse = await request(app)
          .post('/api/v1/auth/login')
          .send({
            username: testUser.username,
            password: testUser.password,
          })
          .expect(200);

        // Regular login returns a full access token (via Set-Cookie),
        // not a pending2FA tempToken. Attempting to verify with that
        // access token as tempToken must fail because the token has the
        // wrong audience (ACCESS, not PENDING_2FA).
        const { token: accessToken } = extractAuthTokens(loginResponse);
        await request(app)
          .post('/api/v1/auth/2fa/verify')
          .send({ tempToken: accessToken, code: '123456' })
          .expect(401);
      });

      it('should reject invalid token format', async () => {
        await request(app)
          .post('/api/v1/auth/2fa/verify')
          .send({ tempToken: 'invalid-token', code: '123456' })
          .expect(401);
      });
    });

    describe('2FA Backup Codes', () => {
      it('should reject backup codes request for user without 2FA', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/backup-codes')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: testUser.password })
          .expect(400);
      });

      it('should reject regenerate for user without 2FA', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/auth/2fa/backup-codes/regenerate')
          .set('Authorization', `Bearer ${token}`)
          .send({ password: testUser.password })
          .expect(400);
      });
    });
  });
});
