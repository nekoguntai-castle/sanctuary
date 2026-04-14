import { beforeAll, beforeEach, vi } from 'vitest';
/**
 * Admin API Tests
 *
 * Comprehensive tests for admin-only endpoints including:
 * - User management
 * - Group management
 * - System settings
 * - Node configuration
 * - Backup/Restore
 * - Audit logs
 * - Version/Updates
 * - Electrum server management
 */

import { mockPrismaClient, resetPrismaMocks } from '../../../mocks/prisma';

// Mock Prisma
vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock config
vi.mock('../../../../src/config', () => ({
  __esModule: true,
  default: {
    jwtSecret: 'test-jwt-secret-key-for-testing-only',
    jwtExpiresIn: '1h',
    jwtRefreshExpiresIn: '7d',
    gatewaySecret: '',
    corsAllowedOrigins: [],
    nodeEnv: 'test',
  },
}));

// Mock audit service
const mockAuditLog = vi.fn().mockResolvedValue(undefined);
const mockAuditLogFromRequest = vi.fn().mockResolvedValue(undefined);
const mockAuditQuery = vi.fn().mockResolvedValue({ logs: [], total: 0 });
const mockAuditGetStats = vi.fn().mockResolvedValue({
  totalEvents: 0,
  byAction: {},
  byCategory: {},
  byUser: {},
});

vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    log: mockAuditLog,
    logFromRequest: mockAuditLogFromRequest,
    query: mockAuditQuery,
    getStats: mockAuditGetStats,
  },
  AuditAction: {
    USER_CREATE: 'user.create',
    USER_UPDATE: 'user.update',
    USER_DELETE: 'user.delete',
    USER_ADMIN_GRANT: 'user.admin_grant',
    USER_ADMIN_REVOKE: 'user.admin_revoke',
    GROUP_CREATE: 'admin.group_create',
    GROUP_DELETE: 'admin.group_delete',
    GROUP_MEMBER_ADD: 'admin.group_member_add',
    GROUP_MEMBER_REMOVE: 'admin.group_member_remove',
    NODE_CONFIG_UPDATE: 'admin.node_config_update',
    SYSTEM_SETTING_UPDATE: 'admin.system_setting_update',
    ENCRYPTION_KEYS_VIEW: 'admin.encryption_keys_view',
    BACKUP_CREATE: 'backup.create',
    BACKUP_RESTORE: 'backup.restore',
  },
  AuditCategory: {
    USER: 'user',
    ADMIN: 'admin',
    BACKUP: 'backup',
    SYSTEM: 'system',
  },
  getClientInfo: vi.fn().mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'test' }),
}));

// Mock backup service
const mockCreateBackup = vi.fn();
const mockValidateBackup = vi.fn();
const mockRestoreFromBackup = vi.fn();

vi.mock('../../../../src/services/backupService', () => ({
  backupService: {
    createBackup: mockCreateBackup,
    validateBackup: mockValidateBackup,
    restoreFromBackup: mockRestoreFromBackup,
  },
}));

// Mock node client
const mockTestNodeConfig = vi.fn();
const mockResetNodeClient = vi.fn();

vi.mock('../../../../src/services/bitcoin/nodeClient', () => ({
  testNodeConfig: mockTestNodeConfig,
  resetNodeClient: mockResetNodeClient,
}));

// Mock electrum pool
const mockReloadElectrumServers = vi.fn();

vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  reloadElectrumServers: mockReloadElectrumServers,
}));

// Mock encryption
vi.mock('../../../../src/utils/encryption', () => ({
  encrypt: vi.fn((data: string) => `encrypted_${data}`),
  decrypt: vi.fn((data: string) => data.replace('encrypted_', '')),
}));

