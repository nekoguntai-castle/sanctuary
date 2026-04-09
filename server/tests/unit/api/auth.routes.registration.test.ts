import { vi } from 'vitest';
/**
 * Auth API Route Tests — Registration, Login, Password, Tokens
 *
 * Tests for profile, sessions, registration, login, password change,
 * token management (refresh/logout/logout-all) routes.
 */

import {
  mockPrismaClient,
  resetPrismaMocks,
  mockIsVerificationRequired,
  mockIsSmtpConfigured,
  mockCreateVerificationToken,
  createAuthTestApp,
} from './auth.testHelpers';

// Mock Prisma BEFORE other imports
vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

// Mock config - use vi.hoisted to make mockConfig available at hoist time
const mockConfig = vi.hoisted(() => ({
  jwtSecret: 'test-jwt-secret-key-for-testing-only',
  jwtExpiresIn: '1h',
  jwtRefreshExpiresIn: '7d',
  gatewaySecret: '',
  corsAllowedOrigins: [],
  nodeEnv: 'test',
  rateLimit: {
    enabled: false,
    windowMs: 60000,
    maxRequests: 100,
  },
}));

vi.mock('../../../src/config', () => ({
  __esModule: true,
  default: mockConfig,
  getConfig: () => mockConfig,
}));

// Mock token revocation service to prevent database initialization
vi.mock('../../../src/services/tokenRevocation', () => ({
  isTokenRevoked: vi.fn().mockResolvedValue(false),
  revokeToken: vi.fn().mockResolvedValue(undefined),
  revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
  initializeRevocationService: vi.fn(),
  shutdownRevocationService: vi.fn(),
}));

// Mock audit service
vi.mock('../../../src/services/auditService', () => ({
  auditService: {
    log: vi.fn().mockResolvedValue(undefined),
    logFromRequest: vi.fn().mockResolvedValue(undefined),
  },
  AuditAction: {
    LOGIN: 'LOGIN',
    LOGIN_FAILED: 'LOGIN_FAILED',
    PASSWORD_CHANGE: 'PASSWORD_CHANGE',
    TWO_FACTOR_SETUP: 'TWO_FACTOR_SETUP',
    TWO_FACTOR_ENABLED: 'TWO_FACTOR_ENABLED',
    TWO_FACTOR_DISABLED: 'TWO_FACTOR_DISABLED',
    TWO_FACTOR_VERIFIED: 'TWO_FACTOR_VERIFIED',
    TWO_FACTOR_FAILED: 'TWO_FACTOR_FAILED',
    TWO_FACTOR_BACKUP_CODE_USED: 'TWO_FACTOR_BACKUP_CODE_USED',
    TWO_FACTOR_BACKUP_CODES_REGENERATED: 'TWO_FACTOR_BACKUP_CODES_REGENERATED',
  },
  AuditCategory: {
    AUTH: 'AUTH',
  },
  getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

// Mock email service for verification functions
vi.mock('../../../src/services/email', () => ({
  isVerificationRequired: () => mockIsVerificationRequired(),
  isSmtpConfigured: () => mockIsSmtpConfigured(),
  createVerificationToken: (...args: unknown[]) => mockCreateVerificationToken(...args),
}));

// Mock rate limiting middleware to allow requests through in tests
vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  rateLimitByIpAndKey: (_key?: string, extractKey?: (req: any) => string | undefined) =>
    (req: unknown, _res: unknown, next: () => void) => {
      if (extractKey) {
        extractKey(req as any);
      }
      next();
    },
  rateLimitByUser: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Mock auth middleware for route tests
vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    const omitUsername = req.headers['x-test-no-username'] === '1';
    req.user = omitUsername
      ? { userId: 'test-user-id', isAdmin: false }
      : { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
  requireAdmin: (req: any, res: any, next: any) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (!req.user.isAdmin) {
      return res.status(403).json({ error: 'Forbidden', message: 'Admin access required' });
    }
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => {
    // Optional auth doesn't fail - just continues without user
    next();
  },
}));

// Mock refresh token service
vi.mock('../../../src/services/refreshTokenService', () => ({
  getUserSessions: vi.fn(),
  revokeSession: vi.fn(),
  createRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
  verifyRefreshTokenExists: vi.fn().mockResolvedValue(true),
  rotateRefreshToken: vi.fn().mockResolvedValue('new-refresh-token'),
  revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
  revokeAllUserRefreshTokens: vi.fn().mockResolvedValue(5),
}));

// Mock logger for route tests
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock jwt utilities for route tests
vi.mock('../../../src/utils/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/jwt')>();
  return {
    ...actual,
    hashToken: vi.fn().mockReturnValue('hashed-token'),
    verifyRefreshToken: vi.fn().mockResolvedValue({ userId: 'test-user-id', username: 'testuser' }),
    decodeToken: vi.fn().mockReturnValue({ jti: 'token-jti', exp: Math.floor(Date.now() / 1000) + 3600, userId: 'test-user-id' }),
    generate2FAToken: vi.fn().mockReturnValue('mock-2fa-token'),
    verify2FAToken: vi.fn().mockResolvedValue({ userId: 'test-user-id', username: 'testuser', isAdmin: false }),
  };
});

