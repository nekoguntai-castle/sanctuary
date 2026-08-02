import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

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
import {
  DIAGNOSTICS_NONCE_HEADER,
  DIAGNOSTICS_SIGNATURE_HEADER,
  DIAGNOSTICS_TIMESTAMP_HEADER,
  signDiagnosticsRequest,
} from '../../../src/internal/workerDiagnostics/auth';
import { WORKER_DIAGNOSTICS_PATH } from '../../../src/internal/workerDiagnostics/protocol';

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

const diagnosticsSnapshot = {
  protocolVersion: 1 as const,
  sampledAt: '2026-08-02T00:00:00.000Z',
  worker: { readiness: 'ready' as const, uptime: '<1m' as const, concurrency: '2-5' as const },
  notificationPipeline: { consumerRunning: true, transactionHandlerRegistered: true },
  redis: { state: 'connected' as const },
  database: { state: 'connected' as const },
  electrum: {
    managerRunning: true,
    connected: true,
    subscriptionOwner: true,
    subscribedAddresses: '2-5' as const,
  },
  telegram: {
    circuitState: 'closed' as const,
    failures: '0' as const,
    totalRequests: '1' as const,
    lastFailureAge: 'never' as const,
    lastSuccessAge: 'never' as const,
    lastFailureClass: 'none' as const,
  },
  notificationTelemetryWriter: { observation: 'unavailable' as const },
};

async function dispatchDiagnostics(
  body: string,
  secret: string,
  nonce = 'a'.repeat(32),
) {
  const auth = signDiagnosticsRequest(secret, 'POST', WORKER_DIAGNOSTICS_PATH, body, Date.now(), nonce);
  const req = new EventEmitter() as any;
  req.url = WORKER_DIAGNOSTICS_PATH;
  req.method = 'POST';
  req.headers = {
    [DIAGNOSTICS_TIMESTAMP_HEADER]: auth.timestamp,
    [DIAGNOSTICS_NONCE_HEADER]: auth.nonce,
    [DIAGNOSTICS_SIGNATURE_HEADER]: auth.signature,
  };
  req.resume = vi.fn();
  const res = makeRes();
  const pending = capturedHandler?.(req, res);
  req.emit('data', Buffer.from(body));
  req.emit('end');
  await pending;
  return res;
}

