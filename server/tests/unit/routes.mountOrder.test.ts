import express, { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { nodeEnv: 'test' } }));

// Function declarations: vi.mock factories are hoisted above const initialisers.
// Router whose handler answers every request with the given status.
function respondingRouter(status: number) {
  const router = Router();
  router.use((_req, res) => {
    res.status(status).json({});
  });
  return router;
}

// Router that lets every request fall through to later mounts.
function passthrough() {
  const router = Router();
  router.use((_req, _res, next) => next());
  return router;
}

// Mirrors `router.use(authenticate)` at the top of the root-mounted routers.
function makeAuthGatedRouter() {
  return respondingRouter(401);
}
// Mirrors routers that answer without a router-level authenticate.
function makeOpenRouter() {
  return respondingRouter(200);
}

vi.mock('../../src/config', () => ({ __esModule: true, default: mockConfig }));
vi.mock('../../src/api/auth', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/wallets', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/devices', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/hardware', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/transactions', () => ({ __esModule: true, default: makeAuthGatedRouter() }));
vi.mock('../../src/api/labels', () => ({ __esModule: true, default: makeAuthGatedRouter() }));
vi.mock('../../src/api/bitcoin', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/price', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/node', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/admin', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/sync', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/push', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/drafts', () => ({ __esModule: true, default: makeAuthGatedRouter() }));
vi.mock('../../src/api/approvals', () => ({ __esModule: true, default: makeAuthGatedRouter() }));
vi.mock('../../src/api/payjoin', () => ({ __esModule: true, default: makeOpenRouter() }));
vi.mock('../../src/api/ai', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/agent', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/llm-egress-internal', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/intelligence', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/console', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/health', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/transfers', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/openapi', () => ({ __esModule: true, default: makeOpenRouter() }));
vi.mock('../../src/api/mobileAgentDrafts', () => ({ __esModule: true, default: passthrough() }));
vi.mock('../../src/api/mobilePermissions', () => ({
  __esModule: true,
  default: passthrough(),
  mobilePermissionsInternalRoutes: passthrough(),
}));
vi.mock('../../src/middleware/metrics', () => ({ metricsHandler: vi.fn() }));
vi.mock('../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: vi.fn(() => ({ healthy: true })),
}));

import { registerRoutes } from '../../src/routes';

describe('registerRoutes mount order', () => {
  const app = express();
  registerRoutes(app);

  it('serves the unauthenticated BIP78 payjoin receiver before root-mounted authenticated routers', async () => {
    const response = await request(app).post('/api/v1/payjoin/addr?v=1');

    expect(response.status).toBe(200);
  });

  it('serves the public API docs before root-mounted authenticated routers', async () => {
    const response = await request(app).get('/api/v1/docs/openapi.json');

    expect(response.status).toBe(200);
  });

  it('still requires authentication on root-mounted routes', async () => {
    const response = await request(app).get('/api/v1/labels/x');

    expect(response.status).toBe(401);
  });
});