// Mock password utilities for route tests
vi.mock('../../../src/utils/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/password')>();
  return {
    ...actual,
    // Keep original implementations but we can override in specific tests
  };
});

// Mock twoFactorService for route tests
vi.mock('../../../src/services/twoFactorService', () => ({
  generateSecret: vi.fn().mockResolvedValue({ secret: 'mock-secret', qrCodeDataUrl: 'data:image/png;base64,...' }),
  verifyToken: vi.fn().mockReturnValue(true),
  generateBackupCodes: vi.fn().mockReturnValue(['code1', 'code2', 'code3', 'code4', 'code5', 'code6', 'code7', 'code8']),
  hashBackupCodes: vi.fn().mockResolvedValue('[{"hash":"hash1"},{"hash":"hash2"}]'),
  verifyBackupCode: vi.fn().mockResolvedValue({ valid: true, updatedCodesJson: '[]' }),
  getRemainingBackupCodeCount: vi.fn().mockReturnValue(8),
  isBackupCode: vi.fn().mockReturnValue(false),
}));

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock('../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

import request from 'supertest';
import express from 'express';
import { hashPassword } from '../../../src/utils/password';

describe('Auth API Routes — Registration, Login, Password, Tokens', () => {
  let app: express.Application;

  beforeAll(async () => {
    app = await createAuthTestApp();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mockIsVerificationRequired.mockResolvedValue(true);
    mockIsSmtpConfigured.mockResolvedValue(false);
    mockCreateVerificationToken.mockResolvedValue({ success: false });
  });

  // ========================================
  // Profile Routes
  // ========================================

  describe('GET /auth/me - Get Current User', () => {
    it('should return current user without password', async () => {
      const mockUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: { darkMode: true },
        createdAt: new Date(),
        twoFactorEnabled: false,
        password: 'hashed-password-value',
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.username).toBe('testuser');
      expect(response.body.password).toBeUndefined();
      expect(response.body.usingDefaultPassword).toBe(false);
    });

    it('should detect when user is using default password', async () => {
      const mockUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: null,
        createdAt: new Date(),
        twoFactorEnabled: false,
        password: 'initial-password-hash',
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(mockUser);
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_test-user-id',
        value: 'initial-password-hash', // Same as user's current password
      });

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(200);
      expect(response.body.usingDefaultPassword).toBe(true);
    });

    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/me');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('PATCH /auth/me/preferences - Update Preferences', () => {
    it('should update user preferences', async () => {
      const currentUser = {
        preferences: { darkMode: true, theme: 'sanctuary' },
      };

      const updatedUser = {
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        preferences: { darkMode: false, theme: 'sanctuary', unit: 'btc' },
        twoFactorEnabled: false,
        createdAt: new Date(),
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(currentUser);
      mockPrismaClient.user.update.mockResolvedValue(updatedUser);

      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ darkMode: false, unit: 'btc' });

      expect(response.status).toBe(200);
      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          preferences: expect.objectContaining({
            darkMode: false,
            unit: 'btc',
          }),
        },
        select: expect.any(Object),
      });
    });

    it('should merge with default preferences for new users', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ preferences: null });
      mockPrismaClient.user.update.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: null,
        isAdmin: false,
        preferences: { darkMode: true, theme: 'sanctuary', unit: 'sats' },
        twoFactorEnabled: false,
        createdAt: new Date(),
      });

      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ unit: 'sats' });

      expect(response.status).toBe(200);
      // Should include defaults merged with new values
      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'test-user-id' },
        data: {
          preferences: expect.objectContaining({
            darkMode: true, // default
            theme: 'sanctuary', // default
            unit: 'sats', // provided
          }),
        },
        select: expect.any(Object),
      });
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({ preferences: {} });
      mockPrismaClient.user.update.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .patch('/api/v1/auth/me/preferences')
        .send({ darkMode: true });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /auth/me/groups - Get User Groups', () => {
    it('should return user groups', async () => {
      const mockGroups = [
        {
          id: 'group-1',
          name: 'Family',
          description: 'Family group',
          members: [
            { userId: 'test-user-id', role: 'owner' },
            { userId: 'user-2', role: 'member' },
          ],
        },
      ];

      mockPrismaClient.group.findMany.mockResolvedValue(mockGroups);

      const response = await request(app)
        .get('/api/v1/auth/me/groups');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0].name).toBe('Family');
      expect(response.body[0].memberCount).toBe(2);
    });

    it('should return empty array when user has no groups', async () => {
      mockPrismaClient.group.findMany.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/v1/auth/me/groups');

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.group.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/me/groups');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('GET /auth/users/search - Search Users', () => {
    it('should search users by username', async () => {
      const mockUsers = [
        { id: 'user-1', username: 'testuser1' },
        { id: 'user-2', username: 'testuser2' },
      ];

      mockPrismaClient.user.findMany.mockResolvedValue(mockUsers);

      const response = await request(app)
        .get('/api/v1/auth/users/search?q=test');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(2);
      expect(mockPrismaClient.user.findMany).toHaveBeenCalledWith({
        where: {
          username: {
            contains: 'test',
            mode: 'insensitive',
          },
        },
        select: { id: true, username: true },
        take: 10,
      });
    });

    it('should reject query shorter than 2 characters', async () => {
      const response = await request(app)
        .get('/api/v1/auth/users/search?q=a');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('at least 2 characters');
    });

    it('should reject missing query parameter', async () => {
      const response = await request(app)
        .get('/api/v1/auth/users/search');

      expect(response.status).toBe(400);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findMany.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/users/search?q=test');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Sessions Routes
  // ========================================

  describe('GET /auth/sessions - List Sessions', () => {
    it('should return user sessions', async () => {
      const { getUserSessions } = await import('../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      const mockSessions = [
        {
          id: 'session-1',
          deviceName: 'Chrome on Mac',
          userAgent: 'Mozilla/5.0...',
          ipAddress: '192.168.1.1',
          createdAt: new Date('2024-01-01'),
          lastUsedAt: new Date('2024-01-10'),
          isCurrent: true,
        },
        {
          id: 'session-2',
          deviceName: 'Firefox on Windows',
          userAgent: 'Mozilla/5.0...',
          ipAddress: '192.168.1.2',
          createdAt: new Date('2024-01-02'),
          lastUsedAt: new Date('2024-01-08'),
          isCurrent: false,
        },
      ];

      mockGetUserSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/v1/auth/sessions');

      expect(response.status).toBe(200);
      expect(response.body.sessions).toHaveLength(2);
      expect(response.body.count).toBe(2);
      expect(response.body.sessions[0].deviceName).toBe('Chrome on Mac');
      expect(response.body.sessions[0].isCurrent).toBe(true);
    });

    it('should mark current session when refresh token header provided', async () => {
      const { getUserSessions } = await import('../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      mockGetUserSessions.mockResolvedValue([]);

      await request(app)
        .get('/api/v1/auth/sessions')
        .set('X-Refresh-Token', 'some-refresh-token');

      expect(mockGetUserSessions).toHaveBeenCalledWith('test-user-id', 'hashed-token');
    });

    it('should show Unknown Device when deviceName is missing', async () => {
      const { getUserSessions } = await import('../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      const mockSessions = [
        {
          id: 'session-1',
          deviceName: null, // No device name
          userAgent: 'Mozilla/5.0...',
          ipAddress: '192.168.1.1',
          createdAt: new Date('2024-01-01'),
          lastUsedAt: new Date('2024-01-10'),
          isCurrent: false,
        },
      ];

      mockGetUserSessions.mockResolvedValue(mockSessions);

      const response = await request(app)
        .get('/api/v1/auth/sessions');

      expect(response.status).toBe(200);
      expect(response.body.sessions[0].deviceName).toBe('Unknown Device');
    });

    it('should handle service errors gracefully', async () => {
      const { getUserSessions } = await import('../../../src/services/refreshTokenService');
      const mockGetUserSessions = vi.mocked(getUserSessions);

      mockGetUserSessions.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .get('/api/v1/auth/sessions');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('DELETE /auth/sessions/:id - Revoke Session', () => {
    it('should revoke a session', async () => {
      const { revokeSession } = await import('../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);

      mockRevokeSession.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/v1/auth/sessions/session-1');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockRevokeSession).toHaveBeenCalledWith('session-1', 'test-user-id');
    });

    it('should return 404 when session not found', async () => {
      const { revokeSession } = await import('../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);

      mockRevokeSession.mockResolvedValue(false);

      const response = await request(app)
        .delete('/api/v1/auth/sessions/non-existent');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('should audit revoke session with unknown username fallback', async () => {
      const { revokeSession } = await import('../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);
      const { auditService } = await import('../../../src/services/auditService');

      mockRevokeSession.mockResolvedValue(true);

      const response = await request(app)
        .delete('/api/v1/auth/sessions/session-unknown-user')
        .set('X-Test-No-Username', '1');

      expect(response.status).toBe(200);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'unknown',
          details: expect.objectContaining({ sessionId: 'session-unknown-user' }),
        })
      );
    });

    it('should handle service errors gracefully', async () => {
      const { revokeSession } = await import('../../../src/services/refreshTokenService');
      const mockRevokeSession = vi.mocked(revokeSession);

      mockRevokeSession.mockRejectedValue(new Error('Service error'));

      const response = await request(app)
        .delete('/api/v1/auth/sessions/session-1');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Login Routes
  // ========================================

  describe('GET /auth/registration-status - Check Registration Status', () => {
    it('should return enabled when registration is enabled', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(true);
    });

    it('should return disabled when registration is disabled', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'false',
      });

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should return disabled when setting does not exist', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(200);
      expect(response.body.enabled).toBe(false);
    });

    it('should return 500 on error', async () => {
      mockPrismaClient.systemSetting.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .get('/api/v1/auth/registration-status');

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/register - Register New User', () => {
    it('should reject when registration is disabled', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'false',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('Public registration is disabled');
    });

    it('should default to disabled registration when setting is missing', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(403);
      expect(response.body.message).toContain('Public registration is disabled');
    });

    it('should reject when username is missing', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ password: 'StrongPassword123!', email: 'test@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Username, password, and email are required');
    });

    it('should reject weak password', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'weak', email: 'new@example.com' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password does not meet strength requirements');
    });

    it('should reject when username already exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'existing-user-id',
        username: 'existinguser',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'existinguser', password: 'StrongPassword123!', email: 'existing@example.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Username already exists');
    });

    it('should successfully register a new user', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        isAdmin: false,
        preferences: { darkMode: true },
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBe('mock-refresh-token');
      expect(response.body.user.username).toBe('newuser');
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should reject invalid email format', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'invalid-email' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid email');
    });

    it('should reject duplicate email address', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      // First findUnique for username check (not found)
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce(null)
        // Second findUnique for email check (found - duplicate)
        .mockResolvedValueOnce({ id: 'existing-user', email: 'existing@example.com' });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'existing@example.com' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('Email address is already in use');
    });

    it('should create user with emailVerified false', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.user.emailVerified).toBe(false);
    });

    it('should send verification email when SMTP is configured', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });
      mockIsSmtpConfigured.mockResolvedValue(true);
      mockCreateVerificationToken.mockResolvedValue({ success: true });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.emailVerificationRequired).toBe(true);
      expect(response.body.verificationEmailSent).toBe(true);
      expect(mockCreateVerificationToken).toHaveBeenCalledWith(
        'new-user-id',
        'new@example.com',
        'newuser'
      );
    });

    it('should still register when verification email delivery fails', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });
      mockIsSmtpConfigured.mockResolvedValue(true);
      mockCreateVerificationToken.mockResolvedValue({ success: false, error: 'SMTP failure' });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.emailVerificationRequired).toBe(true);
      expect(response.body.verificationEmailSent).toBe(false);
    });

    it('should return a generic success message when verification is not required', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'registrationEnabled',
        value: 'true',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);
      mockPrismaClient.user.create.mockResolvedValue({
        id: 'new-user-id',
        username: 'newuser',
        email: 'new@example.com',
        emailVerified: false,
        isAdmin: false,
        preferences: { darkMode: true },
      });
      mockIsVerificationRequired.mockResolvedValue(false);
      mockIsSmtpConfigured.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ username: 'newuser', password: 'StrongPassword123!', email: 'new@example.com' });

      expect(response.status).toBe(201);
      expect(response.body.emailVerificationRequired).toBe(false);
      expect(response.body.message).toBe('Registration successful.');
    });
  });

  describe('POST /auth/login - User Login', () => {
    it('should reject when username is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Username and password are required');
    });

    it('should reject when password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Username and password are required');
    });

    it('should reject non-existent user', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'nonexistent', password: 'password123' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid username or password');
    });

    it('should reject wrong password', async () => {
      // Create a user with a known hashed password
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'WrongPassword123!' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid username or password');
    });

    it('should return 2FA required when user has 2FA enabled', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'SOME2FASECRET',
      });
      // Mock initial password check
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.requires2FA).toBe(true);
      expect(response.body.tempToken).toBeDefined();
    });

    it('should return token on successful login', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBe('mock-refresh-token');
      expect(response.body.user.username).toBe('testuser');
      expect(response.body.usingDefaultPassword).toBeUndefined();
    });

    it('should block unverified user when verification required', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: false, // Not verified
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
      });
      // isVerificationRequired returns true (default from beforeEach)

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe('Email Not Verified');
      expect(response.body.emailVerificationRequired).toBe(true);
      expect(response.body.email).toBe('test@example.com');
      expect(response.body.canResend).toBe(true);
    });

    // Skip these tests because they hit the rate limiter threshold from previous tests
    it('should allow unverified user when verification not required', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: false, // Not verified but ok
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      // Override default to not require verification
      mockIsVerificationRequired.mockResolvedValue(false);

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
    });

    // Skip this test because it hits the rate limiter threshold from previous tests
    it('should include emailVerified in successful login response', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        username: 'testuser',
        email: 'test@example.com',
        emailVerified: true,
        password: hashedPassword,
        isAdmin: false,
        twoFactorEnabled: false,
        preferences: { darkMode: true },
      });
      // Verification is required, but user is verified so login should succeed

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.user.emailVerified).toBe(true);
    });

    // Skip this test because it hits the rate limiter threshold from previous tests
    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });

    it('should return 500 when login query fails unexpectedly', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: 'testuser', password: 'password123' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  // ========================================
  // Password Routes
  // ========================================

  describe('POST /auth/me/change-password - Change Password', () => {
    it('should reject when current password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Current password and new password are required');
    });

    it('should reject when new password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Current password and new password are required');
    });

    it('should reject weak new password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'weak' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password does not meet requirements');
    });

    it('should reject when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should reject when current password is wrong', async () => {
      const correctPassword = 'CorrectOldPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
      });

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'WrongOldPassword123!', newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Current password is incorrect');
    });

    // Skip these tests because they hit the rate limiter threshold from previous tests
    it('should successfully change password', async () => {
      const correctPassword = 'CorrectOldPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
      });
      mockPrismaClient.user.update.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
      });
      mockPrismaClient.systemSetting.deleteMany.mockResolvedValue({ count: 0 });

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: correctPassword, newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(200);
      expect(response.body.message).toBe('Password changed successfully');
      expect(mockPrismaClient.user.update).toHaveBeenCalled();
    });

    // Skip this test because it hits the rate limiter threshold from previous tests
    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/me/change-password')
        .send({ currentPassword: 'OldPassword123!', newPassword: 'NewStrongPassword123!' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  // ========================================
  // Password Helper Functions
  // ========================================

  describe('isUsingInitialPassword helper', () => {
    it('should return false when no initial password marker exists', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue(null);

      const { isUsingInitialPassword } = await import('../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_user-id',
        value: 'hashed-initial-password',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const { isUsingInitialPassword } = await import('../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });

    it('should return true when password matches initial password', async () => {
      const initialHash = 'initial-password-hash';
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_user-id',
        value: initialHash,
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        password: initialHash, // Same as initial
      });

      const { isUsingInitialPassword } = await import('../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(true);
    });

    it('should return false when password differs from initial', async () => {
      mockPrismaClient.systemSetting.findUnique.mockResolvedValue({
        key: 'initialPassword_user-id',
        value: 'initial-password-hash',
      });
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-id',
        password: 'different-password-hash',
      });

      const { isUsingInitialPassword } = await import('../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });

    it('should return false on database error', async () => {
      mockPrismaClient.systemSetting.findUnique.mockRejectedValue(new Error('Database error'));

      const { isUsingInitialPassword } = await import('../../../src/api/auth/password');
      const result = await isUsingInitialPassword('user-id', 'password');

      expect(result).toBe(false);
    });
  });

  describe('clearInitialPasswordMarker helper', () => {
    it('should delete the initial password marker', async () => {
      mockPrismaClient.systemSetting.delete.mockResolvedValue({ key: 'initialPassword_user-id', value: '' });

      const { clearInitialPasswordMarker } = await import('../../../src/api/auth/password');
      await clearInitialPasswordMarker('user-id');

      expect(mockPrismaClient.systemSetting.delete).toHaveBeenCalledWith({
        where: { key: 'initialPassword_user-id' },
      });
    });

    it('should handle deletion errors gracefully', async () => {
      mockPrismaClient.systemSetting.delete.mockRejectedValue(new Error('Delete error'));

      const { clearInitialPasswordMarker } = await import('../../../src/api/auth/password');
      // Should not throw
      await expect(clearInitialPasswordMarker('user-id')).resolves.toBeUndefined();
    });
  });

  // ========================================
  // Token Routes
  // ========================================

  describe('POST /auth/refresh - Refresh Token', () => {
    it('should reject when refresh token is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Refresh token is required');
    });

    it('should reject invalid refresh token', async () => {
      const { verifyRefreshToken } = await import('../../../src/utils/jwt');
      const mockVerifyRefreshToken = vi.mocked(verifyRefreshToken);
      mockVerifyRefreshToken.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid or expired refresh token');
    });

    it('should reject revoked refresh token', async () => {
      const { verifyRefreshTokenExists } = await import('../../../src/services/refreshTokenService');
      const mockVerifyExists = vi.mocked(verifyRefreshTokenExists);
      mockVerifyExists.mockResolvedValueOnce(false);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'revoked-token' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Refresh token has been revoked');
    });

    it('should reject when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('User not found');
    });

    it('should return new access token', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.expiresIn).toBe(3600);
    });

    it('should return new refresh token when rotation is requested', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token', rotate: true });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBe('new-refresh-token');
    });

    it('should return 500 when mandatory token rotation fails', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
      });

      const { rotateRefreshToken } = await import('../../../src/services/refreshTokenService');
      vi.mocked(rotateRefreshToken).mockResolvedValueOnce(null);

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'valid-token' });

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /auth/logout - Logout', () => {
    it('should logout successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out successfully');
    });

    it('should logout without revoking access token when no Bearer header', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Basic some-auth') // Not a Bearer token
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should logout when decoded token is missing jti', async () => {
      const { decodeToken } = await import('../../../src/utils/jwt');
      vi.mocked(decodeToken).mockReturnValueOnce({ userId: 'test-user-id' }); // Missing jti and exp

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should logout and revoke refresh token if provided', async () => {
      const { revokeRefreshToken } = await import('../../../src/services/refreshTokenService');
      const mockRevokeRefreshToken = vi.mocked(revokeRefreshToken);

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({ refreshToken: 'some-refresh-token' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockRevokeRefreshToken).toHaveBeenCalledWith('some-refresh-token');
    });

    it('should audit logout with unknown username fallback', async () => {
      const { auditService } = await import('../../../src/services/auditService');

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Test-No-Username', '1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'unknown',
        })
      );
    });

    it('should handle errors gracefully', async () => {
      const { revokeToken } = await import('../../../src/services/tokenRevocation');
      const mockRevokeToken = vi.mocked(revokeToken);
      mockRevokeToken.mockRejectedValueOnce(new Error('Revocation error'));

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });
  });

  describe('POST /auth/logout-all - Logout All Devices', () => {
    it('should logout from all devices successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logged out from all devices');
      expect(response.body.sessionsRevoked).toBe(5);
    });

    it('should handle errors gracefully', async () => {
      const { revokeAllUserRefreshTokens } = await import('../../../src/services/refreshTokenService');
      const mockRevokeAll = vi.mocked(revokeAllUserRefreshTokens);
      mockRevokeAll.mockRejectedValueOnce(new Error('Revocation error'));

      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Internal');
    });

    it('should audit logout-all with unknown username fallback', async () => {
      const { auditService } = await import('../../../src/services/auditService');

      const response = await request(app)
        .post('/api/v1/auth/logout-all')
        .set('Authorization', 'Bearer valid-token')
        .set('X-Test-No-Username', '1')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'unknown',
          details: expect.objectContaining({ action: 'logout_all' }),
        })
      );
    });
  });
});
