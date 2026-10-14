import express from 'express';
import type { Server } from 'node:http';
import { createServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type ForwardedRequest = {
  method: string;
  url: string;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
};

const jwtSecret = 'test-jwt-secret-minimum-32-chars-long';
const user = { userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'proxy-test', isAdmin: false };
const browserCookies = 'locale=en; sanctuary_access=stale-access; sanctuary_refresh=stale-refresh; sanctuary_csrf=stale-csrf';
const forwarded: ForwardedRequest[] = [];
let backendServer: Server | undefined;
let gatewayServer: Server | undefined;
let gatewayOrigin: string;

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Expected an ephemeral TCP listener'));
        return;
      }
      resolve(address.port);
    });
  });
}

async function closeServer(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function accessToken(): string {
  return jwt.sign(user, jwtSecret, { audience: 'sanctuary:access', expiresIn: '5m' });
}

async function post(path: string, body: object, cookie?: string, authenticated = false): Promise<Response> {
  return fetch(`${gatewayOrigin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(authenticated ? { authorization: `Bearer ${accessToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function patch(path: string, body: object, authenticated = false): Promise<Response> {
  return fetch(`${gatewayOrigin}${path}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { authorization: `Bearer ${accessToken()}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function lastForwarded(): ForwardedRequest {
  const request = forwarded.at(-1);
  if (!request) throw new Error('Expected request to reach backend');
  return request;
}

describe('proxy transport', () => {
  beforeAll(async () => {
    const backend = express();
    backend.use(express.json());
    backend.use((req, res) => {
      forwarded.push({
        method: req.method,
        url: req.originalUrl,
        body: req.body,
        headers: req.headers,
      });
      res.status(200).json({ ok: true });
    });
    backendServer = createServer(backend);
    const backendPort = await listen(backendServer);

    process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;
    process.env.JWT_SECRET = jwtSecret;
    const [{ default: proxyRouter }, { normalizeTrailingSlash }] = await Promise.all([
      import('../../../src/routes/proxy'),
      import('../../../src/middleware/trailingSlash'),
    ]);

    const gateway = express();
    gateway.use(express.json());
    gateway.use(normalizeTrailingSlash);
    gateway.use(proxyRouter);
    gatewayServer = createServer(gateway);
    const gatewayPort = await listen(gatewayServer);
    gatewayOrigin = `http://127.0.0.1:${gatewayPort}`;
  });

  afterAll(async () => {
    await closeServer(gatewayServer);
    await closeServer(backendServer);
  });

  it('restores the default-route prefix and preserves query after slash normalization', async () => {
    const response = await fetch(`${gatewayOrigin}/api/v1/wallets/?network=testnet&limit=7`, {
      headers: { authorization: `Bearer ${accessToken()}` },
    });

    expect(response.status).toBe(200);
    expect(lastForwarded()).toMatchObject({ method: 'GET', url: '/api/v1/wallets?network=testnet&limit=7' });
    expect(lastForwarded().headers['x-gateway-user-id']).toBe(user.userId);
    expect(lastForwarded().headers['x-gateway-username']).toBe(user.username);
    expect(lastForwarded().headers['x-gateway-request']).toBe('true');
  });

  it('sends the backend exactly the observed client IP, dropping client forwarding headers', async () => {
    const response = await fetch(`${gatewayOrigin}/api/v1/wallets`, {
      headers: {
        authorization: `Bearer ${accessToken()}`,
        'x-forwarded-for': '6.6.6.6',
        'x-real-ip': '7.7.7.7',
        forwarded: 'for=8.8.8.8',
      },
    });

    expect(response.status).toBe(200);
    const { headers } = lastForwarded();
    expect(headers['x-forwarded-for']).toMatch(/^(::ffff:)?127\.0\.0\.1$/);
    expect(headers['x-real-ip']).toBeUndefined();
    expect(headers.forwarded).toBeUndefined();
  });

  it('forwards logout body and unrelated cookie while removing browser auth cookies', async () => {
    const body = { refreshToken: 'logout-body-token' };
    const response = await post('/api/v1/auth/logout', body, browserCookies, true);

    expect(response.status).toBe(200);
    expect(lastForwarded()).toMatchObject({ method: 'POST', url: '/api/v1/auth/logout', body });
    expect(lastForwarded().headers.cookie).toBe('locale=en');
    expect(lastForwarded().headers['x-gateway-user-id']).toBe(user.userId);
    expect(lastForwarded().headers['x-gateway-username']).toBe(user.username);
    expect(lastForwarded().headers['x-gateway-request']).toBe('true');
  });

  it('keeps explicit refresh versioned and filters browser auth cookies', async () => {
    const body = { refreshToken: 'refresh-body-token' };
    const response = await post('/api/v1/auth/refresh', body, browserCookies);

    expect(response.status).toBe(200);
    expect(lastForwarded()).toMatchObject({ method: 'POST', url: '/api/v1/auth/refresh', body });
    expect(lastForwarded().headers.cookie).toBe('locale=en');
    expect(lastForwarded().headers['x-gateway-request']).toBe('true');
    expect(lastForwarded().headers['x-gateway-user-id']).toBeUndefined();
  });

  it('forwards refresh without a cookie header', async () => {
    const body = { refreshToken: 'refresh-body-token' };
    const response = await post('/api/v1/auth/refresh', body);

    expect(response.status).toBe(200);
    expect(lastForwarded()).toMatchObject({ method: 'POST', url: '/api/v1/auth/refresh', body });
    expect(lastForwarded().headers.cookie).toBeUndefined();
  });

  it('removes browser auth cookies when no unrelated cookie remains', async () => {
    const body = { refreshToken: 'refresh-body-token' };
    const authCookies = 'sanctuary_access=stale-access; sanctuary_refresh=stale-refresh; sanctuary_csrf=stale-csrf';
    const response = await post('/api/v1/auth/refresh', body, authCookies);

    expect(response.status).toBe(200);
    expect(lastForwarded()).toMatchObject({ method: 'POST', url: '/api/v1/auth/refresh', body });
    expect(lastForwarded().headers.cookie).toBeUndefined();
  });

  it('writes authenticated JSON body and gateway identity headers', async () => {
    const body = { unit: 'sats' };
    const response = await patch('/api/v1/auth/me/preferences', body, true);

    expect(response.status).toBe(200);
    expect(lastForwarded()).toMatchObject({
      method: 'PATCH',
      url: '/api/v1/auth/me/preferences',
      body,
    });
    expect(lastForwarded().headers['x-gateway-user-id']).toBe(user.userId);
    expect(lastForwarded().headers['x-gateway-username']).toBe(user.username);
    expect(lastForwarded().headers['x-gateway-request']).toBe('true');
  });
});
