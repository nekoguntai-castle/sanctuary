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

export function registerAdminAuditVersionElectrumTests(): void {
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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
            html_url: 'https://github.com/nekoguntai-castle/sanctuary/releases/tag/v1.1.0',
            name: 'Release 1.1.0',
            published_at: '2024-01-01T00:00:00Z',
            body: 'Release notes',
          }),
        }) as any;

        const req = createMockRequest({});
        const { res, getResponse } = createMockResponse();

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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

        const handler = getAdminRouter().stack.find((layer: any) =>
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
}
