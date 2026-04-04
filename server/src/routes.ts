/**
 * Route Registration
 *
 * Centralizes route mounting to keep index.ts focused on lifecycle wiring.
 */

import type { Express, Request, Response, RequestHandler } from 'express';
import config from './config';
import authRoutes from './api/auth';
import walletRoutes from './api/wallets';
import deviceRoutes from './api/devices';
import transactionRoutes from './api/transactions';
import labelRoutes from './api/labels';
import bitcoinRoutes from './api/bitcoin';
import priceRoutes from './api/price';
import nodeRoutes from './api/node';
import adminRoutes from './api/admin';
import syncRoutes from './api/sync';
import pushRoutes from './api/push';
import draftRoutes from './api/drafts';
import approvalRoutes from './api/approvals';
import payjoinRoutes from './api/payjoin';
import aiRoutes from './api/ai';
import aiInternalRoutes from './api/ai-internal';
import intelligenceRoutes from './api/intelligence';
import healthRoutes from './api/health';
import transferRoutes from './api/transfers';
import openApiRoutes from './api/openapi';
import mobilePermissionsRoutes, { mobilePermissionsInternalRoutes } from './api/mobilePermissions';
import { metricsHandler } from './middleware/metrics';
import { getWorkerHealthStatus } from './services/workerHealth';

type RouteDefinition = {
  method: 'use' | 'get';
  path: string;
  handler: RequestHandler;
};

function healthHandler(_req: Request, res: Response): void {
  const worker = getWorkerHealthStatus();
  const workerReady = worker.healthy;

  res.status(workerReady ? 200 : 503).json({
    status: workerReady ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    environment: config.nodeEnv,
    worker,
  });
}

const routes: RouteDefinition[] = [
  { method: 'get', path: '/health', handler: healthHandler },
  { method: 'get', path: '/metrics', handler: metricsHandler },
  { method: 'use', path: '/api/v1/health', handler: healthRoutes },
  { method: 'use', path: '/api/v1/auth', handler: authRoutes },
  { method: 'use', path: '/api/v1/wallets', handler: walletRoutes },
  { method: 'use', path: '/api/v1/devices', handler: deviceRoutes },
  { method: 'use', path: '/api/v1/bitcoin', handler: bitcoinRoutes },
  { method: 'use', path: '/api/v1/price', handler: priceRoutes },
  { method: 'use', path: '/api/v1/node', handler: nodeRoutes },
  { method: 'use', path: '/api/v1/admin', handler: adminRoutes },
  { method: 'use', path: '/api/v1/sync', handler: syncRoutes },
  { method: 'use', path: '/api/v1/push', handler: pushRoutes },
  { method: 'use', path: '/api/v1/transfers', handler: transferRoutes },
  { method: 'use', path: '/api/v1/ai', handler: aiRoutes },
  { method: 'use', path: '/api/v1/intelligence', handler: intelligenceRoutes },
  { method: 'use', path: '/api/v1', handler: mobilePermissionsRoutes },
  { method: 'use', path: '/internal/ai', handler: aiInternalRoutes },
  { method: 'use', path: '/internal', handler: mobilePermissionsInternalRoutes },
  // These routes are mounted at /api/v1 without a specific path - must come LAST
  { method: 'use', path: '/api/v1', handler: approvalRoutes },
  { method: 'use', path: '/api/v1', handler: transactionRoutes },
  { method: 'use', path: '/api/v1', handler: labelRoutes },
  { method: 'use', path: '/api/v1', handler: draftRoutes },
  { method: 'use', path: '/api/v1/payjoin', handler: payjoinRoutes },
  { method: 'use', path: '/api/v1/docs', handler: openApiRoutes },
];

export function registerRoutes(app: Express): void {
  for (const route of routes) {
    if (route.method === 'get') {
      app.get(route.path, route.handler);
    } else {
      app.use(route.path, route.handler);
    }
  }
}
