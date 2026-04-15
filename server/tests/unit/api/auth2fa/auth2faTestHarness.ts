import { beforeAll, beforeEach, vi } from 'vitest';
import type { Application } from 'express';

import {
  mockPrismaClient,
  resetPrismaMocks,
  mockIsVerificationRequired,
  mockIsSmtpConfigured,
  mockCreateVerificationToken,
  createAuthTestApp,
} from '../auth.testHelpers';

vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

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

vi.mock('../../../../src/config', () => ({
  __esModule: true,
  default: mockConfig,
  getConfig: () => mockConfig,
}));

vi.mock('../../../../src/services/tokenRevocation', () => ({
  isTokenRevoked: vi.fn().mockResolvedValue(false),
  revokeToken: vi.fn().mockResolvedValue(undefined),
  revokeAllUserTokens: vi.fn().mockResolvedValue(undefined),
  initializeRevocationService: vi.fn(),
  shutdownRevocationService: vi.fn(),
}));

vi.mock('../../../../src/services/auditService', () => ({
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

vi.mock('../../../../src/services/email', () => ({
  isVerificationRequired: () => mockIsVerificationRequired(),
  isSmtpConfigured: () => mockIsSmtpConfigured(),
  createVerificationToken: (...args: unknown[]) => mockCreateVerificationToken(...args),
}));

vi.mock('../../../../src/middleware/rateLimit', () => ({
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

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
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
    next();
  },
}));

vi.mock('../../../../src/services/refreshTokenService', () => ({
  getUserSessions: vi.fn(),
  revokeSession: vi.fn(),
  createRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
  verifyRefreshTokenExists: vi.fn().mockResolvedValue(true),
  rotateRefreshToken: vi.fn().mockResolvedValue('new-refresh-token'),
  revokeRefreshToken: vi.fn().mockResolvedValue(undefined),
  revokeAllUserRefreshTokens: vi.fn().mockResolvedValue(5),
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/utils/jwt', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/utils/jwt')>();
  return {
    ...actual,
    hashToken: vi.fn().mockReturnValue('hashed-token'),
    verifyRefreshToken: vi.fn().mockResolvedValue({ userId: 'test-user-id', username: 'testuser' }),
    decodeToken: vi.fn().mockReturnValue({
      jti: 'token-jti',
      exp: Math.floor(Date.now() / 1000) + 3600,
      userId: 'test-user-id',
    }),
    generate2FAToken: vi.fn().mockReturnValue('mock-2fa-token'),
    verify2FAToken: vi.fn().mockResolvedValue({ userId: 'test-user-id', username: 'testuser', isAdmin: false }),
  };
});

vi.mock('../../../../src/utils/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/utils/password')>();
  return {
    ...actual,
  };
});

vi.mock('../../../../src/services/twoFactorService', () => ({
  generateSecret: vi.fn().mockResolvedValue({ secret: 'mock-secret', qrCodeDataUrl: 'data:image/png;base64,...' }),
  verifyToken: vi.fn().mockReturnValue(true),
  generateBackupCodes: vi.fn().mockReturnValue(['code1', 'code2', 'code3', 'code4', 'code5', 'code6', 'code7', 'code8']),
  hashBackupCodes: vi.fn().mockResolvedValue('[{"hash":"hash1"},{"hash":"hash2"}]'),
  verifyBackupCode: vi.fn().mockResolvedValue({ valid: true, updatedCodesJson: '[]' }),
  getRemainingBackupCodeCount: vi.fn().mockReturnValue(8),
  isBackupCode: vi.fn().mockReturnValue(false),
}));

vi.mock('../../../../src/utils/requestContext', () => ({
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

export let app: Application;

export function registerAuth2faTestHarness() {
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
}
