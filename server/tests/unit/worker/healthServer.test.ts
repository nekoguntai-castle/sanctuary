import { describe, it, expect, vi, beforeEach } from 'vitest';

let capturedHandler: ((req: any, res: any) => Promise<void> | void) | null = null;
const serverInstances: any[] = [];
let closeError: Error | null = null;
const { mockLogInfo, mockLogError, mockRegistryMetrics } = vi.hoisted(() => ({
  mockLogInfo: vi.fn(),
  mockLogError: vi.fn(),
  mockRegistryMetrics: vi.fn().mockResolvedValue('# HELP sanctuary_up\nsanctuary_up 1\n'),
}));

vi.mock('http', () => {
  const createServer = (handler: any) => {
    capturedHandler = handler;
    const handlers: Record<string, (err: Error) => void> = {};
    const server = {
      on: vi.fn((event: string, cb: (err: Error) => void) => {
        handlers[event] = cb;
      }),
      listen: vi.fn((_port: number, cb?: () => void) => cb && cb()),
      close: vi.fn((cb?: (err?: Error | null) => void) => cb && cb(closeError)),
      handlers,
    };
    serverInstances.push(server);
    return server;
  };
  return {
    __esModule: true,
    default: { createServer },
    createServer,
  };
});

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: mockLogInfo,
    error: mockLogError,
  }),
}));

vi.mock('../../../src/observability/metrics/registry', () => ({
  registry: {
    metrics: mockRegistryMetrics,
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
  },
}));

import { startHealthServer } from '../../../src/worker/healthServer';

const makeRes = () => {
  const res: any = {};
  res.headers = {};
  res.setHeader = vi.fn((key: string, value: string) => {
    res.headers[key] = value;
  });
  res.writeHead = vi.fn((status: number, headers: Record<string, string>) => {
    res.statusCode = status;
    res.headers = { ...res.headers, ...headers };
  });
  res.end = vi.fn((body?: string) => {
    res.body = body;
  });
  return res;
};

describe('Worker Health Server', () => {
  beforeEach(() => {
    capturedHandler = null;
    serverInstances.length = 0;
    closeError = null;
    vi.clearAllMocks();
  });

  it('responds with healthy status', async () => {
    startHealthServer({
      port: 3005,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const req = { url: '/health' };
    const res = makeRes();

    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.status).toBe('healthy');
  });

  it('handles root path as health endpoint', async () => {
    startHealthServer({
      port: 3004,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true, database: true }),
      },
    });

    const req = { url: '/' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        status: 'healthy',
        components: expect.objectContaining({ database: true }),
      })
    );
  });

  it('treats missing request url as root and returns degraded status when components fail', async () => {
    startHealthServer({
      port: 3016,
      healthProvider: {
        getHealth: async () => ({ redis: false, electrum: true, jobQueue: true }),
      },
    });

    const req = {};
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        status: 'degraded',
      })
    );
  });

  it('responds with readiness failure', async () => {
    startHealthServer({
      port: 3006,
      healthProvider: {
        getHealth: async () => ({ redis: false, electrum: true, jobQueue: false }),
      },
    });

    const req = { url: '/ready' };
    const res = makeRes();

    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toBe('not ready');
  });

  it('responds with readiness success', async () => {
    startHealthServer({
      port: 3008,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: false, jobQueue: true }),
      },
    });

    const req = { url: '/ready' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('ready');
  });

  it('responds with liveness', async () => {
    startHealthServer({
      port: 3009,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const req = { url: '/live' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('alive');
  });

  it('responds with metrics when provider supplies metrics', async () => {
    startHealthServer({
      port: 3007,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
        getMetrics: async () => ({
          queues: { sync: { waiting: 1, active: 0, completed: 2, failed: 0 } },
          electrum: { subscribedAddresses: 5, networks: {} },
        }),
      },
    });

    const req = { url: '/metrics' };
    const res = makeRes();

    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    const payload = JSON.parse(res.body);
    expect(payload.queues.sync.completed).toBe(2);
  });

  it('falls back to health payload for metrics when provider has no metrics method', async () => {
    startHealthServer({
      port: 3010,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: false }),
      },
    });

    const req = { url: '/metrics' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        health: { redis: true, electrum: true, jobQueue: false },
      })
    );
  });

  it('responds with Prometheus text metrics on /metrics/prometheus', async () => {
    startHealthServer({
      port: 3017,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const req = { url: '/metrics/prometheus' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/plain; version=0.0.4; charset=utf-8');
    expect(res.body).toContain('sanctuary_up 1');
    expect(mockRegistryMetrics).toHaveBeenCalled();
  });

  it('returns 404 for unknown routes', async () => {
    startHealthServer({
      port: 3011,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const req = { url: '/unknown' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toBe('Not Found');
  });

  it('returns 500 response when health provider throws', async () => {
    startHealthServer({
      port: 3012,
      healthProvider: {
        getHealth: async () => {
          throw new Error('health exploded');
        },
      },
    });

    const req = { url: '/health' };
    const res = makeRes();
    await capturedHandler?.(req, res);

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body)).toEqual(
      expect.objectContaining({
        status: 'error',
        error: 'Health check failed',
      })
    );
    expect(mockLogError).toHaveBeenCalledWith(
      'Health check error',
      expect.objectContaining({ error: 'health exploded' })
    );
  });

  it('exposes close handle and resolves on successful close', async () => {
    const handle = startHealthServer({
      port: 3013,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    expect(handle.port).toBe(3013);
    await expect(handle.close()).resolves.toBeUndefined();
    expect(mockLogInfo).toHaveBeenCalledWith('Health server closed');
  });

  it('rejects close handle when server close fails', async () => {
    closeError = new Error('close failed');
    const handle = startHealthServer({
      port: 3014,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    await expect(handle.close()).rejects.toThrow('close failed');
    expect(mockLogError).toHaveBeenCalledWith(
      'Health server close error',
      expect.objectContaining({ error: 'close failed' })
    );
  });

  it('logs server error events', () => {
    startHealthServer({
      port: 3015,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const server = serverInstances[0];
    server.handlers.error(new Error('server boom'));
    expect(mockLogError).toHaveBeenCalledWith(
      'Health server error',
      expect.objectContaining({ error: 'server boom' })
    );
  });
});
