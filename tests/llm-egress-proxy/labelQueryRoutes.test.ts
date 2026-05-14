import { describe, expect, it, vi } from 'vitest';

import { registerLabelQueryRoutes } from '../../llm-egress-proxy/src/labelQueryRoutes';
import { RATE_LIMIT_MAX_REQUESTS } from '../../llm-egress-proxy/src/constants';

function makeApp() {
  const routes = new Map<string, unknown[]>();
  return {
    app: {
      post: (path: string, ...handlers: unknown[]) => {
        routes.set(path, handlers);
      },
    },
    routes,
  };
}

function makeDeps() {
  return {
    backendUrl: 'http://backend:3001',
    getAiConfig: () => ({
      enabled: false,
      endpoint: undefined,
      model: undefined,
      providerProfileId: undefined,
      providerType: 'ollama',
    }),
    log: {
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    },
  };
}

function makeRateLimitRequest(ip: string) {
  return {
    ip,
    method: 'POST',
    path: '/suggest-label',
    headers: {},
    app: {
      get: vi.fn().mockReturnValue(false),
    },
  };
}

function makeResponse() {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('LLM egress proxy label/query routes', () => {
  it('registers label, query, and test routes behind rate-limit middleware', () => {
    const { app, routes } = makeApp();

    registerLabelQueryRoutes(app as any, makeDeps() as any);

    expect([...routes.keys()]).toEqual(['/suggest-label', '/query', '/test']);
    for (const handlers of routes.values()) {
      expect(handlers).toHaveLength(2);
      expect(typeof handlers[0]).toBe('function');
      expect(typeof handlers[1]).toBe('function');
    }
  });

  it('returns the LLM egress proxy 429 payload after the configured request limit', async () => {
    const { app, routes } = makeApp();
    registerLabelQueryRoutes(app as any, makeDeps() as any);
    const [rateLimitMiddleware] = routes.get('/suggest-label') as Function[];

    for (let count = 0; count < RATE_LIMIT_MAX_REQUESTS; count++) {
      const allowedNext = vi.fn();
      await rateLimitMiddleware(
        makeRateLimitRequest('203.0.113.42'),
        makeResponse(),
        allowedNext,
      );
      expect(allowedNext).toHaveBeenCalledTimes(1);
    }

    const blockedRes = makeResponse();
    const blockedNext = vi.fn();
    await rateLimitMiddleware(
      makeRateLimitRequest('203.0.113.42'),
      blockedRes,
      blockedNext,
    );

    expect(blockedNext).not.toHaveBeenCalled();
    expect(blockedRes.status).toHaveBeenCalledWith(429);
    expect(blockedRes.json).toHaveBeenCalledWith({
      error:
        'Rate limit exceeded. AI requests are limited to 10 per minute. Please wait 60s before trying again.',
      retryAfter: 60,
    });
  });
});
