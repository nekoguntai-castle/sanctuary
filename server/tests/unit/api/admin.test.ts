import { vi } from 'vitest';
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

import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';
import { sampleUsers } from '../../fixtures/bitcoin';
import {
  createMockRequest,
  createMockResponse,
  createMockNext,
  generateTestToken,
} from '../../helpers/testUtils';
import * as bcrypt from 'bcryptjs';

// Mock Prisma
vi.mock('../../../src/models/prisma', () => ({
  __esModule: true,
  default: mockPrismaClient,
}));

// Mock config
vi.mock('../../../src/config', () => ({
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

vi.mock('../../../src/services/auditService', () => ({
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

vi.mock('../../../src/services/backupService', () => ({
  backupService: {
    createBackup: mockCreateBackup,
    validateBackup: mockValidateBackup,
    restoreFromBackup: mockRestoreFromBackup,
  },
}));

// Mock node client
const mockTestNodeConfig = vi.fn();
const mockResetNodeClient = vi.fn();

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  testNodeConfig: mockTestNodeConfig,
  resetNodeClient: mockResetNodeClient,
}));

// Mock electrum pool
const mockReloadElectrumServers = vi.fn();

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  reloadElectrumServers: mockReloadElectrumServers,
}));

// Mock encryption
vi.mock('../../../src/utils/encryption', () => ({
  encrypt: vi.fn((data: string) => `encrypted_${data}`),
  decrypt: vi.fn((data: string) => data.replace('encrypted_', '')),
}));

