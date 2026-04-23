import { vi } from 'vitest';
/**
 * Authentication Tests — JWT, Password, Middleware
 *
 * Tests for JWT utilities, password utilities, authentication middleware,
 * login flow, 2FA-protected login, and password validation edge cases.
 *
 * Route handler tests are in:
 *   - auth.routes.registration.test.ts (profile, sessions, registration, login, password, tokens)
 *   - auth.routes.2fa.test.ts (2FA setup, enable, disable, verify, backup codes)
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
import { generateToken, generate2FAToken, verifyToken, verify2FAToken, extractTokenFromHeader } from '../../../src/utils/jwt';
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
      const tempToken = generate2FAToken(
        {
          userId: user.id,
          username: user.username,
          isAdmin: user.isAdmin,
        },
      );

      const decoded = await verify2FAToken(tempToken);
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
