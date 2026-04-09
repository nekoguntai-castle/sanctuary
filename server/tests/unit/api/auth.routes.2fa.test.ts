import { vi } from 'vitest';
/**
 * Auth API Route Tests — Two-Factor Authentication
 *
 * Tests for 2FA setup, enable, disable, verify, backup codes,
 * and backup code regeneration endpoints.
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

describe('Auth API Routes — Two-Factor Authentication', () => {
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