// Mock password validation
const mockVerifyPassword = vi.fn().mockResolvedValue(true);
vi.mock('../../../src/utils/password', () => ({
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
vi.mock('../../../src/utils/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

// Mock constants
vi.mock('../../../src/constants', () => ({
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
}));

// Mock websocket server to prevent import chain to tiny-secp256k1
vi.mock('../../../src/websocket/server', () => ({
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
 * Find a route layer in an Express router, searching both direct routes
 * and sub-routers mounted with router.use('/', subRouter).
 */
function findRouteLayer(router: any, path: string, method: string): any {
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

describe('Admin API', () => {
  let adminRouter: any;

  beforeAll(async () => {
    // Import the router after mocks are set up
    const module = await import('../../../src/api/admin');
    adminRouter = module.default;
  }, 30000);

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });

  // ========================================
  // USER MANAGEMENT
  // ========================================

  describe('User Management', () => {
    describe('GET /users', () => {
      it('should list all users for admin', async () => {
        const mockUsers = [
          {
            id: 'user-1',
            username: 'user1',
            email: 'user1@example.com',
            isAdmin: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          {
            id: 'user-2',
            username: 'user2',
            email: 'user2@example.com',
            isAdmin: true,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ];

        mockPrismaClient.user.findMany.mockResolvedValue(mockUsers);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body).toEqual(mockUsers);
        }
      });

      it('should reject non-admin access', async () => {
        const req = createMockRequest({
          user: { userId: 'user-1', username: 'user', isAdmin: false },
        });
        const { res, getResponse } = createMockResponse();
        const next = createMockNext();

        // Import and test requireAdmin middleware
        const { requireAdmin } = await import('../../../src/middleware/auth');
        requireAdmin(req as any, res as any, next);

        const response = getResponse();
        expect(response.statusCode).toBe(403);
        expect(next).not.toHaveBeenCalled();
      });
    });

    describe('POST /users', () => {
      it('should create a new user as admin', async () => {
        const newUser = {
          username: 'newuser',
          password: 'SecurePass123',
          email: 'newuser@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(null); // No existing user
        mockPrismaClient.user.create.mockResolvedValue({
          id: 'user-new',
          username: newUser.username,
          email: newUser.email,
          isAdmin: newUser.isAdmin,
          createdAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newUser,
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.username).toBe(newUser.username);
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should reject user creation with weak password', async () => {
        const newUser = {
          username: 'newuser',
          password: 'weak',
          email: 'newuser@example.com',
          isAdmin: false,
        };

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newUser,
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('security requirements');
        }
      });

      it('should reject duplicate username', async () => {
        const newUser = {
          username: 'existinguser',
          password: 'SecurePass123',
          email: 'new@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue({
          id: 'existing-user',
          username: 'existinguser',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newUser,
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(409);
          expect(response.body.message).toContain('already exists');
        }
      });

      it('should validate required fields', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { username: 'testuser' }, // Missing password
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('required');
        }
      });

      it('should validate username length', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { username: 'ab', password: 'SecurePass123' }, // Too short
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('at least 3 characters');
        }
      });
    });

    describe('PUT /users/:userId', () => {
      it('should update user details', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'oldusername',
          email: 'old@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique
          .mockResolvedValueOnce(existingUser) // First call to get user
          .mockResolvedValueOnce(null); // Second call to check if email is taken
        mockPrismaClient.user.update.mockResolvedValue({
          ...existingUser,
          email: 'new@example.com',
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { email: 'new@example.com' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.email).toBe('new@example.com');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should update user password', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          isAdmin: false,
          password: 'old-hash',
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(existingUser);
        mockPrismaClient.user.update.mockResolvedValue({
          ...existingUser,
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { password: 'NewSecurePass123' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockPrismaClient.user.update).toHaveBeenCalled();
        }
      });

      it('should update admin status and log appropriately', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(existingUser);
        mockPrismaClient.user.update.mockResolvedValue({
          ...existingUser,
          isAdmin: true,
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
            expect.anything(),
            'user.admin_grant',
            expect.anything(),
            expect.anything()
          );
        }
      });

      it('should return 404 for non-existent user', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'non-existent' },
          body: { email: 'new@example.com' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('not found');
        }
      });

      it('should reject duplicate email', async () => {
        const existingUser = {
          id: 'user-1',
          username: 'user1',
          email: 'user1@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique
          .mockResolvedValueOnce(existingUser)
          .mockResolvedValueOnce({ id: 'other-user', email: 'taken@example.com' });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
          body: { email: 'taken@example.com' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(409);
          expect(response.body.message).toContain('already exists');
        }
      });
    });

    describe('DELETE /users/:userId', () => {
      it('should delete user', async () => {
        const userToDelete = {
          id: 'user-1',
          username: 'testuser',
          email: 'test@example.com',
          isAdmin: false,
        };

        mockPrismaClient.user.findUnique.mockResolvedValue(userToDelete);
        mockPrismaClient.user.delete.mockResolvedValue(userToDelete);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.message).toContain('deleted successfully');
          expect(mockPrismaClient.user.delete).toHaveBeenCalledWith({
            where: { id: 'user-1' },
          });
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should prevent self-deletion', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'admin-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('Cannot delete your own account');
        }
      });

      it('should return 404 for non-existent user', async () => {
        mockPrismaClient.user.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { userId: 'non-existent' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/users/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('not found');
        }
      });
    });
  });

  // ========================================
  // GROUP MANAGEMENT
  // ========================================

  describe('Group Management', () => {
    describe('GET /groups', () => {
      it('should list all groups with members', async () => {
        const mockGroups = [
          {
            id: 'group-1',
            name: 'Accounting',
            description: 'Finance team',
            purpose: 'accounting',
            createdAt: new Date(),
            updatedAt: new Date(),
            members: [
              {
                userId: 'user-1',
                role: 'member',
                user: { id: 'user-1', username: 'user1' },
              },
            ],
          },
        ];

        mockPrismaClient.group.findMany.mockResolvedValue(mockGroups);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(Array.isArray(response.body)).toBe(true);
        }
      });
    });

    describe('POST /groups', () => {
      it('should create a new group', async () => {
        const newGroup = {
          name: 'Engineering',
          description: 'Dev team',
          purpose: 'development',
        };

        mockPrismaClient.group.create.mockResolvedValue({
          id: 'group-new',
          ...newGroup,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        mockPrismaClient.group.findUnique.mockResolvedValue({
          id: 'group-new',
          ...newGroup,
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [],
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newGroup,
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.name).toBe(newGroup.name);
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should create group with initial members', async () => {
        const newGroup = {
          name: 'Team Alpha',
          description: 'Alpha team',
          memberIds: ['user-1', 'user-2'],
        };

        mockPrismaClient.group.create.mockResolvedValue({
          id: 'group-new',
          name: newGroup.name,
          description: newGroup.description,
          purpose: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        mockPrismaClient.user.findMany.mockResolvedValue([
          { id: 'user-1' },
          { id: 'user-2' },
        ]);

        mockPrismaClient.groupMember.createMany.mockResolvedValue({ count: 2 });

        mockPrismaClient.group.findUnique.mockResolvedValue({
          id: 'group-new',
          name: newGroup.name,
          description: newGroup.description,
          purpose: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          members: [
            {
              userId: 'user-1',
              role: 'member',
              user: { id: 'user-1', username: 'user1' },
            },
            {
              userId: 'user-2',
              role: 'member',
              user: { id: 'user-2', username: 'user2' },
            },
          ],
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newGroup,
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalled();
        }
      });

      it('should require group name', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { description: 'No name' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('required');
        }
      });
    });

    describe('PUT /groups/:groupId', () => {
      it('should update group details', async () => {
        const existingGroup = {
          id: 'group-1',
          name: 'Old Name',
          description: 'Old description',
          purpose: null,
          members: [],
        };

        mockPrismaClient.group.findUnique
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce({
            ...existingGroup,
            name: 'New Name',
            updatedAt: new Date(),
            members: [],
          });

        mockPrismaClient.group.update.mockResolvedValue({
          ...existingGroup,
          name: 'New Name',
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { name: 'New Name' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.name).toBe('New Name');
        }
      });

      it('should update group members', async () => {
        const existingGroup = {
          id: 'group-1',
          name: 'Team',
          description: null,
          purpose: null,
          members: [
            { userId: 'user-1', role: 'member' },
            { userId: 'user-2', role: 'member' },
          ],
        };

        mockPrismaClient.group.findUnique
          .mockResolvedValueOnce(existingGroup)
          .mockResolvedValueOnce({
            ...existingGroup,
            members: [
              {
                userId: 'user-1',
                role: 'member',
                user: { id: 'user-1', username: 'user1' },
              },
              {
                userId: 'user-3',
                role: 'member',
                user: { id: 'user-3', username: 'user3' },
              },
            ],
          });

        mockPrismaClient.group.update.mockResolvedValue(existingGroup);
        mockPrismaClient.groupMember.deleteMany.mockResolvedValue({ count: 1 });
        mockPrismaClient.user.findMany.mockResolvedValue([{ id: 'user-3' }]);
        mockPrismaClient.groupMember.createMany.mockResolvedValue({ count: 1 });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { memberIds: ['user-1', 'user-3'] },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockPrismaClient.groupMember.deleteMany).toHaveBeenCalled();
          expect(mockPrismaClient.groupMember.createMany).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent group', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'non-existent' },
          body: { name: 'New Name' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('not found');
        }
      });
    });

    describe('DELETE /groups/:groupId', () => {
      it('should delete group', async () => {
        const groupToDelete = {
          id: 'group-1',
          name: 'Old Group',
        };

        mockPrismaClient.group.findUnique.mockResolvedValue(groupToDelete);
        mockPrismaClient.group.delete.mockResolvedValue(groupToDelete);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.message).toContain('deleted successfully');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent group', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'non-existent' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
        }
      });
    });

    describe('POST /groups/:groupId/members', () => {
      it('should add member to group', async () => {
        const group = { id: 'group-1', name: 'Team' };
        const user = { id: 'user-1', username: 'user1' };

        mockPrismaClient.group.findUnique.mockResolvedValue(group);
        mockPrismaClient.user.findUnique.mockResolvedValue(user);
        mockPrismaClient.groupMember.findUnique.mockResolvedValue(null);
        mockPrismaClient.groupMember.create.mockResolvedValue({
          groupId: 'group-1',
          userId: 'user-1',
          role: 'member',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { userId: 'user-1', role: 'member' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.userId).toBe('user-1');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should reject adding non-existent user', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' });
        mockPrismaClient.user.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { userId: 'non-existent' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
          expect(response.body.message).toContain('User not found');
        }
      });

      it('should reject duplicate membership', async () => {
        mockPrismaClient.group.findUnique.mockResolvedValue({ id: 'group-1' });
        mockPrismaClient.user.findUnique.mockResolvedValue({ id: 'user-1' });
        mockPrismaClient.groupMember.findUnique.mockResolvedValue({
          userId: 'user-1',
          groupId: 'group-1',
          role: 'member',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1' },
          body: { userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(409);
          expect(response.body.message).toContain('already a member');
        }
      });
    });

    describe('DELETE /groups/:groupId/members/:userId', () => {
      it('should remove member from group', async () => {
        mockPrismaClient.groupMember.findUnique.mockResolvedValue({
          userId: 'user-1',
          groupId: 'group-1',
          role: 'member',
        });
        mockPrismaClient.groupMember.delete.mockResolvedValue({});

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1', userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.message).toContain('removed');
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent membership', async () => {
        mockPrismaClient.groupMember.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { groupId: 'group-1', userId: 'user-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/groups/:groupId/members/:userId' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
        }
      });
    });
  });

  // ========================================
  // SYSTEM SETTINGS
  // ========================================

  describe('System Settings', () => {
    describe('GET /settings', () => {
      it('should return system settings with defaults', async () => {
        mockPrismaClient.systemSetting.findMany.mockResolvedValue([
          { key: 'confirmationThreshold', value: '3' },
          { key: 'dustThreshold', value: '1000' },
        ]);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/settings' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body).toHaveProperty('confirmationThreshold');
          expect(response.body).toHaveProperty('dustThreshold');
        }
      });
    });

    describe('PUT /settings', () => {
      it('should update system settings', async () => {
        mockPrismaClient.systemSetting.findMany.mockResolvedValue([]);
        mockPrismaClient.systemSetting.upsert.mockResolvedValue({
          key: 'confirmationThreshold',
          value: '3',
        });
        mockPrismaClient.systemSetting.findMany.mockResolvedValueOnce([
          { key: 'confirmationThreshold', value: '3' },
        ]);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { confirmationThreshold: 3 },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/settings' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should validate confirmation thresholds relationship', async () => {
        mockPrismaClient.systemSetting.findMany.mockResolvedValue([
          { key: 'confirmationThreshold', value: '6' },
          { key: 'deepConfirmationThreshold', value: '10' },
        ]);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            confirmationThreshold: 10,
            deepConfirmationThreshold: 5,
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/settings' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('Deep confirmation threshold');
        }
      });
    });
  });

  // ========================================
  // NODE CONFIGURATION
  // ========================================

  describe('Node Configuration', () => {
    describe('GET /node-config', () => {
      it('should return existing node config', async () => {
        const nodeConfig = {
          id: 'default',
          type: 'electrum',
          host: 'localhost',
          port: 50001,
          useSsl: true,
          allowSelfSignedCert: false,
          username: null,
          password: null,
          explorerUrl: 'https://mempool.space',
          feeEstimatorUrl: 'https://mempool.space',
          mempoolEstimator: 'simple',
          poolEnabled: true,
          poolMinConnections: 1,
          poolMaxConnections: 5,
          poolLoadBalancing: 'round_robin',
          isDefault: true,
          servers: [],
        };

        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(nodeConfig);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.type).toBe('electrum');
          expect(response.body.host).toBe('localhost');
        }
      });

      it('should return default config when none exists', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.type).toBe('electrum');
          expect(response.body.host).toBe('electrum.blockstream.info');
        }
      });
    });

    describe('PUT /node-config', () => {
      it('should update node configuration', async () => {
        const existingConfig = {
          id: 'default',
          type: 'electrum',
          host: 'old.server.com',
          port: 50001,
          useSsl: true,
          isDefault: true,
        };

        const updatedConfig = {
          ...existingConfig,
          host: 'new.server.com',
          port: 50002,
        };

        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(existingConfig);
        mockPrismaClient.nodeConfig.update.mockResolvedValue(updatedConfig);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            type: 'electrum',
            host: 'new.server.com',
            port: 50002,
            useSsl: true,
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockResetNodeClient).toHaveBeenCalled();
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should create new node config if none exists', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
        mockPrismaClient.nodeConfig.create.mockResolvedValue({
          id: 'default',
          type: 'electrum',
          host: 'localhost',
          port: 50001,
          useSsl: true,
          isDefault: true,
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            type: 'electrum',
            host: 'localhost',
            port: 50001,
            useSsl: true,
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockPrismaClient.nodeConfig.create).toHaveBeenCalled();
        }
      });

      it('should validate required fields', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { type: 'electrum' }, // Missing host and port
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('required');
        }
      });

      it('should validate node type', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            type: 'invalid',
            host: 'localhost',
            port: 50001,
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message.toLowerCase()).toContain('electrum');
        }
      });
    });

    describe('POST /node-config/test', () => {
      it('should test successful connection', async () => {
        mockTestNodeConfig.mockResolvedValue({
          success: true,
          message: 'Connected successfully',
          info: { blockHeight: 800000 },
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            type: 'electrum',
            host: 'localhost',
            port: 50001,
            useSsl: true,
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config/test' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.success).toBe(true);
          expect(response.body.blockHeight).toBe(800000);
        }
      });

      it('should handle failed connection', async () => {
        mockTestNodeConfig.mockResolvedValue({
          success: false,
          message: 'Connection refused',
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            type: 'electrum',
            host: 'invalid.server',
            port: 50001,
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/node-config/test' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(500);
          expect(response.body.success).toBe(false);
        }
      });
    });
  });

  // ========================================
  // BACKUP & RESTORE
  // ========================================

  describe('Backup & Restore', () => {
    describe('POST /backup', () => {
      it('should create backup', async () => {
        const mockBackup = {
          version: '1.0',
          meta: {
            createdAt: new Date().toISOString(),
            createdBy: 'admin',
            recordCounts: { users: 5, wallets: 3 },
          },
          data: {
            users: [],
            wallets: [],
          },
        };

        mockCreateBackup.mockResolvedValue(mockBackup);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { includeCache: false, description: 'Test backup' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/backup' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.version).toBe('1.0');
          expect(mockCreateBackup).toHaveBeenCalledWith('admin', {
            includeCache: false,
            description: 'Test backup',
          });
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });
    });

    describe('POST /backup/validate', () => {
      it('should validate valid backup', async () => {
        const mockValidation = {
          valid: true,
          issues: [],
        };

        mockValidateBackup.mockResolvedValue(mockValidation);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            backup: {
              version: '1.0',
              meta: {},
              data: {},
            },
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/backup/validate' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.valid).toBe(true);
        }
      });

      it('should detect invalid backup', async () => {
        const mockValidation = {
          valid: false,
          issues: ['Missing version', 'Invalid data structure'],
        };

        mockValidateBackup.mockResolvedValue(mockValidation);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { backup: {} },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/backup/validate' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.valid).toBe(false);
          expect(response.body.issues.length).toBeGreaterThan(0);
        }
      });

      it('should require backup data', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {},
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/backup/validate' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('Missing backup data');
        }
      });
    });

    describe('POST /restore', () => {
      it('should restore from valid backup with confirmation', async () => {
        const mockBackup = {
          version: '1.0',
          meta: {
            createdAt: new Date().toISOString(),
            createdBy: 'admin',
            recordCounts: {},
          },
          data: {},
        };

        mockValidateBackup.mockResolvedValue({ valid: true, issues: [] });
        mockRestoreFromBackup.mockResolvedValue({
          success: true,
          tablesRestored: 5,
          recordsRestored: 100,
          warnings: [],
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            backup: mockBackup,
            confirmationCode: 'CONFIRM_RESTORE',
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/restore' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.success).toBe(true);
          expect(response.body.tablesRestored).toBe(5);
          expect(mockAuditLogFromRequest).toHaveBeenCalled();
        }
      });

      it('should require confirmation code', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            backup: { version: '1.0', meta: {}, data: {} },
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/restore' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('CONFIRM_RESTORE');
        }
      });

      it('should reject invalid backup before restore', async () => {
        mockValidateBackup.mockResolvedValue({
          valid: false,
          issues: ['Invalid structure'],
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {
            backup: {},
            confirmationCode: 'CONFIRM_RESTORE',
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/restore' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('validation failed');
        }
      });
    });
  });

  // ========================================
  // ENCRYPTION KEYS
  // ========================================

  describe('Encryption Keys', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      // Reset environment variables before each test
      process.env = { ...originalEnv };
      process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-long!';
      process.env.ENCRYPTION_SALT = 'test-encryption-salt-value';
    });

    afterAll(() => {
      // Restore original environment
      process.env = originalEnv;
    });

    describe('POST /encryption-keys', () => {
      it('should return encryption keys for admin users with valid password', async () => {
        mockVerifyPassword.mockResolvedValueOnce(true);
        mockPrismaClient.user.findUnique.mockResolvedValueOnce({ password: 'hashed-password' });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { password: 'correct-password' },
        });
        const { res, getResponse } = createMockResponse();

        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await handler(req, res);
        const response = getResponse();
        expect(response.statusCode).toBe(200);
        expect(response.body.encryptionKey).toBe('test-encryption-key-32-chars-long!');
        expect(response.body.encryptionSalt).toBe('test-encryption-salt-value');
        expect(response.body.hasEncryptionKey).toBe(true);
        expect(response.body.hasEncryptionSalt).toBe(true);
      });

      it('should reject requests without password with 400', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: {},
        });
        const { res, getResponse } = createMockResponse();

        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await handler(req, res);
        const response = getResponse();
        expect(response.statusCode).toBe(400);
        expect(response.body.message).toBe('Password confirmation required to view encryption keys');
      });

      it('should reject incorrect password with 401', async () => {
        mockVerifyPassword.mockResolvedValueOnce(false);
        mockPrismaClient.user.findUnique.mockResolvedValueOnce({ password: 'hashed-password' });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { password: 'wrong-password' },
        });
        const { res, getResponse } = createMockResponse();

        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await handler(req, res);
        const response = getResponse();
        expect(response.statusCode).toBe(401);
        expect(response.body.message).toBe('Incorrect password');
      });

      it('should audit log the access', async () => {
        mockAuditLogFromRequest.mockClear();
        mockVerifyPassword.mockResolvedValueOnce(true);
        mockPrismaClient.user.findUnique.mockResolvedValueOnce({ password: 'hashed-password' });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { password: 'correct-password' },
        });
        const { res } = createMockResponse();

        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await handler(req, res);
        expect(mockAuditLogFromRequest).toHaveBeenCalledWith(
          req,
          'admin.encryption_keys_view',
          'admin',
          expect.objectContaining({
            details: { action: 'view_encryption_keys' },
          })
        );
      });

      it('should return empty strings and false flags when keys are not set', async () => {
        // Clear the environment variables
        delete process.env.ENCRYPTION_KEY;
        delete process.env.ENCRYPTION_SALT;
        mockVerifyPassword.mockResolvedValueOnce(true);
        mockPrismaClient.user.findUnique.mockResolvedValueOnce({ password: 'hashed-password' });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { password: 'correct-password' },
        });
        const { res, getResponse } = createMockResponse();

        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await handler(req, res);
        const response = getResponse();
        expect(response.statusCode).toBe(200);
        expect(response.body.encryptionKey).toBe('');
        expect(response.body.encryptionSalt).toBe('');
        expect(response.body.hasEncryptionKey).toBe(false);
        expect(response.body.hasEncryptionSalt).toBe(false);
      });

      it('should reject non-admin users with 403', async () => {
        const req = createMockRequest({
          user: { userId: 'user-1', username: 'regularuser', isAdmin: false },
          body: { password: 'some-password' },
        });
        const { res, getResponse } = createMockResponse();

        // For non-admin, the requireAdmin middleware (stack[1]) should reject
        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const middlewareStack = routeLayer.route.stack;
        const requireAdminMiddleware = middlewareStack[1].handle;
        const next = createMockNext();

        await requireAdminMiddleware(req, res, next);
        const response = getResponse();

        // requireAdmin should return 403 for non-admin
        expect(response.statusCode).toBe(403);
        expect(response.body.error).toBe('Forbidden');
      });

      it('should reject unauthenticated requests with 401', async () => {
        const req = createMockRequest({
          // No user attached - unauthenticated
          body: { password: 'some-password' },
        });
        const { res, getResponse } = createMockResponse();

        // For unauthenticated, the authenticate middleware (stack[0]) should reject
        const routeLayer = findRouteLayer(adminRouter, '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const middlewareStack = routeLayer.route.stack;
        const authenticateMiddleware = middlewareStack[0].handle;
        const next = createMockNext();

        await authenticateMiddleware(req, res, next);
        const response = getResponse();

        // authenticate should return 401 for unauthenticated
        expect(response.statusCode).toBe(401);
      });
    });
  });

  // ========================================
  // AUDIT LOGS
  // ========================================

  describe('Audit Logs', () => {
    describe('GET /audit-logs', () => {
      it('should return audit logs with filters', async () => {
        const mockLogs = {
          logs: [
            {
              id: 'log-1',
              userId: 'user-1',
              username: 'user1',
              action: 'user.login',
              category: 'auth',
              success: true,
              createdAt: new Date(),
            },
          ],
          total: 1,
        };

        mockAuditQuery.mockResolvedValue(mockLogs);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          query: {
            userId: 'user-1',
            action: 'login',
            limit: '50',
            offset: '0',
          },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/audit-logs' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.logs).toBeDefined();
          expect(mockAuditQuery).toHaveBeenCalled();
        }
      });

      it('should apply default pagination limits', async () => {
        mockAuditQuery.mockResolvedValue({ logs: [], total: 0 });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          query: {},
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/audit-logs' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockAuditQuery).toHaveBeenCalledWith(
            expect.objectContaining({
              limit: 50,
              offset: 0,
            })
          );
        }
      });
    });

    describe('GET /audit-logs/stats', () => {
      it('should return audit statistics', async () => {
        const mockStats = {
          totalEvents: 150,
          byAction: { 'user.login': 50, 'user.logout': 30 },
          byCategory: { auth: 80, user: 40 },
          byUser: { 'user-1': 75, 'user-2': 75 },
        };

        mockAuditGetStats.mockResolvedValue(mockStats);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          query: { days: '30' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/audit-logs/stats' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.totalEvents).toBe(150);
          expect(mockAuditGetStats).toHaveBeenCalledWith(30);
        }
      });

      it('should use default days parameter', async () => {
        mockAuditGetStats.mockResolvedValue({
          totalEvents: 0,
          byAction: {},
          byCategory: {},
          byUser: {},
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          query: {},
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/audit-logs/stats' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(mockAuditGetStats).toHaveBeenCalledWith(30);
        }
      });
    });
  });

  // ========================================
  // VERSION CHECK
  // ========================================

  describe('Version Check', () => {
    describe('GET /version', () => {
      it('should return current version info', async () => {
        // Mock fetch for GitHub API
        global.fetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            tag_name: 'v1.1.0',
            html_url: 'https://github.com/nekoguntai/sanctuary/releases/tag/v1.1.0',
            name: 'Release 1.1.0',
            published_at: '2024-01-01T00:00:00Z',
            body: 'Release notes',
          }),
        }) as any;

        const req = createMockRequest({});
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/version' && layer.route?.methods?.get
        )?.route?.stack?.[0]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.currentVersion).toBeDefined();
          expect(response.body.latestVersion).toBeDefined();
          expect(response.body.updateAvailable).toBeDefined();
        }
      });

      it('should handle GitHub API failure gracefully', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('Network error')) as any;

        const req = createMockRequest({});
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/version' && layer.route?.methods?.get
        )?.route?.stack?.[0]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.currentVersion).toBeDefined();
        }
      });
    });
  });

  // ========================================
  // ELECTRUM SERVER MANAGEMENT
  // ========================================

  describe('Electrum Server Management', () => {
    describe('GET /electrum-servers', () => {
      it('should list all electrum servers', async () => {
        const mockNodeConfig = { id: 'default', isDefault: true };
        const mockServers = [
          {
            id: 'server-1',
            nodeConfigId: 'default',
            label: 'Primary',
            host: 'electrum1.example.com',
            port: 50002,
            useSsl: true,
            priority: 0,
            enabled: true,
          },
          {
            id: 'server-2',
            nodeConfigId: 'default',
            label: 'Backup',
            host: 'electrum2.example.com',
            port: 50002,
            useSsl: true,
            priority: 1,
            enabled: true,
          },
        ];

        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(mockNodeConfig);
        mockPrismaClient.electrumServer.findMany.mockResolvedValue(mockServers);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.length).toBe(2);
        }
      });

      it('should return empty array when no node config exists', async () => {
        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers' && layer.route?.methods?.get
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body).toEqual([]);
        }
      });
    });

    describe('POST /electrum-servers', () => {
      it('should add new electrum server', async () => {
        const mockNodeConfig = { id: 'default', isDefault: true };
        const newServer = {
          label: 'New Server',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          priority: 0,
          enabled: true,
        };

        mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(mockNodeConfig);
        mockPrismaClient.electrumServer.findFirst.mockResolvedValue(null);
        mockPrismaClient.electrumServer.create.mockResolvedValue({
          id: 'server-new',
          nodeConfigId: 'default',
          ...newServer,
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: newServer,
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(201);
          expect(response.body.label).toBe(newServer.label);
          expect(mockReloadElectrumServers).toHaveBeenCalled();
        }
      });

      it('should validate required fields', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { label: 'Test' }, // Missing host and port
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('required');
        }
      });
    });

    describe('PUT /electrum-servers/:id', () => {
      it('should update electrum server', async () => {
        const existingServer = {
          id: 'server-1',
          label: 'Old Label',
          host: 'old.example.com',
          port: 50002,
          useSsl: true,
          priority: 0,
          enabled: true,
          network: 'mainnet',
        };

        mockPrismaClient.electrumServer.findUnique.mockResolvedValue(existingServer);
        mockPrismaClient.electrumServer.update.mockResolvedValue({
          ...existingServer,
          label: 'New Label',
          updatedAt: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { id: 'server-1' },
          body: { label: 'New Label' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/:id' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.label).toBe('New Label');
          expect(mockReloadElectrumServers).toHaveBeenCalled();
        }
      });

      it('should return 404 for non-existent server', async () => {
        mockPrismaClient.electrumServer.findUnique.mockResolvedValue(null);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { id: 'non-existent' },
          body: { label: 'New Label' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/:id' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(404);
        }
      });
    });

    describe('DELETE /electrum-servers/:id', () => {
      it('should delete electrum server', async () => {
        const serverToDelete = {
          id: 'server-1',
          label: 'Old Server',
        };

        mockPrismaClient.electrumServer.findUnique.mockResolvedValue(serverToDelete);
        mockPrismaClient.electrumServer.delete.mockResolvedValue(serverToDelete);

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { id: 'server-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/:id' && layer.route?.methods?.delete
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.success).toBe(true);
          expect(mockReloadElectrumServers).toHaveBeenCalled();
        }
      });
    });

    describe('POST /electrum-servers/:id/test', () => {
      it('should test server connection and update health', async () => {
        const server = {
          id: 'server-1',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          healthCheckFails: 0,
        };

        mockPrismaClient.electrumServer.findUnique.mockResolvedValue(server);
        mockTestNodeConfig.mockResolvedValue({
          success: true,
          message: 'Connected',
          info: { blockHeight: 800000 },
        });
        mockPrismaClient.electrumServer.update.mockResolvedValue({
          ...server,
          isHealthy: true,
          lastHealthCheck: new Date(),
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { id: 'server-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/:id/test' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.success).toBe(true);
          expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                isHealthy: true,
                healthCheckFails: 0,
              }),
            })
          );
        }
      });

      it('should update health on failed test', async () => {
        const server = {
          id: 'server-1',
          host: 'electrum.example.com',
          port: 50002,
          useSsl: true,
          healthCheckFails: 2,
        };

        mockPrismaClient.electrumServer.findUnique.mockResolvedValue(server);
        mockTestNodeConfig.mockResolvedValue({
          success: false,
          message: 'Connection failed',
        });
        mockPrismaClient.electrumServer.update.mockResolvedValue({
          ...server,
          isHealthy: false,
          healthCheckFails: 3,
        });

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          params: { id: 'server-1' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/:id/test' && layer.route?.methods?.post
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.success).toBe(false);
          expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                isHealthy: false,
                healthCheckFails: 3,
              }),
            })
          );
        }
      });
    });

    describe('PUT /electrum-servers/reorder', () => {
      it('should reorder servers', async () => {
        const serverIds = ['server-3', 'server-1', 'server-2'];

        mockPrismaClient.electrumServer.update.mockResolvedValue({});

        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { serverIds },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/reorder' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(200);
          expect(response.body.success).toBe(true);
          expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledTimes(3);
          expect(mockReloadElectrumServers).toHaveBeenCalled();
        }
      });

      it('should validate serverIds is array', async () => {
        const req = createMockRequest({
          user: { userId: 'admin-1', username: 'admin', isAdmin: true },
          body: { serverIds: 'not-an-array' },
        });
        const { res, getResponse } = createMockResponse();

        const handler = adminRouter.stack.find((layer: any) =>
          layer.route?.path === '/electrum-servers/reorder' && layer.route?.methods?.put
        )?.route?.stack?.[2]?.handle;

        if (handler) {
          await handler(req, res);
          const response = getResponse();
          expect(response.statusCode).toBe(400);
          expect(response.body.message).toContain('array');
        }
      });
    });
  });
});
