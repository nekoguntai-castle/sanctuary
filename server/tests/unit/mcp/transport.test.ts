import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
  authenticateMcpRequest: vi.fn(),
  consumeRateLimit: vi.fn(),
  auditLog: vi.fn(),
  getClientInfo: vi.fn(),
  getMcpHealth: vi.fn(),
  connect: vi.fn(),
  serverClose: vi.fn(),
  handleRequest: vi.fn(),
  transportClose: vi.fn(),
  recordMcpRequest: vi.fn(),
  authFailuresInc: vi.fn(),
  rateLimitHitsInc: vi.fn(),
  metricsHandler: vi.fn((_req: unknown, res: { type: (value: string) => unknown; send: (value: string) => unknown }) => {
    res.type('text/plain');
    res.send('metrics');
  }),
}));

vi.mock('@modelcontextprotocol/sdk/server/express.js', async () => {
  const express = (await import('express')).default;
  return {
    createMcpExpressApp: vi.fn(() => {
      const app = express();
      app.use(express.json());
      return app;
    }),
  };
});

vi.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: vi.fn(function StreamableHTTPServerTransport() {
    return {
    handleRequest: mocks.handleRequest,
    close: mocks.transportClose,
    };
  }),
}));

vi.mock('../../../src/config', () => ({
  default: {
    mcp: {
      host: '127.0.0.1',
      port: 3003,
      allowedHosts: ['localhost'],
    },
  },
}));

vi.mock('../../../src/services/rateLimiting', () => ({
  rateLimitService: {
    consume: mocks.consumeRateLimit,
  },
}));

vi.mock('../../../src/services/auditService', () => ({
  AuditAction: {
    MCP_OPERATION: 'mcp.operation',
    MCP_OPERATION_FAILED: 'mcp.operation_failed',
  },
  AuditCategory: {
    MCP: 'mcp',
  },
  auditService: {
    log: mocks.auditLog,
  },
  getClientInfo: mocks.getClientInfo,
}));

vi.mock('../../../src/middleware/metrics', () => ({
  metricsHandler: mocks.metricsHandler,
}));

vi.mock('../../../src/mcp/auth', () => ({
  authenticateMcpRequest: mocks.authenticateMcpRequest,
}));

vi.mock('../../../src/mcp/health', () => ({
  getMcpHealth: mocks.getMcpHealth,
}));

vi.mock('../../../src/mcp/index', () => ({
  createSanctuaryMcpServer: vi.fn(() => ({
    connect: mocks.connect,
    close: mocks.serverClose,
  })),
}));

vi.mock('../../../src/mcp/metrics', () => ({
  mcpAuthFailuresTotal: {
    inc: mocks.authFailuresInc,
  },
  mcpRateLimitHitsTotal: {
    inc: mocks.rateLimitHitsInc,
  },
  recordMcpRequest: mocks.recordMcpRequest,
}));

import { createMcpHttpApp } from '../../../src/mcp/transport';
import { McpUnauthorizedError, type McpRequestContext } from '../../../src/mcp/types';

