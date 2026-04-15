/**
 * Admin Routes Integration Tests
 *
 * HTTP-level tests for admin sub-routes using supertest.
 * Covers: users, groups, settings, backup, audit logs, etc.
 */

import { beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { errorHandler } from '../../../../src/errors/errorHandler';

const {
  mockEncrypt,
  mockIsEncrypted,
  mockClearTransporterCache,
} = vi.hoisted(() => ({
  mockEncrypt: vi.fn((value: string) => `enc:${value}`),
  mockIsEncrypted: vi.fn((value: string) => typeof value === 'string' && value.startsWith('enc:')),
  mockClearTransporterCache: vi.fn(),
}));

// Mock logger first
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock Prisma
const mockPrisma = {
  user: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  group: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  groupMember: {
    create: vi.fn(),
    createMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  systemSetting: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  auditLog: {
    findMany: vi.fn(),
    count: vi.fn(),
    groupBy: vi.fn(),
    create: vi.fn(),
  },
  wallet: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    count: vi.fn(),
  },
  device: {
    count: vi.fn(),
  },
  $transaction: vi.fn((fn: (tx: unknown) => Promise<unknown>) => fn(mockPrisma)),
};

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// Mock audit service
const mockAuditService = {
  log: vi.fn().mockResolvedValue(undefined),
  logFromRequest: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
  getStats: vi.fn().mockResolvedValue({ total: 0, byAction: {}, byCategory: {} }),
};

vi.mock('../../../../src/services/auditService', () => ({
  auditService: mockAuditService,
  AuditAction: {
    USER_CREATE: 'user.create',
    USER_UPDATE: 'user.update',
    USER_DELETE: 'user.delete',
    USER_ADMIN_GRANT: 'user.admin_grant',
    USER_ADMIN_REVOKE: 'user.admin_revoke',
    GROUP_CREATE: 'admin.group_create',
    GROUP_DELETE: 'admin.group_delete',
    SYSTEM_SETTING_UPDATE: 'admin.system_setting_update',
  },
  AuditCategory: {
    USER: 'user',
    ADMIN: 'admin',
    SYSTEM: 'system',
  },
  getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

// Mock authentication middleware
vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: any) => {
    req.user = { userId: 'admin-user-id', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// Mock config
vi.mock('../../../../src/config', () => ({
  __esModule: true,
  default: {
    jwtSecret: 'test-secret',
    nodeEnv: 'test',
    dataDir: '/tmp/test',
    encryptionKey: 'test-encryption-key',
    corsAllowedOrigins: [],
  },
}));

// Mock access control
vi.mock('../../../../src/services/accessControl', () => ({
  invalidateUserAccessCache: vi.fn(),
}));

// Mock token revocation (called on admin password reset)
vi.mock('../../../../src/services/tokenRevocation', () => ({
  revokeAllUserTokens: vi.fn().mockResolvedValue(0),
}));

// Mock backup service
vi.mock('../../../../src/services/backupService', () => ({
  backupService: {
    createBackup: vi.fn().mockResolvedValue(Buffer.from('mock-backup')),
    validateBackup: vi.fn().mockResolvedValue({ valid: true }),
    restoreFromBackup: vi.fn().mockResolvedValue({ success: true }),
  },
}));

// Mock version check
vi.mock('../../../../src/services/versionService', () => ({
  versionService: {
    getCurrentVersion: vi.fn().mockReturnValue('1.0.0'),
    getLatestVersion: vi.fn().mockResolvedValue('1.0.0'),
    checkForUpdates: vi.fn().mockResolvedValue({ hasUpdate: false }),
  },
}));

vi.mock('../../../../src/utils/encryption', () => ({
  encrypt: mockEncrypt,
  isEncrypted: mockIsEncrypted,
}));

vi.mock('../../../../src/services/email', () => ({
  clearTransporterCache: mockClearTransporterCache,
}));

const createTestApp = async () => {
  const app = express();
  app.use(express.json());
  const adminModule = await import('../../../../src/api/admin');
  app.use('/api/v1/admin', adminModule.default);
  app.use(errorHandler);
  return app;
};

let app: express.Application;

export function setupAdminRoutesTestHooks(): void {
  beforeAll(async () => {
    app = await createTestApp();
  }, 30000);

  beforeEach(() => {
    vi.resetAllMocks();
    // Reset to default resolved values after clearing
    mockAuditService.log.mockResolvedValue(undefined);
    mockAuditService.logFromRequest.mockResolvedValue(undefined);
    mockAuditService.query.mockResolvedValue({ logs: [], total: 0 });
    mockAuditService.getStats.mockResolvedValue({ total: 0, byAction: {}, byCategory: {} });
    mockEncrypt.mockImplementation((value: string) => `enc:${value}`);
    mockIsEncrypted.mockImplementation((value: string) => typeof value === 'string' && value.startsWith('enc:'));
  });
}

export const adminRoutesRequest = () => request(app);

export {
  mockAuditService,
  mockClearTransporterCache,
  mockEncrypt,
  mockIsEncrypted,
  mockPrisma,
};
