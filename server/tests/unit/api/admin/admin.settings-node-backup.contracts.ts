import { describe, expect, it, vi } from 'vitest';
import { mockPrismaClient } from '../../../mocks/prisma';
import { sampleUsers } from '../../../fixtures/bitcoin';
import {
  createMockNext,
  createMockRequest,
  createMockResponse,
} from '../../../helpers/testUtils';
import * as bcrypt from 'bcryptjs';
import {
  callHandler,
  findRouteLayer,
  getAdminRouter,
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
} from './adminTestHarness';

export function registerAdminSettingsNodeBackupTests(): void {
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await callHandler(handler, req, res);
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

        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await callHandler(handler, req, res);
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

        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await callHandler(handler, req, res);
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

        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await callHandler(handler, req, res);
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

        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
        expect(routeLayer).toBeDefined();
        const handler = routeLayer.route.stack[2].handle;
        await callHandler(handler, req, res);
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
        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
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
        const routeLayer = findRouteLayer(getAdminRouter(), '/encryption-keys', 'post');
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

}
