import { beforeAll, describe, expect, it, vi } from 'vitest';

const {
  mockFixRequestBody,
  mockLogger,
  capturedConfig,
} = vi.hoisted(() => {
  const captured: { value: Record<string, unknown> | null } = { value: null };
  return {
    mockFixRequestBody: vi.fn(),
    mockLogger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    capturedConfig: captured,
  };
});

vi.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: (opts: Record<string, unknown>) => {
    capturedConfig.value = opts;
    return vi.fn();
  },
  fixRequestBody: mockFixRequestBody,
}));

vi.mock('../../../src/config', () => ({
  config: {
    backendUrl: 'http://backend:3000',
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

type ProxyConfig = {
  target: string;
  changeOrigin: boolean;
  on: {
    proxyReq: (proxyReq: unknown, req: unknown) => void;
    proxyRes: (proxyRes: unknown, req: unknown) => void;
    error: (err: unknown, req: unknown, res: unknown) => void;
  };
};

let config: ProxyConfig;

beforeAll(async () => {
  await import('../../../src/routes/proxy/proxyConfig');
  config = capturedConfig.value as ProxyConfig;
});

describe('proxyConfig', () => {
  it('creates proxy middleware with backend target configuration', () => {
    expect(config.target).toBe('http://backend:3000');
    expect(config.changeOrigin).toBe(true);
  });

  it('forwards gateway and authenticated user headers on proxy requests', () => {
    const setHeader = vi.fn();
    const proxyReq = { setHeader } as unknown;
    const req = {
      method: 'POST',
      url: '/api/v1/wallets',
      user: { userId: 'user-1', username: 'alice' },
      body: { hello: 'world' },
    } as unknown;

    config.on.proxyReq(proxyReq, req);

    expect(mockFixRequestBody).toHaveBeenCalledWith(proxyReq, req);
    expect(setHeader).toHaveBeenCalledWith('X-Gateway-User-Id', 'user-1');
    expect(setHeader).toHaveBeenCalledWith('X-Gateway-Username', 'alice');
    expect(setHeader).toHaveBeenCalledWith('X-Gateway-Request', 'true');
  });

  it('always sets gateway marker even when request is unauthenticated', () => {
    const setHeader = vi.fn();
    const proxyReq = { setHeader } as unknown;
    const req = {
      method: 'GET',
      url: '/api/v1/price',
      headers: {},
    } as unknown;

    config.on.proxyReq(proxyReq, req);

    expect(setHeader).toHaveBeenCalledWith('X-Gateway-Request', 'true');
    expect(setHeader).not.toHaveBeenCalledWith('X-Gateway-User-Id', expect.anything());
  });

  it('logs proxy responses and returns 502 payload on proxy errors', () => {
    config.on.proxyRes({ statusCode: 503 }, { method: 'GET', url: '/api/v1/test' });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Proxy response',
      expect.objectContaining({ status: 503 })
    );

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    config.on.error(
      new Error('backend unreachable'),
      { url: '/api/v1/test' },
      { status, json }
    );

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Proxy error',
      expect.objectContaining({ error: 'backend unreachable', path: '/api/v1/test' })
    );
    expect(status).toHaveBeenCalledWith(502);
    expect(json).toHaveBeenCalledWith({
      error: 'Bad Gateway',
      message: 'Unable to reach backend service',
    });
  });
});
