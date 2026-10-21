/**
 * POST /api/v1/node/test with a saved Tor proxy.
 *
 * The raw-socket probe cannot speak SOCKS, so with a proxy configured the route
 * must delegate to testNodeConfig (which dials through the proxy) and must never
 * open a direct socket, including when the saved proxy cannot be used.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

const mocks = vi.hoisted(() => ({
  netConnect: vi.fn(),
  tlsConnect: vi.fn(),
  resolveConfiguredElectrumProxy: vi.fn(),
  testNodeConfig: vi.fn(),
}));

vi.mock('net', () => ({ default: { connect: mocks.netConnect }, connect: mocks.netConnect }));
vi.mock('tls', () => ({ default: { connect: mocks.tlsConnect }, connect: mocks.tlsConnect }));

vi.mock('../../../src/services/bitcoin/nodeClient', () => ({
  resolveConfiguredElectrumProxy: mocks.resolveConfiguredElectrumProxy,
  testNodeConfig: mocks.testNodeConfig,
}));

vi.mock('../../../src/middleware/auth', () => ({
  authenticate: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import nodeRouter from '../../../src/api/node';
import { ProxyConfigurationError } from '../../../src/services/bitcoin/electrum/proxyCredentials';

const TOR_PROXY = { enabled: true, host: '127.0.0.1', port: 9050 };

function postNodeTest(body: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = { method: 'POST', url: '/test', path: '/test', headers: {}, body };
    const res = {
      statusCode: 200,
      setHeader: vi.fn(),
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: unknown) {
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
    };
    nodeRouter(req as unknown as Request, res as unknown as Response, (err?: unknown) =>
      reject(err ?? new Error('Route not handled')),
    );
  });
}

describe('POST /api/v1/node/test with a saved proxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to testNodeConfig through the proxy and opens no direct socket', async () => {
    mocks.resolveConfiguredElectrumProxy.mockResolvedValue(TOR_PROXY);
    mocks.testNodeConfig.mockResolvedValue({
      success: true,
      message: 'Connected to Electrum server at block 900000',
      info: { blockHeight: 900000 },
    });

    const response = await postNodeTest({
      host: 'exampleonionaddress.onion',
      port: '50002',
      protocol: 'ssl',
      allowSelfSignedCertificate: true,
    });

    expect(mocks.testNodeConfig).toHaveBeenCalledWith({
      host: 'exampleonionaddress.onion',
      port: 50002,
      protocol: 'ssl',
      allowSelfSignedCert: true,
    });
    expect(response).toEqual({
      status: 200,
      body: { success: true, message: 'Connected to Electrum server at block 900000' },
    });
    expect(mocks.netConnect).not.toHaveBeenCalled();
    expect(mocks.tlsConnect).not.toHaveBeenCalled();
  });

  it('fails closed without any socket when the saved proxy cannot be used', async () => {
    mocks.resolveConfiguredElectrumProxy.mockRejectedValue(
      new ProxyConfigurationError('Stored proxy password cannot be decrypted; re-enter it in Node Config'),
    );

    const response = await postNodeTest({ host: 'exampleonionaddress.onion', port: 50001, protocol: 'tcp' });

    expect(response).toEqual({
      status: 200,
      body: {
        success: false,
        message: 'Proxy configuration error: Stored proxy password cannot be decrypted; re-enter it in Node Config',
      },
    });
    expect(mocks.testNodeConfig).not.toHaveBeenCalled();
    expect(mocks.netConnect).not.toHaveBeenCalled();
    expect(mocks.tlsConnect).not.toHaveBeenCalled();
  });
});
