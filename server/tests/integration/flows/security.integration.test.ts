import { vi } from 'vitest';
/**
 * Security Integration Tests
 *
 * Integration tests that validate security controls in a real environment.
 * Tests authentication flows, password policies, and access controls.
 *
 * Requires a running PostgreSQL database.
 * Set DATABASE_URL or TEST_DATABASE_URL environment variable.
 *
 * Run with: npm run test:integration
 */

import request from 'supertest';
import { setupTestDatabase, cleanupTestData, teardownTestDatabase, canRunIntegrationTests } from '../setup/testDatabase';
import { createTestApp, resetTestApp } from '../setup/testServer';
import { getTestUser, getTestAdmin, createTestUser, loginTestUser, extractAuthTokens } from '../setup/helpers';
import { PrismaClient } from '../../../src/generated/prisma/client';
import { Express } from 'express';
import bcrypt from 'bcryptjs';

// Increase timeout for integration tests
vi.setConfig(30000);

// Skip all tests if no database is available
const describeWithDb = canRunIntegrationTests() ? describe : describe.skip;

describeWithDb('Security Integration Tests', () => {
  let app: Express;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Mock external services before importing routes
    vi.doMock('../../../src/services/bitcoin/electrum', () => ({
      getElectrumClient: vi.fn().mockResolvedValue({
        connect: vi.fn().mockResolvedValue(undefined),
        isConnected: vi.fn().mockReturnValue(true),
        blockchainScripthash_getBalance: vi.fn().mockResolvedValue({ confirmed: 0, unconfirmed: 0 }),
        blockchainScripthash_listunspent: vi.fn().mockResolvedValue([]),
        blockchainScripthash_getHistory: vi.fn().mockResolvedValue([]),
      }),
    }));

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

  // ==========================================================================
  // CRITICAL: Default Password Warning Tests
  // ==========================================================================
  describe('CRITICAL: Default Password Detection', () => {
    const DEFAULT_PASSWORD = 'sanctuary';

    it('should return usingDefaultPassword=true when user logs in with default password', async () => {
      // Create user with the default password
      const hashedDefaultPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      const username = `defaultpwd_${Date.now()}`;

      const user = await prisma.user.create({
        data: {
          username,
          password: hashedDefaultPassword,
          email: `${username}@example.com`,
          emailVerified: true,
          isAdmin: false,
          preferences: {},
        },
      });

      // Create the initialPassword system setting that the detection relies on
      await prisma.systemSetting.create({
        data: {
          key: `initialPassword_${user.id}`,
          value: hashedDefaultPassword,
        },
      });

      // Login with default password
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username,
          password: DEFAULT_PASSWORD,
        })
        .expect(200);

      // Should include the warning flag
      expect(response.body.user).toBeDefined();
      expect(response.body.user.usingDefaultPassword).toBe(true);
    });

    it('should return usingDefaultPassword=false when user uses custom password', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      expect(response.body.user).toBeDefined();
      expect(response.body.user.usingDefaultPassword).toBe(false);
    });

    it('should detect default password on GET /auth/me endpoint', async () => {
      // Create user with default password
      const hashedDefaultPassword = await bcrypt.hash(DEFAULT_PASSWORD, 10);
      const username = `defaultpwd_me_${Date.now()}`;

      const user = await prisma.user.create({
        data: {
          username,
          password: hashedDefaultPassword,
          email: `${username}@example.com`,
          emailVerified: true,
          isAdmin: false,
          preferences: {},
        },
      });

      // Create the initialPassword system setting that the detection relies on
      await prisma.systemSetting.create({
        data: {
          key: `initialPassword_${user.id}`,
          value: hashedDefaultPassword,
        },
      });

      // Login
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ username, password: DEFAULT_PASSWORD })
        .expect(200);

      const { token } = extractAuthTokens(loginResponse);

      // Check /me endpoint
      const meResponse = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(meResponse.body.usingDefaultPassword).toBe(true);
    });
  });

  // ==========================================================================
  // HIGH: Password Policy Tests
  // ==========================================================================
  describe('HIGH: Password Policy Enforcement', () => {
    describe('Admin user creation password requirements', () => {
      it('should reject passwords shorter than 8 characters for admin-created users', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const username = `shortpwd_${Date.now()}`;
        const response = await request(app)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username,
            password: 'Abc123!', // 7 characters - should fail
            email: `${username}@example.com`,
          })
          .expect(400);

        expect(response.body.error).toBe('InvalidInput');
        expect(response.body.message).toContain('does not meet security requirements');
      });

      it('should accept passwords meeting security requirements (8+ chars with complexity)', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        // Strong password: 8+ chars with uppercase, lowercase, and number
        const username = `strongpwd_${Date.now()}`;
        const response = await request(app)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username,
            password: 'Abcd1234', // 8 characters with complexity - accepted
            email: `${username}@example.com`,
          })
          .expect(201);

        expect(response.body.id).toBeDefined();
      });
    });

    describe('Password change requirements', () => {
      it('should reject weak password that does not meet strength requirements', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        const response = await request(app)
          .post('/api/v1/auth/me/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send({
            currentPassword: testUser.password,
            newPassword: 'Ab1!', // Too short and doesn't meet requirements
          })
          .expect(400);

        // Password change now uses same validation as registration
        expect(response.body.error).toBe('InvalidInput');
        expect(response.body.message).toBe('Password does not meet requirements');
      });

      it('should allow password change with 6+ character password', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        const newPassword = 'NewPwd123!';

        await request(app)
          .post('/api/v1/auth/me/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send({
            currentPassword: testUser.password,
            newPassword,
          })
          .expect(200);

        // Verify new password works
        await request(app)
          .post('/api/v1/auth/login')
          .send({
            username: testUser.username,
            password: newPassword,
          })
          .expect(200);
      });
    });
  });

  // ==========================================================================
  // HIGH: Authentication Security Tests
  // ==========================================================================
  describe('HIGH: Authentication Security', () => {
    describe('Login error messages should be generic', () => {
      it('should return same error for non-existent user as wrong password', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);

        // Wrong password for existing user
        const wrongPasswordResponse = await request(app)
          .post('/api/v1/auth/login')
          .send({
            username: testUser.username,
            password: 'WrongPassword123!',
          })
          .expect(401);

        // Non-existent user
        const nonExistentResponse = await request(app)
          .post('/api/v1/auth/login')
          .send({
            username: 'nonexistent_user_xyz_12345',
            password: 'SomePassword123!',
          })
          .expect(401);

        // Same error message prevents username enumeration
        expect(wrongPasswordResponse.body.message).toBe('Invalid username or password');
        expect(nonExistentResponse.body.message).toBe('Invalid username or password');
      });
    });

    describe('Password not exposed in responses', () => {
      it('should not include password hash in login response', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);

        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({
            username: testUser.username,
            password: testUser.password,
          })
          .expect(200);

        expect(response.body.user).toBeDefined();
        expect(response.body.user.password).toBeUndefined();
        expect(response.body.user.passwordHash).toBeUndefined();
      });

      it('should not include password hash in /me response', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        const response = await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expect(response.body.password).toBeUndefined();
        expect(response.body.passwordHash).toBeUndefined();
      });

      it('should not include password hash in admin user list', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const response = await request(app)
          .get('/api/v1/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(Array.isArray(response.body)).toBe(true);
        response.body.forEach((user: any) => {
          expect(user.password).toBeUndefined();
          expect(user.passwordHash).toBeUndefined();
        });
      });
    });
  });

  // ==========================================================================
  // MEDIUM: Access Control Tests
  // ==========================================================================
  describe('MEDIUM: Access Control', () => {
    describe('Admin-only endpoints', () => {
      it('should reject non-admin from admin user list', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const userToken = await loginTestUser(app, testUser);

        await request(app)
          .get('/api/v1/admin/users')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });

      it('should reject non-admin from creating users', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const userToken = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${userToken}`)
          .send({
            username: 'newuser',
            password: 'Password123!',
          })
          .expect(403);
      });

      it('should reject non-admin from system settings', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const userToken = await loginTestUser(app, testUser);

        await request(app)
          .get('/api/v1/admin/settings')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });
    });

    describe('Unauthenticated access', () => {
      it('should reject unauthenticated access to protected endpoints', async () => {
        // These endpoints require authentication
        await request(app).get('/api/v1/auth/me').expect(401);
        await request(app).get('/api/v1/wallets').expect(401);
        await request(app).get('/api/v1/devices').expect(401);
        await request(app).get('/api/v1/admin/users').expect(401);
      });

      it('should reject requests with invalid token', async () => {
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', 'Bearer invalid.token.here')
          .expect(401);
      });

      it('should reject requests with malformed authorization header', async () => {
        await request(app)
          .get('/api/v1/auth/me')
          .set('Authorization', 'NotBearer token')
          .expect(401);
      });
    });
  });

  // ==========================================================================
  // MEDIUM: Input Validation Tests
  // ==========================================================================
  describe('MEDIUM: Input Validation', () => {
    describe('Username validation', () => {
      it('should reject username shorter than 3 characters for admin-created users', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const response = await request(app)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username: 'ab', // 2 characters
            password: 'Password123!',
            email: `ab_${Date.now()}@example.com`,
          })
          .expect(400);

        expect(response.body.message).toContain('3 characters');
      });
    });

    describe('Required fields validation', () => {
      it('should require username for login', async () => {
        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({ password: 'SomePassword123!' })
          .expect(400);

        expect(response.body.message).toContain('required');
      });

      it('should require password for login', async () => {
        const response = await request(app)
          .post('/api/v1/auth/login')
          .send({ username: 'someuser' })
          .expect(400);

        expect(response.body.message).toContain('required');
      });

      it('should require both fields for password change', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const token = await loginTestUser(app, testUser);

        // Missing current password
        await request(app)
          .post('/api/v1/auth/me/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send({ newPassword: 'NewPassword123!' })
          .expect(400);

        // Missing new password
        await request(app)
          .post('/api/v1/auth/me/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send({ currentPassword: testUser.password })
          .expect(400);
      });
    });

    describe('Duplicate username handling', () => {
      it('should reject duplicate username on admin user creation', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const username = `duplicate_${Date.now()}`;
        const email = `${username}@example.com`;

        // Create first user
        await request(app)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username,
            password: 'Password123!',
            email,
          })
          .expect(201);

        // Try to create duplicate
        const response = await request(app)
          .post('/api/v1/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            username,
            password: 'Password123!',
            email: `${username}_2@example.com`, // Different email but same username
          })
          .expect(409);

        expect(response.body.message).toContain('already exists');
      });
    });
  });

  // ==========================================================================
  // Token Security Tests
  // ==========================================================================
  describe('Token Security', () => {
    it('should generate valid JWT tokens on login', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password,
        })
        .expect(200);

      // Phase 6: token is delivered via Set-Cookie, not body.
      const { token } = extractAuthTokens(response);
      // JWT has 3 parts separated by dots
      expect(token.split('.').length).toBe(3);
      expect(response.body.token).toBeUndefined();
    });

    it('should reject access with wrong password after password change', async () => {
      const testUser = getTestUser();
      await createTestUser(prisma, testUser);
      const token = await loginTestUser(app, testUser);

      const newPassword = 'NewSecurePassword123!';

      // Change password
      await request(app)
        .post('/api/v1/auth/me/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({
          currentPassword: testUser.password,
          newPassword,
        })
        .expect(200);

      // Old password should not work
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: testUser.password, // Old password
        })
        .expect(401);

      // New password should work
      await request(app)
        .post('/api/v1/auth/login')
        .send({
          username: testUser.username,
          password: newPassword,
        })
        .expect(200);
    });
  });

  // ==========================================================================
  // Admin Self-Protection Tests
  // ==========================================================================
  describe('Admin Self-Protection', () => {
    it('should prevent admin from deleting their own account', async () => {
      const testAdmin = getTestAdmin();
      const { id: adminId } = await createTestUser(prisma, { ...testAdmin, isAdmin: true });
      const adminToken = await loginTestUser(app, testAdmin);

      const response = await request(app)
        .delete(`/api/v1/admin/users/${adminId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.message).toContain('Cannot delete your own account');
    });
  });

  // ==========================================================================
  // HIGH: Price Cache Admin-Only Endpoints
  // ==========================================================================
  describe('HIGH: Price Cache Admin-Only Endpoints', () => {
    describe('GET /price/cache/stats', () => {
      it('should reject unauthenticated requests', async () => {
        await request(app)
          .get('/api/v1/price/cache/stats')
          .expect(401);
      });

      it('should reject non-admin users', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const userToken = await loginTestUser(app, testUser);

        await request(app)
          .get('/api/v1/price/cache/stats')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });

      it('should allow admin users', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const response = await request(app)
          .get('/api/v1/price/cache/stats')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(response.body).toBeDefined();
        expect(typeof response.body.size).toBe('number');
      });
    });

    describe('POST /price/cache/clear', () => {
      it('should reject unauthenticated requests', async () => {
        await request(app)
          .post('/api/v1/price/cache/clear')
          .expect(401);
      });

      it('should reject non-admin users', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const userToken = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/price/cache/clear')
          .set('Authorization', `Bearer ${userToken}`)
          .expect(403);
      });

      it('should allow admin users to clear cache', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const response = await request(app)
          .post('/api/v1/price/cache/clear')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expect(response.body.message).toContain('cleared');
      });
    });

    describe('POST /price/cache/duration', () => {
      it('should reject unauthenticated requests', async () => {
        await request(app)
          .post('/api/v1/price/cache/duration')
          .send({ duration: 60000 })
          .expect(401);
      });

      it('should reject non-admin users', async () => {
        const testUser = getTestUser();
        await createTestUser(prisma, testUser);
        const userToken = await loginTestUser(app, testUser);

        await request(app)
          .post('/api/v1/price/cache/duration')
          .set('Authorization', `Bearer ${userToken}`)
          .send({ duration: 60000 })
          .expect(403);
      });

      it('should allow admin users to set cache duration', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        const response = await request(app)
          .post('/api/v1/price/cache/duration')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ duration: 120000 })
          .expect(200);

        expect(response.body.message).toContain('updated');
        expect(response.body.duration).toBe(120000);
      });

      it('should reject invalid duration values', async () => {
        const testAdmin = getTestAdmin();
        await createTestUser(prisma, { ...testAdmin, isAdmin: true });
        const adminToken = await loginTestUser(app, testAdmin);

        // Negative duration
        await request(app)
          .post('/api/v1/price/cache/duration')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ duration: -1000 })
          .expect(400);

        // Non-number duration
        await request(app)
          .post('/api/v1/price/cache/duration')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ duration: 'invalid' })
          .expect(400);
      });
    });
  });
});