// Mock password validation
const mockVerifyPassword = vi.fn().mockResolvedValue(true);
vi.mock('../../../../src/utils/password', () => ({
  validatePasswordStrength: vi.fn((password: string) => {
    if (password.length < 8) {
      return { valid: false, errors: ['Password must be at least 8 characters'] };
    }
    return { valid: true, errors: [] };
  }),
  hashPassword: vi.fn().mockResolvedValue('hashed-password'),
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
}));

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock constants
vi.mock('../../../../src/constants', () => ({
  DEFAULT_CONFIRMATION_THRESHOLD: 2,
  DEFAULT_DEEP_CONFIRMATION_THRESHOLD: 6,
  DEFAULT_DUST_THRESHOLD: 546,
  DEFAULT_DRAFT_EXPIRATION_DAYS: 7,
  DEFAULT_AI_ENABLED: false,
  DEFAULT_AI_ENDPOINT: 'http://localhost:11434',
  DEFAULT_AI_MODEL: 'llama2',
  WALLET_LOG_MAX_ENTRIES: 200,
  WALLET_LOG_INACTIVE_CLEANUP_MS: 30 * 60 * 1000,
  WALLET_LOG_CLEANUP_INTERVAL_MS: 5 * 60 * 1000,
  AUDIT_DEFAULT_PAGE_SIZE: 50,
  AUDIT_USER_LOG_LIMIT: 20,
  AUDIT_FAILED_LOGIN_LIMIT: 100,
  AUDIT_STATS_DAYS: 30,
  FEATURE_FLAG_CACHE_TTL_SECONDS: 60,
}));

// Mock websocket server to prevent import chain to tiny-secp256k1
vi.mock('../../../../src/websocket/server', () => ({
  getWebSocketServer: vi.fn(() => null),
  getRateLimitEvents: vi.fn(() => []),
}));

// Mock fs for version check - include all methods Prisma needs
vi.mock('fs', () => {
  const actual = vi.importActual('fs');
  return {
    ...actual,
    readFileSync: vi.fn(() => JSON.stringify({ version: '1.0.0' })),
  };
});

/**
 * Call an async route handler that may throw ApiErrors.
 * Handles both asyncHandler-wrapped routes (which fire-and-forget the promise)
 * and direct async handlers. Simulates Express error handling for thrown errors.
 */
export async function callHandler(handler: any, req: any, res: any): Promise<void> {
  return new Promise<void>((resolve) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send?.bind(res);

    // Intercept res.json/res.send to know when response is ready
    res.json = (body: any) => {
      originalJson(body);
      resolve();
    };
    if (originalSend) {
      res.send = (body: any) => {
        originalSend(body);
        resolve();
      };
    }

    const next = (err?: any) => {
      if (err) {
        // Simulate errorHandler behavior for ApiErrors
        if (err.statusCode && err.toResponse) {
          res.status(err.statusCode);
          res.json(err.toResponse());
        } else {
          res.status(500);
          res.json({ error: 'Internal', code: 'INTERNAL_ERROR', message: err.message });
        }
      }
      resolve();
    };

    handler(req, res, next);
  });
}

/**
 * Find a route layer in an Express router, searching both direct routes
 * and sub-routers mounted with router.use('/', subRouter).
 */
export function findRouteLayer(router: any, path: string, method: string): any {
  // Check direct routes first
  const direct = router.stack.find((layer: any) =>
    layer.route?.path === path && layer.route?.methods?.[method]
  );
  if (direct) return direct;

  // Search sub-routers
  for (const layer of router.stack) {
    if (!layer.route && layer.handle?.stack) {
      const sub = layer.handle.stack.find((subLayer: any) =>
        subLayer.route?.path === path && subLayer.route?.methods?.[method]
      );
      if (sub) return sub;
    }
  }
  return undefined;
}


let adminRouter: any;

export function getAdminRouter(): any {
  return adminRouter;
}

export function setupAdminApiTestHooks(): void {
  beforeAll(async () => {
    // Import the router after mocks are set up.
    const module = await import('../../../../src/api/admin');
    adminRouter = module.default;
  }, 30000);

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });
}

export {
  mockAuditGetStats,
  mockAuditLogFromRequest,
  mockAuditQuery,
  mockCreateBackup,
  mockReloadElectrumServers,
  mockResetNodeClient,
  mockRestoreFromBackup,
  mockTestNodeConfig,
  mockValidateBackup,
  mockVerifyPassword,
};
