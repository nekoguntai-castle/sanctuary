import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';

const mocks = vi.hoisted(() => ({
  mcpApiKeyRepository: {
    findMany: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    revoke: vi.fn(),
  },
  userRepository: {
    findById: vi.fn(),
  },
  walletRepository: {
    hasAccess: vi.fn(),
  },
  logFromRequest: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (req: any, _res: any, next: () => void) => {
    if (req.header('x-skip-user') !== '1') {
      req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    }
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/repositories', () => ({
  mcpApiKeyRepository: mocks.mcpApiKeyRepository,
  userRepository: mocks.userRepository,
  walletRepository: mocks.walletRepository,
}));

vi.mock('../../../src/services/auditService', () => ({
  AuditAction: {
    MCP_KEY_CREATE: 'mcp.key_create',
    MCP_KEY_REVOKE: 'mcp.key_revoke',
  },
  AuditCategory: {
    MCP: 'mcp',
  },
  auditService: {
    logFromRequest: mocks.logFromRequest,
  },
}));

import mcpKeysRouter from '../../../src/api/admin/mcpKeys';

describe('Admin MCP key routes', () => {
  let app: Express;
  const userId = '11111111-1111-4111-8111-111111111111';
  const walletId = '22222222-2222-4222-8222-222222222222';
  const keyId = '33333333-3333-4333-8333-333333333333';
  const now = new Date('2026-04-16T00:00:00.000Z');

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin/mcp-keys', mcpKeysRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userRepository.findById.mockResolvedValue({ id: userId, username: 'alice', isAdmin: false });
    mocks.walletRepository.hasAccess.mockResolvedValue(true);
  });

  it('lists MCP API key metadata without secrets', async () => {
    mocks.mcpApiKeyRepository.findMany.mockResolvedValue([
      {
        id: keyId,
        userId,
        user: { id: userId, username: 'alice', isAdmin: false },
        name: 'Desktop',
        keyPrefix: 'mcp_prefix',
        keyHash: 'secret',
        createdAt: now,
      },
    ]);

    const response = await request(app).get('/api/v1/admin/mcp-keys').expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({ id: keyId, keyPrefix: 'mcp_prefix' });
    expect(response.body[0].keyHash).toBeUndefined();
    expect(mocks.mcpApiKeyRepository.findMany).toHaveBeenCalled();
  });

  it('creates a scoped MCP API key and returns the token once', async () => {
    mocks.mcpApiKeyRepository.create.mockImplementation(async input => ({
      id: keyId,
      userId: input.userId,
      createdByUserId: input.createdByUserId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      scope: input.scope,
      expiresAt: input.expiresAt,
      createdAt: now,
      revokedAt: null,
    }));

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const response = await request(app)
      .post('/api/v1/admin/mcp-keys')
      .send({
        userId,
        name: '  Desktop  ',
        walletIds: [walletId, walletId],
        allowAuditLogs: true,
        expiresAt,
      })
      .expect(201);

    expect(response.body.apiKey).toMatch(/^mcp_[a-f0-9]{64}$/);
    expect(response.body.keyPrefix).toBe(response.body.apiKey.slice(0, 16));
    expect(mocks.walletRepository.hasAccess).toHaveBeenCalledTimes(1);
    expect(mocks.mcpApiKeyRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      userId,
      createdByUserId: 'admin-1',
      name: 'Desktop',
      keyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      keyPrefix: response.body.apiKey.slice(0, 16),
      scope: { walletIds: [walletId], allowAuditLogs: true },
      expiresAt: expect.any(Date),
    }));
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'mcp.key_create', 'mcp', {
      details: expect.objectContaining({
        keyId,
        targetUserId: userId,
        walletScopeCount: 2,
        allowAuditLogs: true,
      }),
    });
  });

  it('creates an unscoped MCP API key with default audit and expiration fields', async () => {
    mocks.mcpApiKeyRepository.create.mockImplementation(async input => ({
      id: keyId,
      userId: input.userId,
      createdByUserId: input.createdByUserId,
      name: input.name,
      keyPrefix: input.keyPrefix,
      scope: input.scope,
      expiresAt: input.expiresAt,
      createdAt: now,
      revokedAt: null,
    }));

    await request(app)
      .post('/api/v1/admin/mcp-keys')
      .set('x-skip-user', '1')
      .send({ userId, name: 'Unscoped' })
      .expect(201);

    expect(mocks.walletRepository.hasAccess).not.toHaveBeenCalled();
    expect(mocks.mcpApiKeyRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      createdByUserId: null,
      name: 'Unscoped',
      scope: { allowAuditLogs: false },
      expiresAt: null,
    }));
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'mcp.key_create', 'mcp', {
      details: expect.objectContaining({
        walletScopeCount: 0,
        allowAuditLogs: false,
        expiresAt: undefined,
      }),
    });
  });

  it('rejects invalid create input, unknown users, inaccessible wallets, and past expiration', async () => {
    await request(app).post('/api/v1/admin/mcp-keys').send({ userId, name: '' }).expect(400);

    await request(app)
      .post('/api/v1/admin/mcp-keys')
      .send({ userId, name: 'expired', expiresAt: new Date(Date.now() - 1000).toISOString() })
      .expect(400);

    mocks.userRepository.findById.mockResolvedValueOnce(null);
    await request(app).post('/api/v1/admin/mcp-keys').send({ userId, name: 'missing' }).expect(404);

    mocks.walletRepository.hasAccess.mockResolvedValueOnce(false);
    await request(app).post('/api/v1/admin/mcp-keys').send({ userId, name: 'bad wallet', walletIds: [walletId] }).expect(400);
  });

  it('revokes active keys and handles already revoked keys idempotently', async () => {
    mocks.mcpApiKeyRepository.findById.mockResolvedValueOnce({
      id: keyId,
      userId,
      keyPrefix: 'mcp_prefix',
      revokedAt: null,
    });
    mocks.mcpApiKeyRepository.revoke.mockResolvedValueOnce({
      id: keyId,
      userId,
      keyPrefix: 'mcp_prefix',
      revokedAt: now,
    });

    const response = await request(app).delete(`/api/v1/admin/mcp-keys/${keyId}`).expect(200);

    expect(response.body.revokedAt).toBe(now.toISOString());
    expect(mocks.mcpApiKeyRepository.revoke).toHaveBeenCalledWith(keyId);
    expect(mocks.logFromRequest).toHaveBeenCalledWith(expect.anything(), 'mcp.key_revoke', 'mcp', {
      details: expect.objectContaining({ keyId, alreadyRevoked: false }),
    });

    mocks.mcpApiKeyRepository.findById.mockResolvedValueOnce({
      id: keyId,
      userId,
      keyPrefix: 'mcp_prefix',
      revokedAt: now,
    });
    await request(app).delete(`/api/v1/admin/mcp-keys/${keyId}`).expect(200);
    expect(mocks.mcpApiKeyRepository.revoke).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid and missing key ids on revoke', async () => {
    await request(app).delete('/api/v1/admin/mcp-keys/not-a-uuid').expect(400);

    mocks.mcpApiKeyRepository.findById.mockResolvedValueOnce(null);
    await request(app).delete(`/api/v1/admin/mcp-keys/${keyId}`).expect(404);
  });
});
