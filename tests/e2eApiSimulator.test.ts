import type { Route } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';

import {
  createStaticApiSimulator,
  mockResponse,
  parseApiRequest,
  parseApiRoute,
  resolveApiResponse,
  type ParsedApiRoute,
} from './e2e/apiSimulator';
import {
  BASELINE_API_KEYS,
  createAuthenticatedApiBaseline,
} from './e2e/fixtures/apiBaseline';
import {
  balanceHistory,
  emptyBalanceHistory,
  flatBalanceHistory,
} from './e2e/fixtures/balanceHistory';

function routeStub(method: string, url: string) {
  const fulfill = vi.fn().mockResolvedValue(undefined);
  const route = {
    request: () => ({
      method: () => method,
      url: () => url,
    }),
    fulfill,
  } as unknown as Route;
  return { fulfill, route };
}

describe('strict E2E API simulator', () => {
  it('parses the exact method and pathname while excluding query parameters', () => {
    const { route } = routeStub('GET', 'http://localhost/api/v1/wallets?limit=1');

    expect(parseApiRoute(route)).toEqual({
      method: 'GET',
      path: '/wallets',
      requestKey: 'GET /wallets',
    });
    expect(parseApiRequest('GET', 'http://localhost/api/v10/wallets')).toEqual({
      method: 'GET',
      path: '/api/v10/wallets',
      requestKey: 'GET /api/v10/wallets',
    });
  });

  it('resolves explicit and dynamic scenario overrides before static responses', async () => {
    const parsedRoute: ParsedApiRoute = {
      method: 'GET',
      path: '/wallets',
      requestKey: 'GET /wallets',
    };
    const dynamicResponse = vi.fn().mockReturnValue(mockResponse(['dynamic']));

    await expect(resolveApiResponse(parsedRoute, {
      responses: { 'GET /wallets': mockResponse(['static']) },
      overrides: { 'GET /wallets': mockResponse(['override']) },
      dynamicResponse,
    })).resolves.toEqual(mockResponse(['override']));
    expect(dynamicResponse).not.toHaveBeenCalled();

    await expect(resolveApiResponse(parsedRoute, {
      responses: { 'GET /wallets': mockResponse(['static']) },
      dynamicResponse,
    })).resolves.toEqual(mockResponse(['dynamic']));
  });

  it('selects only requested baseline endpoints and keeps them overrideable', async () => {
    const baseline = createAuthenticatedApiBaseline({
      include: [BASELINE_API_KEYS.health, BASELINE_API_KEYS.priceProviders],
    });
    const parsedRoute: ParsedApiRoute = {
      method: 'GET',
      path: '/price/providers',
      requestKey: BASELINE_API_KEYS.priceProviders,
    };

    expect(Object.keys(baseline)).toEqual([
      BASELINE_API_KEYS.health,
      BASELINE_API_KEYS.priceProviders,
    ]);
    await expect(resolveApiResponse(parsedRoute, {
      responses: baseline,
      overrides: {
        [BASELINE_API_KEYS.priceProviders]: mockResponse({ providers: ['scenario'] }),
      },
    })).resolves.toEqual(mockResponse({ providers: ['scenario'] }));
  });

  it('does not match a response registered for another HTTP method', async () => {
    await expect(resolveApiResponse({
      method: 'POST',
      path: '/wallets',
      requestKey: 'POST /wallets',
    }, {
      responses: { 'GET /wallets': mockResponse([]) },
    })).resolves.toBeNull();
  });

  it('constructs fresh balance-history fixtures with the live wire fields', () => {
    const points = balanceHistory([{ name: 'Day 1', value: 42 }]);

    expect(points).toEqual([{ name: 'Day 1', value: 42 }]);
    expect(flatBalanceHistory(7)).toEqual([
      { name: 'Start', value: 7 },
      { name: 'Now', value: 7 },
    ]);
    expect(emptyBalanceHistory()).toEqual([]);
    expect(balanceHistory(points)).not.toBe(points);
  });

  it('fulfills known responses and preserves an explicit status', async () => {
    const { fulfill, route } = routeStub('POST', 'http://localhost/api/v1/wallets');
    const simulator = createStaticApiSimulator({
      responses: { 'POST /wallets': mockResponse({ id: 'wallet-1' }, 201) },
    });

    await simulator.handler(route);

    expect(fulfill).toHaveBeenCalledWith({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'wallet-1' }),
    });
    expect(simulator.unhandledRequests).toEqual([]);
  });

  it('defaults status to 200 without replacing an explicit zero', async () => {
    const defaultRoute = routeStub('GET', 'http://localhost/api/v1/default');
    const zeroRoute = routeStub('GET', 'http://localhost/api/v1/zero');
    const simulator = createStaticApiSimulator({
      responses: {
        'GET /default': mockResponse({ ok: true }),
        'GET /zero': mockResponse({ ok: false }, 0),
      },
    });

    await simulator.handler(defaultRoute.route);
    await simulator.handler(zeroRoute.route);

    expect(defaultRoute.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 200 }));
    expect(zeroRoute.fulfill).toHaveBeenCalledWith(expect.objectContaining({ status: 0 }));
  });

  it('records every unknown request before fulfilling the standard 404', async () => {
    const { fulfill, route } = routeStub('DELETE', 'http://localhost/api/v1/wallets/missing');
    const simulator = createStaticApiSimulator({ responses: {} });
    fulfill.mockImplementation(async () => {
      expect(simulator.unhandledRequests.at(-1)).toBe('DELETE /wallets/missing');
    });

    await simulator.handler(route);
    await simulator.handler(route);

    expect(fulfill).toHaveBeenCalledWith({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Unmocked: DELETE /wallets/missing' }),
    });
    expect(simulator.unhandledRequests).toEqual([
      'DELETE /wallets/missing',
      'DELETE /wallets/missing',
    ]);
  });
});
