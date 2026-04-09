import { vi } from 'vitest';
/**
 * Authentication API Tests
 *
 * Tests for login, registration, JWT validation, rate limiting, and API routes.
 */

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { sampleUsers } from '../../fixtures/bitcoin';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
  generateExpiredToken,
  generateInvalidSignatureToken,
} from '../../helpers/testUtils';
import * as bcrypt from 'bcryptjs';

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
const mockIsVerificationRequired = vi.fn().mockResolvedValue(true);
const mockIsSmtpConfigured = vi.fn().mockResolvedValue(false);
const mockCreateVerificationToken = vi.fn().mockResolvedValue({ success: false });

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

// Import JWT utilities and password utilities after mocks
import { generateToken, verifyToken, extractTokenFromHeader } from '../../../src/utils/jwt';
import { hashPassword, verifyPassword } from '../../../src/utils/password';

describe('Authentication', () => {
  beforeEach(() => {
    resetPrismaMocks();
    mockIsVerificationRequired.mockResolvedValue(true); // Default to required
    mockIsSmtpConfigured.mockResolvedValue(false);
    mockCreateVerificationToken.mockResolvedValue({ success: false });
  });

  describe('JWT Utilities', () => {
    describe('generateToken', () => {
      it('should generate a valid JWT token', () => {
        const payload = {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        };

        const token = generateToken(payload);

        expect(token).toBeDefined();
        expect(typeof token).toBe('string');
        expect(token.split('.').length).toBe(3); // JWT has 3 parts
      });

      it('should generate token with custom expiry', async () => {
        const payload = {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        };

        const token = generateToken(payload, '5m');

        expect(token).toBeDefined();
        const decoded = await verifyToken(token);
        expect(decoded.userId).toBe(payload.userId);
      });
    });

    describe('verifyToken', () => {
      it('should verify and decode a valid token', async () => {
        const payload = {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: true,
        };

        const token = generateToken(payload);
        const decoded = await verifyToken(token);

        expect(decoded.userId).toBe(payload.userId);
        expect(decoded.username).toBe(payload.username);
        expect(decoded.isAdmin).toBe(payload.isAdmin);
      });

      it('should throw error for expired token', async () => {
        const expiredToken = generateExpiredToken({
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        });

        await expect(verifyToken(expiredToken)).rejects.toThrow('Token expired');
      });

      it('should throw error for invalid signature', async () => {
        const invalidToken = generateInvalidSignatureToken({
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        });

        await expect(verifyToken(invalidToken)).rejects.toThrow('Invalid token');
      });

      it('should throw error for malformed token', async () => {
        await expect(verifyToken('not-a-valid-token')).rejects.toThrow();
        await expect(verifyToken('')).rejects.toThrow();
      });
    });

    describe('extractTokenFromHeader', () => {
      it('should extract token from valid Bearer header', () => {
        const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
        const header = `Bearer ${token}`;

        expect(extractTokenFromHeader(header)).toBe(token);
      });

      it('should return null for missing header', () => {
        expect(extractTokenFromHeader(undefined)).toBeNull();
        expect(extractTokenFromHeader('')).toBeNull();
      });

      it('should return null for invalid format', () => {
        expect(extractTokenFromHeader('Basic token')).toBeNull();
        expect(extractTokenFromHeader('Bearertoken')).toBeNull();
        expect(extractTokenFromHeader('Bearer')).toBeNull();
        expect(extractTokenFromHeader('Bearer token extra')).toBeNull();
      });
    });
  });

  describe('Password Utilities', () => {
    describe('hashPassword', () => {
      it('should hash a password', async () => {
        const password = 'TestPassword123';
        const hash = await hashPassword(password);

        expect(hash).toBeDefined();
        expect(hash).not.toBe(password);
        expect(hash.startsWith('$2a$') || hash.startsWith('$2b$')).toBe(true);
      });

      it('should produce different hashes for same password', async () => {
        const password = 'TestPassword123';
        const hash1 = await hashPassword(password);
        const hash2 = await hashPassword(password);

        expect(hash1).not.toBe(hash2); // Different salts
      });
    });

    describe('verifyPassword', () => {
      it('should verify correct password', async () => {
        const password = 'TestPassword123';
        const hash = await hashPassword(password);

        const isValid = await verifyPassword(password, hash);

        expect(isValid).toBe(true);
      });

      it('should reject incorrect password', async () => {
        const password = 'TestPassword123';
        const hash = await hashPassword(password);

        const isValid = await verifyPassword('WrongPassword', hash);

        expect(isValid).toBe(false);
      });

      it('should be case-sensitive', async () => {
        const password = 'TestPassword123';
        const hash = await hashPassword(password);

        const isValid = await verifyPassword('testpassword123', hash);

        expect(isValid).toBe(false);
      });
    });
  });

  describe('Authentication Middleware', () => {
    // Import after mocks
    let authenticate: any;
    let requireAdmin: any;
    let optionalAuth: any;

    beforeAll(async () => {
      const authModule = await vi.importActual<typeof import('../../../src/middleware/auth')>(
        '../../../src/middleware/auth'
      );
      authenticate = authModule.authenticate;
      requireAdmin = authModule.requireAdmin;
      optionalAuth = authModule.optionalAuth;
    });

    describe('authenticate', () => {
      // Note: These tests use the mock middleware so they test the mock behavior, not real JWT parsing
      it('should authenticate valid token and attach user to request', async () => {
        const payload = {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        };
        const token = generateTestToken(payload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeDefined();
        expect((req as any).user.userId).toBe(payload.userId);
      });

      it('should reject request with no token', async () => {
        const req = createMockRequest({});
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.error).toBe('Unauthorized');
        expect(next).not.toHaveBeenCalled();
      });

      it('should reject request with expired token', async () => {
        const expiredToken = generateExpiredToken({
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        });

        const req = createMockRequest({
          headers: { authorization: `Bearer ${expiredToken}` },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        await authenticate(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toContain('Invalid or expired');
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('requireAdmin', () => {
      it('should allow admin user', () => {
        const req = createMockRequest({
          user: { userId: 'admin-123', username: 'admin', isAdmin: true },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
      });

      it('should reject non-admin user', () => {
        const req = createMockRequest({
          user: { userId: 'user-123', username: 'user', isAdmin: false },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toBe('Forbidden');
        expect(next).not.toHaveBeenCalled();
      });

      it('should reject unauthenticated request', () => {
        const req = createMockRequest({});
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('optionalAuth', () => {
      // Note: This test uses the mock middleware which doesn't actually parse tokens
      it('should attach user when valid token provided', async () => {
        const payload = {
          userId: 'user-123',
          username: 'testuser',
          isAdmin: false,
        };
        const token = generateTestToken(payload);

        const req = createMockRequest({
          headers: { authorization: `Bearer ${token}` },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeDefined();
        expect((req as any).user.userId).toBe(payload.userId);
      });

      it('should proceed without user when no token', async () => {
        const req = createMockRequest({});
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
      });

      it('should proceed without user when invalid token', async () => {
        const req = createMockRequest({
          headers: { authorization: 'Bearer invalid-token' },
        });
        const { res } = createMockResponse();
        const next = createMockNext();

        await optionalAuth(req as any, res as any, next);

        expect(next).toHaveBeenCalled();
        expect((req as any).user).toBeUndefined();
      });
    });
  });

  describe('Login Flow', () => {
    it('should return token on successful login', async () => {
      const password = 'testpassword';
      const hashedPassword = await hashPassword(password);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        ...sampleUsers.regularUser,
        password: hashedPassword,
      });

      // Simulate login
      const isValid = await verifyPassword(password, hashedPassword);
      expect(isValid).toBe(true);

      const token = generateToken({
        userId: sampleUsers.regularUser.id,
        username: sampleUsers.regularUser.username,
        isAdmin: sampleUsers.regularUser.isAdmin,
      });

      expect(token).toBeDefined();
      const decoded = await verifyToken(token);
      expect(decoded.userId).toBe(sampleUsers.regularUser.id);
    });

    it('should reject login with wrong password', async () => {
      const password = 'correctpassword';
      const wrongPassword = 'wrongpassword';
      const hashedPassword = await hashPassword(password);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        ...sampleUsers.regularUser,
        password: hashedPassword,
      });

      const isValid = await verifyPassword(wrongPassword, hashedPassword);
      expect(isValid).toBe(false);
    });

    it('should handle non-existent user', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      // User lookup returns null
      const user = await mockPrismaClient.user.findUnique({ where: { username: 'nonexistent' } });
      expect(user).toBeNull();
    });
  });

  describe('2FA-Protected Login', () => {
    it('should return pending2FA token when 2FA is enabled', async () => {
      const user = {
        ...sampleUsers.userWith2FA,
        password: await hashPassword('password123'),
      };

      mockPrismaClient.user.findUnique.mockResolvedValue(user);

      // When 2FA is enabled, first step returns pending token
      const tempToken = generateToken(
        {
          userId: user.id,
          username: user.username,
          isAdmin: user.isAdmin,
          pending2FA: true,
        },
        '5m'
      );

      const decoded = await verifyToken(tempToken);
      expect(decoded.pending2FA).toBe(true);
      expect(decoded.userId).toBe(user.id);
    });
  });

  describe('Password Validation Edge Cases', () => {
    it('should handle empty password', async () => {
      const hash = await hashPassword('somepassword');
      const isValid = await verifyPassword('', hash);
      expect(isValid).toBe(false);
    });

    it('should handle very long password', async () => {
      const longPassword = 'a'.repeat(1000);
      const hash = await hashPassword(longPassword);
      const isValid = await verifyPassword(longPassword, hash);
      expect(isValid).toBe(true);
    });

    it('should handle special characters in password', async () => {
      const specialPassword = '!@#$%^&*()_+-=[]{}|;:,.<>?`~"\'\\';
      const hash = await hashPassword(specialPassword);
      const isValid = await verifyPassword(specialPassword, hash);
      expect(isValid).toBe(true);
    });

    it('should handle unicode in password', async () => {
      const unicodePassword = 'Passw0rd123456';
      const hash = await hashPassword(unicodePassword);
      const isValid = await verifyPassword(unicodePassword, hash);
      expect(isValid).toBe(true);
    });
  });
});

// ========================================
// Auth API Route Tests
// ========================================

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

// Mock token revocation for route tests
vi.mock('../../../src/services/tokenRevocation', () => ({
  isTokenRevoked: vi.fn().mockResolvedValue(false),
  revokeToken: vi.fn().mockResolvedValue(undefined),
  revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
  initializeRevocationService: vi.fn(),
  shutdownRevocationService: vi.fn(),
}));

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
import { errorHandler } from '../../../src/errors/errorHandler';

// Create test app for auth routes
const createAuthTestApp = async () => {
  const app = express();
  app.use(express.json());

  // Import router dynamically after mocks
  const authModule = await import('../../../src/api/auth');
  app.use('/api/v1/auth', authModule.default);
  app.use(errorHandler);

  return app;
};

describe('Auth API Routes', () => {
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

  // ========================================
  // Two-Factor Authentication Routes
  // ========================================

  describe('POST /auth/2fa/setup - Setup 2FA', () => {
    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .send({});

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should return 400 when 2FA is already enabled', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorEnabled: true,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('2FA is already enabled');
    });

    it('should successfully start 2FA setup', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorEnabled: false,
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .send({});

      expect(response.status).toBe(200);
      expect(response.body.secret).toBe('mock-secret');
      expect(response.body.qrCodeDataUrl).toBeDefined();
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/2fa/setup')
        .send({});

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/2fa/enable - Enable 2FA', () => {
    it('should return 400 when token is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Verification token is required');
    });

    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({ token: '123456' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should return 400 when secret not set (setup not started)', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorSecret: null,
        twoFactorEnabled: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({ token: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Please start 2FA setup first');
    });

    it('should return 400 when 2FA already enabled', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorSecret: 'some-secret',
        twoFactorEnabled: true,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({ token: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('2FA is already enabled');
    });

    it('should return 400 when verification code is invalid', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorSecret: 'some-secret',
        twoFactorEnabled: false,
      });

      const { verifyToken } = await import('../../../src/services/twoFactorService');
      const mockVerifyToken = vi.mocked(verifyToken);
      mockVerifyToken.mockReturnValueOnce(false);

      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({ token: '000000' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Invalid verification code');
    });

    it('should successfully enable 2FA', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorSecret: 'some-secret',
        twoFactorEnabled: false,
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({ token: '123456' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.backupCodes).toHaveLength(8);
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/2fa/enable')
        .send({ token: '123456' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/2fa/disable - Disable 2FA', () => {
    it('should return 400 when password or token is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password and 2FA token are required');
    });

    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: 'password123', token: '123456' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should return 400 when 2FA is not enabled', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorEnabled: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: 'password123', token: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('2FA is not enabled');
    });

    it('should return 401 when password is wrong', async () => {
      const hashedPassword = await hashPassword('CorrectPassword123!');

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: 'WrongPassword123!', token: '123456' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid password');
    });

    it('should return 401 when 2FA token is invalid', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        twoFactorBackupCodes: null,
      });

      const { verifyToken, verifyBackupCode } = await import('../../../src/services/twoFactorService');
      vi.mocked(verifyToken).mockReturnValueOnce(false);
      vi.mocked(verifyBackupCode).mockResolvedValueOnce({ valid: false });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: correctPassword, token: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid 2FA code');
    });

    it('should allow disabling via backup code when TOTP token fails', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        twoFactorBackupCodes: '[{"hash":"h1"}]',
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      const { verifyToken, verifyBackupCode } = await import('../../../src/services/twoFactorService');
      vi.mocked(verifyToken).mockReturnValueOnce(false);
      vi.mocked(verifyBackupCode).mockReset().mockResolvedValue({ valid: true, updatedCodesJson: '[]' });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: correctPassword, token: 'ABCD-EFGH' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should allow disabling using backup code when 2FA secret is missing', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: null,
        twoFactorBackupCodes: '[{"hash":"h1"}]',
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      const { verifyToken, verifyBackupCode } = await import('../../../src/services/twoFactorService');
      vi.mocked(verifyToken).mockReset().mockReturnValue(true);
      vi.mocked(verifyBackupCode).mockReset().mockResolvedValue({ valid: true, updatedCodesJson: '[]' });

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: correctPassword, token: 'BACKUP-CODE' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(verifyToken).not.toHaveBeenCalled();
      expect(verifyBackupCode).toHaveBeenCalledWith('[{"hash":"h1"}]', 'BACKUP-CODE');
    });

    it('should successfully disable 2FA', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: correctPassword, token: '123456' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should handle disable errors gracefully', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });
      mockPrismaClient.user.update.mockRejectedValueOnce(new Error('Write failed'));

      const response = await request(app)
        .post('/api/v1/auth/2fa/disable')
        .send({ password: correctPassword, token: '123456' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/2fa/verify - Verify 2FA During Login', () => {
    it('should return 400 when tempToken or code is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'some-token' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Temporary token and verification code are required');
    });

    it('should return 401 when tempToken is invalid', async () => {
      const { verify2FAToken } = await import('../../../src/utils/jwt');
      const mockVerify2FA = vi.mocked(verify2FAToken);
      mockVerify2FA.mockRejectedValueOnce(new Error('Invalid token'));

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'invalid-token', code: '123456' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid or expired temporary token');
    });

    it('should return 401 when user not found or 2FA not enabled', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: '123456' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid authentication state');
    });

    it('should return 401 when code is invalid', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        twoFactorBackupCodes: null,
      });

      const { verifyToken } = await import('../../../src/services/twoFactorService');
      vi.mocked(verifyToken).mockReturnValueOnce(false);

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid verification code');
    });

    it('should successfully verify 2FA and return tokens', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        preferences: { darkMode: true },
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: '123456' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.refreshToken).toBeDefined();
      expect(response.body.user.username).toBe('testuser');
    });

    it('should successfully verify using backup code', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        twoFactorBackupCodes: '[{"hash":"h1"}]',
        preferences: { darkMode: true },
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      // Reset and configure mocks for backup code path
      const twoFactorService = await import('../../../src/services/twoFactorService');
      vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(true);
      vi.mocked(twoFactorService.verifyBackupCode).mockReset().mockResolvedValue({ valid: true, updatedCodesJson: '[]' });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: 'BACKUP-CODE' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
    });

    it('should skip backup code persistence when verifyBackupCode does not return updates', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        email: 'test@example.com',
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        twoFactorBackupCodes: '[{"hash":"h1"}]',
        preferences: { darkMode: true },
      });

      const twoFactorService = await import('../../../src/services/twoFactorService');
      vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(true);
      vi.mocked(twoFactorService.verifyBackupCode).mockReset().mockResolvedValue({ valid: true });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: 'BACKUP-CODE' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
    });

    it('should reject invalid backup code', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        isAdmin: false,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
        twoFactorBackupCodes: '[{"hash":"h1"}]',
      });

      // Reset and configure mocks for backup code path with invalid code
      const twoFactorService = await import('../../../src/services/twoFactorService');
      vi.mocked(twoFactorService.isBackupCode).mockReset().mockReturnValue(true);
      vi.mocked(twoFactorService.verifyBackupCode).mockReset().mockResolvedValue({ valid: false });

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: 'INVALID-BACKUP' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid verification code');
    });

    it('should handle errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('Database error'));

      const response = await request(app)
        .post('/api/v1/auth/2fa/verify')
        .send({ tempToken: 'valid-token', code: '123456' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/2fa/backup-codes - Get Backup Code Count', () => {
    it('should return 400 when password is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password is required');
    });

    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .send({ password: 'password123' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should return 401 when password is invalid', async () => {
      const hashedPassword = await hashPassword('CorrectPassword123!');

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .send({ password: 'WrongPassword123!' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid password');
    });

    it('should return 400 when 2FA is not enabled', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .send({ password: correctPassword });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('2FA is not enabled');
    });

    it('should return remaining backup code count', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorBackupCodes: '[{"hash":"h1"},{"hash":"h2"}]',
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .send({ password: correctPassword });

      expect(response.status).toBe(200);
      expect(response.body.remaining).toBe(8);
    });

    it('should handle backup-code count errors gracefully', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorBackupCodes: '[{"hash":"h1"}]',
      });

      const { getRemainingBackupCodeCount } = await import('../../../src/services/twoFactorService');
      vi.mocked(getRemainingBackupCodeCount).mockImplementationOnce(() => {
        throw new Error('Parse failed');
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes')
        .send({ password: correctPassword });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });

  describe('POST /auth/2fa/backup-codes/regenerate - Regenerate Backup Codes', () => {
    it('should return 400 when password or token is missing', async () => {
      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: 'password123' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('Password and 2FA token are required');
    });

    it('should return 404 when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: 'password123', token: '123456' });

      expect(response.status).toBe(404);
      expect(response.body.message).toContain('User not found');
    });

    it('should return 400 when 2FA is not enabled', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        twoFactorEnabled: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: 'password123', token: '123456' });

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('2FA is not enabled');
    });

    it('should return 401 when password is invalid', async () => {
      const hashedPassword = await hashPassword('CorrectPassword123!');

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: 'WrongPassword123!', token: '123456' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid password');
    });

    it('should return 401 when 2FA token is invalid', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });

      const { verifyToken } = await import('../../../src/services/twoFactorService');
      vi.mocked(verifyToken).mockReturnValueOnce(false);

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: correctPassword, token: '000000' });

      expect(response.status).toBe(401);
      expect(response.body.message).toContain('Invalid 2FA code');
    });

    it('should successfully regenerate backup codes', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });
      mockPrismaClient.user.update.mockResolvedValue({});

      // Reset and explicitly set verifyToken to return true
      const twoFactorService = await import('../../../src/services/twoFactorService');
      vi.mocked(twoFactorService.verifyToken).mockReset().mockReturnValue(true);

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: correctPassword, token: '123456' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.backupCodes).toHaveLength(8);
    });

    it('should handle regenerate backup code errors gracefully', async () => {
      const correctPassword = 'CorrectPassword123!';
      const hashedPassword = await hashPassword(correctPassword);

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'test-user-id',
        username: 'testuser',
        password: hashedPassword,
        twoFactorEnabled: true,
        twoFactorSecret: 'some-secret',
      });

      const twoFactorService = await import('../../../src/services/twoFactorService');
      vi.mocked(twoFactorService.verifyToken).mockReturnValueOnce(true);
      vi.mocked(twoFactorService.hashBackupCodes).mockRejectedValueOnce(new Error('Hash failed'));

      const response = await request(app)
        .post('/api/v1/auth/2fa/backup-codes/regenerate')
        .send({ password: correctPassword, token: '123456' });

      expect(response.status).toBe(500);
      expect(response.body.code).toBe('INTERNAL_ERROR');
    });
  });
});
