import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { mockPrismaClient, resetPrismaMocks } from '../../mocks/prisma';

const mocks = vi.hoisted(() => ({
  testNodeConfig: vi.fn(),
  reloadElectrumServers: vi.fn(),
}));

vi.mock('../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  testNodeConfig: mocks.testNodeConfig,
}));

vi.mock('../../../src/services/bitcoin/electrumPool', () => ({
  reloadElectrumServers: mocks.reloadElectrumServers,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import electrumServersRouter from '../../../src/api/admin/electrumServers';
import { errorHandler } from '../../../src/errors/errorHandler';

function buildNodeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'default',
    isDefault: true,
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    ...overrides,
  };
}

function buildServer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'srv-1',
    nodeConfigId: 'default',
    network: 'mainnet',
    label: 'Primary',
    host: 'electrum.example.com',
    port: 50002,
    useSsl: true,
    priority: 0,
    enabled: true,
    healthCheckFails: 0,
    supportsVerbose: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('admin electrum servers router', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/electrum-servers', electrumServersRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
    mocks.testNodeConfig.mockResolvedValue({
      success: true,
      message: 'Connected',
      info: { blockHeight: 850000, supportsVerbose: true },
    });
    mocks.reloadElectrumServers.mockResolvedValue(undefined);
  });

  it('GET / returns empty list when no default node config exists', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/admin/electrum-servers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET / supports optional network filtering', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());
    mockPrismaClient.electrumServer.findMany.mockResolvedValue([buildServer()]);

    const response = await request(app)
      .get('/api/v1/admin/electrum-servers')
      .query({ network: 'mainnet' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.electrumServer.findMany).toHaveBeenCalledWith({
      where: {
        nodeConfigId: 'default',
        network: 'mainnet',
      },
      orderBy: { priority: 'asc' },
    });
    expect(response.body).toHaveLength(1);
  });

  it('GET / without network filter queries by nodeConfigId only', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());
    mockPrismaClient.electrumServer.findMany.mockResolvedValue([buildServer()]);

    const response = await request(app).get('/api/v1/admin/electrum-servers');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.electrumServer.findMany).toHaveBeenCalledWith({
      where: {
        nodeConfigId: 'default',
      },
      orderBy: { priority: 'asc' },
    });
  });

  it('GET / returns 500 when lookup fails', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockRejectedValue(new Error('db failure'));

    const response = await request(app).get('/api/v1/admin/electrum-servers');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('POST /test-connection validates required params', async () => {
    const response = await request(app)
      .post('/api/v1/admin/electrum-servers/test-connection')
      .send({ host: 'electrum.example.com' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Host and port are required');
  });

  it('POST /test-connection proxies to nodeClient test', async () => {
    const response = await request(app)
      .post('/api/v1/admin/electrum-servers/test-connection')
      .send({ host: 'electrum.example.com', port: '50002', useSsl: true });

    expect(response.status).toBe(200);
    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'electrum.example.com',
      port: 50002,
      protocol: 'ssl',
    });
    expect(response.body).toMatchObject({
      success: true,
      message: 'Connected',
      blockHeight: 850000,
    });
  });

  it('POST /test-connection uses tcp protocol when useSsl is false', async () => {
    const response = await request(app)
      .post('/api/v1/admin/electrum-servers/test-connection')
      .send({ host: 'electrum.example.com', port: '50002', useSsl: false });

    expect(response.status).toBe(200);
    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'electrum.example.com',
      port: 50002,
      protocol: 'tcp',
    });
  });

  it('POST /test-connection returns 500 on unexpected error', async () => {
    mocks.testNodeConfig.mockRejectedValue(new Error('connection test failed'));

    const response = await request(app)
      .post('/api/v1/admin/electrum-servers/test-connection')
      .send({ host: 'electrum.example.com', port: '50002', useSsl: true });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('PUT /reorder validates serverIds payload', async () => {
    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/reorder')
      .send({ serverIds: 'not-an-array' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('serverIds must be an array');
  });

  it('PUT /reorder updates priorities and reloads pool', async () => {
    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/reorder')
      .send({ serverIds: ['srv-3', 'srv-1', 'srv-2'] });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledTimes(3);
    expect(mockPrismaClient.electrumServer.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'srv-3' },
      data: { priority: 0 },
    });
    expect(mocks.reloadElectrumServers).toHaveBeenCalledTimes(1);
  });

  it('PUT /reorder returns 500 when priority updates fail', async () => {
    mockPrismaClient.electrumServer.update.mockRejectedValue(new Error('update failed'));

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/reorder')
      .send({ serverIds: ['srv-1'] });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('GET /:network rejects invalid networks', async () => {
    const response = await request(app).get('/api/v1/admin/electrum-servers/invalid');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid network');
  });

  it('GET /:network returns servers for valid network', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());
    mockPrismaClient.electrumServer.findMany.mockResolvedValue([
      buildServer({ id: 'srv-testnet', network: 'testnet' }),
    ]);

    const response = await request(app).get('/api/v1/admin/electrum-servers/testnet');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.electrumServer.findMany).toHaveBeenCalledWith({
      where: {
        nodeConfigId: 'default',
        network: 'testnet',
      },
      orderBy: { priority: 'asc' },
    });
    expect(response.body[0].id).toBe('srv-testnet');
  });

  it('GET /:network returns empty array when node config is missing', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);

    const response = await request(app).get('/api/v1/admin/electrum-servers/mainnet');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
  });

  it('GET /:network returns 500 on database error', async () => {
    mockPrismaClient.nodeConfig.findFirst.mockRejectedValue(new Error('lookup failed'));

    const response = await request(app).get('/api/v1/admin/electrum-servers/mainnet');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('POST / validates required fields', async () => {
    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({ host: 'electrum.example.com', port: 50002 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('required');
  });

  it('POST / rejects duplicate servers for same host/port/network', async () => {
    mockPrismaClient.electrumServer.findFirst.mockResolvedValue(
      buildServer({ label: 'Existing Mainnet' })
    );

    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({
        label: 'Duplicate',
        host: 'electrum.example.com',
        port: 50002,
        network: 'mainnet',
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('already exists');
  });

  it('POST / rejects invalid network values', async () => {
    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({
        label: 'Bad Network',
        host: 'electrum.example.com',
        port: 50002,
        network: 'bitcoin-mainnet',
      });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid network');
  });

  it('POST / creates server (and default node config if absent)', async () => {
    mockPrismaClient.electrumServer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ priority: 4 });
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
    mockPrismaClient.nodeConfig.create.mockResolvedValue(buildNodeConfig());
    mockPrismaClient.electrumServer.create.mockResolvedValue(
      buildServer({ id: 'srv-new', label: 'New Server', priority: 5 })
    );

    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({
        label: 'New Server',
        host: 'new.electrum.example',
        port: '50001',
        network: 'mainnet',
        useSsl: true,
      });

    expect(response.status).toBe(201);
    expect(mockPrismaClient.nodeConfig.create).toHaveBeenCalledTimes(1);
    expect(mockPrismaClient.electrumServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          label: 'New Server',
          host: 'new.electrum.example',
          port: 50001,
          priority: 5,
          network: 'mainnet',
        }),
      })
    );
    expect(mocks.reloadElectrumServers).toHaveBeenCalledTimes(1);
  });

  it('POST / defaults node config useSsl to true when omitted during bootstrap', async () => {
    mockPrismaClient.electrumServer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
    mockPrismaClient.nodeConfig.create.mockResolvedValue(buildNodeConfig({ useSsl: true }));
    mockPrismaClient.electrumServer.create.mockResolvedValue(
      buildServer({ id: 'srv-bootstrap-default-ssl', useSsl: true, priority: 0 })
    );

    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({
        label: 'Bootstrap Default SSL',
        host: 'bootstrap-default-ssl.electrum.example',
        port: 50001,
      });

    expect(response.status).toBe(201);
    expect(mockPrismaClient.nodeConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          useSsl: true,
        }),
      })
    );
  });

  it('POST / creates server with existing node config and default optional values', async () => {
    mockPrismaClient.electrumServer.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig({ id: 'default-existing' }));
    mockPrismaClient.electrumServer.create.mockResolvedValue(
      buildServer({ id: 'srv-defaults', nodeConfigId: 'default-existing', useSsl: true, priority: 0, enabled: true })
    );

    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({
        label: 'Defaults Server',
        host: 'defaults.electrum.example',
        port: 50003,
      });

    expect(response.status).toBe(201);
    expect(mockPrismaClient.nodeConfig.create).not.toHaveBeenCalled();
    expect(mockPrismaClient.electrumServer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          nodeConfig: { connect: { id: 'default-existing' } },
          useSsl: true,
          priority: 0,
          enabled: true,
          network: 'mainnet',
        }),
      })
    );
  });

  it('POST / returns 500 when create flow throws', async () => {
    mockPrismaClient.electrumServer.findFirst.mockResolvedValueOnce(null);
    mockPrismaClient.nodeConfig.findFirst.mockRejectedValue(new Error('node config read failed'));

    const response = await request(app)
      .post('/api/v1/admin/electrum-servers')
      .send({
        label: 'New Server',
        host: 'new.electrum.example',
        port: 50001,
      });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('PUT /:id returns 404 for unknown server', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(null);

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/srv-missing')
      .send({ label: 'Updated' });

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('not found');
  });

  it('PUT /:id rejects duplicates on update', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));
    mockPrismaClient.electrumServer.findFirst.mockResolvedValue(
      buildServer({ id: 'srv-2', label: 'Duplicate target' })
    );

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/srv-1')
      .send({
        host: 'electrum.example.com',
        port: 50002,
        network: 'mainnet',
      });

    expect(response.status).toBe(409);
    expect(response.body.message).toContain('already exists');
  });

  it('PUT /:id updates server and reloads pool', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));
    mockPrismaClient.electrumServer.findFirst.mockResolvedValue(null);
    mockPrismaClient.electrumServer.update.mockResolvedValue(
      buildServer({ id: 'srv-1', label: 'Updated Label', enabled: false })
    );

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/srv-1')
      .send({ label: 'Updated Label', enabled: false });

    expect(response.status).toBe(200);
    expect(response.body.label).toBe('Updated Label');
    expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledTimes(1);
    expect(mocks.reloadElectrumServers).toHaveBeenCalledTimes(1);
  });

  it('PUT /:id keeps existing values for omitted fields and parses provided port', async () => {
    const existing = buildServer({ id: 'srv-1', label: 'Existing', host: 'old.host', port: 50002, priority: 3 });
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(existing);
    mockPrismaClient.electrumServer.findFirst.mockResolvedValue(null);
    mockPrismaClient.electrumServer.update.mockResolvedValue(
      buildServer({ ...existing, port: 51002 })
    );

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/srv-1')
      .send({ port: '51002' });

    expect(response.status).toBe(200);
    expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'srv-1' },
        data: expect.objectContaining({
          label: 'Existing',
          host: 'old.host',
          port: 51002,
          useSsl: existing.useSsl,
          priority: 3,
          enabled: existing.enabled,
        }),
      })
    );
  });

  it('PUT /:id rejects invalid network values', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/srv-1')
      .send({ network: 'btc-mainnet' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('Invalid network');
  });

  it('PUT /:id returns 500 when update flow throws', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));
    mockPrismaClient.electrumServer.findFirst.mockResolvedValue(null);
    mockPrismaClient.electrumServer.update.mockRejectedValue(new Error('write failed'));

    const response = await request(app)
      .put('/api/v1/admin/electrum-servers/srv-1')
      .send({ label: 'Updated Label' });

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('DELETE /:id returns 404 for unknown server', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(null);

    const response = await request(app).delete('/api/v1/admin/electrum-servers/srv-missing');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('not found');
  });

  it('DELETE /:id deletes server and reloads pool', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));
    mockPrismaClient.electrumServer.delete.mockResolvedValue(buildServer({ id: 'srv-1' }));

    const response = await request(app).delete('/api/v1/admin/electrum-servers/srv-1');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockPrismaClient.electrumServer.delete).toHaveBeenCalledWith({
      where: { id: 'srv-1' },
    });
    expect(mocks.reloadElectrumServers).toHaveBeenCalledTimes(1);
  });

  it('DELETE /:id returns 500 when delete throws', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));
    mockPrismaClient.electrumServer.delete.mockRejectedValue(new Error('delete failed'));

    const response = await request(app).delete('/api/v1/admin/electrum-servers/srv-1');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('POST /:id/test returns 404 for unknown server', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(null);

    const response = await request(app).post('/api/v1/admin/electrum-servers/srv-missing/test');

    expect(response.status).toBe(404);
    expect(response.body.message).toContain('not found');
  });

  it('POST /:id/test tests connection and updates health fields', async () => {
    const server = buildServer({
      id: 'srv-1',
      host: 'health.electrum.example',
      port: 51002,
      useSsl: false,
      healthCheckFails: 2,
    });
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(server);
    mockPrismaClient.electrumServer.update.mockResolvedValue({
      ...server,
      isHealthy: true,
    });

    const response = await request(app).post('/api/v1/admin/electrum-servers/srv-1/test');

    expect(response.status).toBe(200);
    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'health.electrum.example',
      port: 51002,
      protocol: 'tcp',
    });
    expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'srv-1' },
        data: expect.objectContaining({
          isHealthy: true,
          healthCheckFails: 0,
          supportsVerbose: true,
        }),
      })
    );
    expect(response.body).toMatchObject({
      success: true,
      info: { blockHeight: 850000, supportsVerbose: true },
    });
  });

  it('POST /:id/test tracks failed health checks and returns error payload', async () => {
    const server = buildServer({
      id: 'srv-2',
      healthCheckFails: 3,
      useSsl: true,
    });
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(server);
    mocks.testNodeConfig.mockResolvedValue({
      success: false,
      message: 'Connection refused',
      info: undefined,
    });
    mockPrismaClient.electrumServer.update.mockResolvedValue({
      ...server,
      isHealthy: false,
      healthCheckFails: 4,
      lastHealthCheckError: 'Connection refused',
    });

    const response = await request(app).post('/api/v1/admin/electrum-servers/srv-2/test');

    expect(response.status).toBe(200);
    expect(mockPrismaClient.electrumServer.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'srv-2' },
        data: expect.objectContaining({
          isHealthy: false,
          healthCheckFails: 4,
          lastHealthCheckError: 'Connection refused',
        }),
      })
    );
    expect(response.body).toMatchObject({
      success: false,
      message: 'Connection refused',
      error: 'Connection refused',
    });
  });

  it('POST /:id/test returns 500 when test throws', async () => {
    mockPrismaClient.electrumServer.findUnique.mockResolvedValue(buildServer({ id: 'srv-1' }));
    mocks.testNodeConfig.mockRejectedValue(new Error('health check failed'));

    const response = await request(app).post('/api/v1/admin/electrum-servers/srv-1/test');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