describe('MCP HTTP transport', () => {
  const context: McpRequestContext = {
    keyId: 'key-1',
    keyPrefix: 'mcp_prefix',
    userId: 'user-1',
    username: 'alice',
    isAdmin: true,
    scope: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getClientInfo.mockReturnValue({ ipAddress: '127.0.0.1', userAgent: 'agent' });
    mocks.getMcpHealth.mockResolvedValue({
      status: 'ok',
      dependencies: { database: true, redis: true },
      mcp: { enabled: true },
    });
    mocks.authenticateMcpRequest.mockResolvedValue(context);
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: true,
      limit: 120,
      remaining: 119,
      resetAt: Date.now() + 60_000,
    });
    mocks.handleRequest.mockImplementation((_req, res) => {
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', result: { ok: true }, id: 1 }));
    });
  });

  it('serves health and metrics endpoints', async () => {
    const app = createMcpHttpApp();

    await request(app).get('/health').expect(200).expect(response => {
      expect(response.body.status).toBe('ok');
    });

    mocks.getMcpHealth.mockResolvedValueOnce({ status: 'degraded' });
    await request(app).get('/health').expect(503);

    await request(app).get('/metrics').expect(200).expect(response => {
      expect(response.text).toBe('metrics');
    });
  });

  it('rejects unsupported MCP methods with JSON-RPC errors', async () => {
    const app = createMcpHttpApp();

    await request(app).get('/mcp').expect(405).expect('Allow', 'POST').expect(response => {
      expect(response.body.error.message).toBe('Method not allowed.');
    });
    await request(app).delete('/mcp').expect(405).expect('Allow', 'POST');
  });

  it('validates the protocol version before authentication', async () => {
    const app = createMcpHttpApp();

    await request(app)
      .post('/mcp')
      .send({ method: 'tools/call', params: { name: 'query_transactions' } })
      .expect(400)
      .expect(response => {
        expect(response.body.error.message).toContain('MCP-Protocol-Version');
      });

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2024-01-01')
      .send({ method: 'resources/read', params: { uri: 'not a url' } })
      .expect(400)
      .expect(response => {
        expect(response.body.error.message).toContain('Unsupported MCP protocol version');
      });

    expect(mocks.authenticateMcpRequest).not.toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      username: 'anonymous',
      action: 'mcp.operation_failed',
    }));
  });

  it('classifies unknown and generic MCP operations for auditing and metrics', async () => {
    const app = createMcpHttpApp();

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-11-25')
      .expect(202);
    expect(mocks.recordMcpRequest).toHaveBeenLastCalledWith('unknown', 202, expect.any(Number));

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-11-25')
      .send({})
      .expect(202);
    expect(mocks.recordMcpRequest).toHaveBeenLastCalledWith('unknown', 202, expect.any(Number));

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-11-25')
      .send({ method: 'initialize' })
      .expect(202);
    expect(mocks.recordMcpRequest).toHaveBeenLastCalledWith('initialize', 202, expect.any(Number));
  });

  it('records authentication failures', async () => {
    const app = createMcpHttpApp();
    mocks.authenticateMcpRequest.mockRejectedValueOnce(new McpUnauthorizedError('bad token'));

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-11-25')
      .send({ method: 'prompts/get', params: { name: 'wallet_health' } })
      .expect(401)
      .expect(response => {
        expect(response.body.error.message).toBe('bad token');
      });

    expect(mocks.authFailuresInc).toHaveBeenCalledWith({ reason: 'unauthorized' });
    expect(mocks.recordMcpRequest).toHaveBeenCalledWith('prompt:wallet_health', 401, expect.any(Number));
  });

  it('rejects requests that exceed the MCP rate limit', async () => {
    const app = createMcpHttpApp();
    mocks.consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 120,
      remaining: 0,
      resetAt: 60_000,
      retryAfter: 30,
    });

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-11-25')
      .send([{ method: 'tools/list' }])
      .expect(429)
      .expect('Retry-After', '30')
      .expect(response => {
        expect(response.body.error.message).toBe('Rate limit exceeded');
      });

    expect(mocks.rateLimitHitsInc).toHaveBeenCalled();
    expect(mocks.handleRequest).not.toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      errorMsg: 'rate_limit_exceeded',
      details: expect.objectContaining({ operation: 'batch', keyId: 'key-1' }),
    }));
  });

  it('omits Retry-After when the rate limiter has no retry window', async () => {
    const app = createMcpHttpApp();
    mocks.consumeRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 120,
      remaining: 0,
      resetAt: 60_000,
    });

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-11-25')
      .send({ method: 'tools/list' })
      .expect(429)
      .expect(response => {
        expect(response.headers['retry-after']).toBeUndefined();
      });
  });

  it('connects a stateless MCP server for successful POST requests', async () => {
    const app = createMcpHttpApp();

    const response = await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-06-18')
      .send({ method: 'tools/call', params: { name: 'query_transactions' }, id: 1 });

    expect({
      status: response.status,
      body: response.body,
      auditCalls: mocks.auditLog.mock.calls,
    }).toMatchObject({ status: 202 });
    expect(response.headers['x-ratelimit-limit']).toBe('120');

    expect(mocks.connect).toHaveBeenCalled();
    expect(mocks.handleRequest).toHaveBeenCalledWith(expect.objectContaining({
      auth: expect.objectContaining({ clientId: 'mcp-key:key-1' }),
    }), expect.anything(), expect.objectContaining({ method: 'tools/call' }));
    expect(mocks.transportClose).toHaveBeenCalled();
    expect(mocks.serverClose).toHaveBeenCalled();
    expect(mocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'mcp.operation',
      success: true,
      details: expect.objectContaining({ operation: 'tool:query_transactions' }),
    }));
    expect(mocks.recordMcpRequest).toHaveBeenCalledWith('tool:query_transactions', 202, expect.any(Number));
  });

  it('returns generic transport errors without double-sending responses', async () => {
    const app = createMcpHttpApp();
    mocks.handleRequest.mockRejectedValueOnce(new Error('boom'));

    await request(app)
      .post('/mcp')
      .set('mcp-protocol-version', '2025-03-26')
      .send({ method: 'resources/read', params: { uri: '::::' } })
      .expect(500)
      .expect(response => {
        expect(response.body.error.message).toBe('Internal server error');
      });
  });

  it('uses the outer route catch when an unexpected rejection escapes the handler', async () => {
    const app = createMcpHttpApp();
    mocks.auditLog.mockRejectedValueOnce(new Error('audit down'));

    await request(app)
      .post('/mcp')
      .send({ method: 'tools/list' })
      .expect(500)
      .expect(response => {
        expect(response.body.error.message).toBe('Internal server error');
      });
  });
});