async function dispatchRawDiagnostics(
  req: any,
  emit: (request: EventEmitter) => void,
) {
  const request = Object.assign(new EventEmitter(), req) as any;
  request.resume ??= vi.fn();
  const res = makeRes();
  const pending = capturedHandler?.(request, res);
  emit(request);
  await pending;
  return { req: request, res };
}

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

  it('degrades health and readiness when required recurring schedules are absent', async () => {
    startHealthServer({
      port: 3018,
      healthProvider: {
        getHealth: async () => ({
          redis: true,
          electrum: true,
          jobQueue: true,
          recurringSchedules: false,
        }),
      },
    });

    const healthRes = makeRes();
    await capturedHandler?.({ url: '/health' }, healthRes);
    expect(healthRes.statusCode).toBe(503);

    const readyRes = makeRes();
    await capturedHandler?.({ url: '/ready' }, readyRes);
    expect(readyRes.statusCode).toBe(503);
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

  it('rejects non-GET requests to legacy health routes', async () => {
    startHealthServer({
      port: 3009,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });

    const res = makeRes();
    await capturedHandler?.({ url: '/health', method: 'POST' }, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toBe('Method Not Allowed');
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

  it('serves an authenticated privacy-safe diagnostics snapshot once', async () => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3019,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const body = JSON.stringify({ protocolVersion: 1 });
    const first = await dispatchDiagnostics(body, secret);
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body)).toEqual(diagnosticsSnapshot);

    const replay = await dispatchDiagnostics(body, secret);
    expect(replay.statusCode).toBe(401);
    expect(JSON.parse(replay.body)).toEqual({ error: 'unauthorized' });
  });

  it('reports diagnostics as unavailable when the handler is not configured', async () => {
    startHealthServer({
      port: 3019,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
    });
    const resume = vi.fn();
    const res = makeRes();

    await capturedHandler?.({
      url: WORKER_DIAGNOSTICS_PATH,
      method: 'POST',
      resume,
    }, res);

    expect(res.statusCode).toBe(503);
    expect(resume).toHaveBeenCalledOnce();
  });

  it('fails closed when diagnostics is configured without a secret', async () => {
    startHealthServer({
      port: 3019,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret: '',
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const { req, res } = await dispatchRawDiagnostics({
      url: WORKER_DIAGNOSTICS_PATH,
      method: 'POST',
      headers: {},
    }, () => undefined);

    expect(res.statusCode).toBe(503);
    expect(req.resume).toHaveBeenCalledOnce();
  });

  it('rejects wrong methods and reports unsupported protocol versions', async () => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3020,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const methodRes = makeRes();
    await capturedHandler?.({ url: WORKER_DIAGNOSTICS_PATH, method: 'GET' }, methodRes);
    expect(methodRes.statusCode).toBe(405);

    const unsupported = await dispatchDiagnostics(
      JSON.stringify({ protocolVersion: 2 }),
      secret,
      'b'.repeat(32),
    );
    expect(unsupported.statusCode).toBe(426);
    expect(JSON.parse(unsupported.body)).toEqual({
      error: 'unsupported_protocol',
      supportedVersions: [1],
    });
  });

  it('uses fixed failures for invalid authentication and oversized bodies', async () => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3021,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const unauthorized = await dispatchDiagnostics(
      JSON.stringify({ protocolVersion: 1 }),
      'x'.repeat(32),
    );
    expect(unauthorized.statusCode).toBe(401);
    expect(JSON.parse(unauthorized.body)).toEqual({ error: 'unauthorized' });

    const oversized = makeRes();
    await capturedHandler?.({
      url: WORKER_DIAGNOSTICS_PATH,
      method: 'POST',
      headers: { 'content-length': '129' },
      resume: vi.fn(),
    }, oversized);
    expect(oversized.statusCode).toBe(413);
    expect(JSON.parse(oversized.body)).toEqual({ error: 'request_too_large' });
  });

  it.each([
    ['malformed JSON', '{', 400, 'invalid_request'],
    ['unexpected fields', JSON.stringify({ protocolVersion: 1, private: 'value' }), 400, 'invalid_request'],
    ['primitive JSON', '1', 426, 'unsupported_protocol'],
  ])('rejects %s after authentication', async (_label, body, status, error) => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3021,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const response = await dispatchDiagnostics(body, secret);

    expect(response.statusCode).toBe(status);
    expect(JSON.parse(response.body)).toMatchObject({ error });
  });

  it('accepts array-valued auth headers and string body chunks', async () => {
    const secret = 's'.repeat(32);
    const body = JSON.stringify({ protocolVersion: 1 });
    const auth = signDiagnosticsRequest(secret, 'POST', WORKER_DIAGNOSTICS_PATH, body);
    startHealthServer({
      port: 3021,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const { res } = await dispatchRawDiagnostics({
      url: WORKER_DIAGNOSTICS_PATH,
      method: 'POST',
      headers: {
        [DIAGNOSTICS_TIMESTAMP_HEADER]: [auth.timestamp],
        [DIAGNOSTICS_NONCE_HEADER]: [auth.nonce],
        [DIAGNOSTICS_SIGNATURE_HEADER]: [auth.signature],
      },
    }, (req) => {
      req.emit('data', body);
      req.emit('end');
    });

    expect(res.statusCode).toBe(200);
  });

  it('rejects a streamed body that crosses the byte limit', async () => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3021,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 4,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const { req, res } = await dispatchRawDiagnostics({
      url: WORKER_DIAGNOSTICS_PATH,
      method: 'POST',
      headers: {},
    }, (request) => request.emit('data', Buffer.from('12345')));

    expect(res.statusCode).toBe(413);
    expect(req.resume).toHaveBeenCalledTimes(2);
  });

  it.each(['error', 'aborted'])('maps request %s events to a fixed timeout response', async (event) => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3021,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    const { res } = await dispatchRawDiagnostics({
      url: WORKER_DIAGNOSTICS_PATH,
      method: 'POST',
      headers: {},
    }, (request) => request.emit(event, new Error('private request failure')));

    expect(res.statusCode).toBe(408);
    expect(JSON.parse(res.body)).toEqual({ error: 'request_timeout' });
  });

  it('bounds diagnostics request body read time', async () => {
    vi.useFakeTimers();
    try {
      const secret = 's'.repeat(32);
      startHealthServer({
        port: 3021,
        healthProvider: {
          getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
        },
        diagnostics: {
          secret,
          timeoutMs: 100,
          maxBodyBytes: 128,
          maxConcurrentRequests: 1,
          authWindowMs: 60_000,
          getSnapshot: () => diagnosticsSnapshot,
        },
      });

      const pending = dispatchRawDiagnostics({
        url: WORKER_DIAGNOSTICS_PATH,
        method: 'POST',
        headers: {},
      }, () => undefined);
      await vi.advanceTimersByTimeAsync(101);

      expect((await pending).res.statusCode).toBe(408);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns unavailable when a snapshot fails schema validation', async () => {
    const secret = 's'.repeat(32);
    startHealthServer({
      port: 3021,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => ({ private: 'invalid' }) as never,
      },
    });

    const response = await dispatchDiagnostics(JSON.stringify({ protocolVersion: 1 }), secret);

    expect(response.statusCode).toBe(503);
    expect(JSON.parse(response.body)).toEqual({ error: 'diagnostics_unavailable' });
  });

  it('bounds diagnostics snapshot execution time', async () => {
    vi.useFakeTimers();
    try {
      const secret = 's'.repeat(32);
      startHealthServer({
        port: 3022,
        healthProvider: {
          getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
        },
        diagnostics: {
          secret,
          timeoutMs: 100,
          maxBodyBytes: 128,
          maxConcurrentRequests: 1,
          authWindowMs: 60_000,
          getSnapshot: () => new Promise<typeof diagnosticsSnapshot>(() => undefined),
        },
      });

      const pending = dispatchDiagnostics(JSON.stringify({ protocolVersion: 1 }), secret);
      await vi.advanceTimersByTimeAsync(101);
      const response = await pending;
      expect(response.statusCode).toBe(503);
      expect(JSON.parse(response.body)).toEqual({ error: 'diagnostics_unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects diagnostics requests beyond the concurrency bound', async () => {
    const secret = 's'.repeat(32);
    let resolveSnapshot: ((value: typeof diagnosticsSnapshot) => void) | undefined;
    const blockedSnapshot = new Promise<typeof diagnosticsSnapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    startHealthServer({
      port: 3023,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret,
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => blockedSnapshot,
      },
    });

    const body = JSON.stringify({ protocolVersion: 1 });
    const first = dispatchDiagnostics(body, secret, 'c'.repeat(32));
    await Promise.resolve();
    await Promise.resolve();
    const busy = await dispatchDiagnostics(body, secret, 'd'.repeat(32));
    expect(busy.statusCode).toBe(429);
    expect(JSON.parse(busy.body)).toEqual({ error: 'diagnostics_busy' });

    resolveSnapshot?.(diagnosticsSnapshot);
    expect((await first).statusCode).toBe(200);
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

  it('clears diagnostics replay state when the server closes', async () => {
    const handle = startHealthServer({
      port: 3013,
      healthProvider: {
        getHealth: async () => ({ redis: true, electrum: true, jobQueue: true }),
      },
      diagnostics: {
        secret: 's'.repeat(32),
        timeoutMs: 1000,
        maxBodyBytes: 128,
        maxConcurrentRequests: 1,
        authWindowMs: 60_000,
        getSnapshot: () => diagnosticsSnapshot,
      },
    });

    await expect(handle.close()).resolves.toBeUndefined();
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
