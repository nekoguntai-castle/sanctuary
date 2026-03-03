import { describe, expect, it, vi } from 'vitest';

const {
  mockCreateProxyMiddleware,
  mockFixRequestBody,
  mockLogger,
} = vi.hoisted(() => ({
  mockCreateProxyMiddleware: vi.fn((_opts: unknown) => vi.fn()),
  mockFixRequestBody: vi.fn(),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('http-proxy-middleware', () => ({
  createProxyMiddleware: mockCreateProxyMiddleware,
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

import { proxy } from '../../../src/routes/proxy/proxyConfig';
import { proxyOptions } from '../../../src/routes/proxy/proxyConfig';

describe('proxyConfig', () => {
  it('creates proxy middleware with backend target configuration', () => {
    expect(proxy).toBeTypeOf('function');
    expect(proxyOptions.target).toBe('http://backend:3000');
    expect(proxyOptions.changeOrigin).toBe(true);
    expect(proxyOptions.logLevel).toBe('silent');
  });

  it('forwards gateway and authenticated user headers on proxy requests', () => {
    const setHeader = vi.fn();
    const proxyReq = { setHeader } as any;
    const req = {
      method: 'POST',
      path: '/api/v1/wallets',
      user: { userId: 'user-1', username: 'alice' },
      body: { hello: 'world' },
    } as any;

    proxyOptions.onProxyReq?.(proxyReq, req);

    expect(mockFixRequestBody).toHaveBeenCalledWith(proxyReq, req);
    expect(setHeader).toHaveBeenCalledWith('X-Gateway-User-Id', 'user-1');
    expect(setHeader).toHaveBeenCalledWith('X-Gateway-Username', 'alice');
    expect(setHeader).toHaveBeenCalledWith('X-Gateway-Request', 'true');
  });

  it('always sets gateway marker even when request is unauthenticated', () => {
    const setHeader = vi.fn();
    const proxyReq = { setHeader } as any;
    const req = {
      method: 'GET',
      path: '/api/v1/price',
      headers: {},
    } as any;

    proxyOptions.onProxyReq?.(proxyReq, req);

    expect(setHeader).toHaveBeenCalledWith('X-Gateway-Request', 'true');
    expect(setHeader).not.toHaveBeenCalledWith('X-Gateway-User-Id', expect.anything());
  });

  it('logs proxy responses and returns 502 payload on proxy errors', () => {
    proxyOptions.onProxyRes?.({ statusCode: 503 }, { method: 'GET', path: '/api/v1/test' });
    expect(mockLogger.debug).toHaveBeenCalledWith(
      'Proxy response',
      expect.objectContaining({ status: 503 })
    );

    const json = vi.fn();
    const status = vi.fn().mockReturnValue({ json });
    proxyOptions.onError?.(
      new Error('backend unreachable'),
      { path: '/api/v1/test' },
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
