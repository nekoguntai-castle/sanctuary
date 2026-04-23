/**
 * Integration Test Server Setup
 *
 * Creates an Express app instance for testing with supertest.
 * Mocks external services (Electrum, push notifications) while using real database.
 */

import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { errorHandler } from '../../../src/errors/errorHandler';
import { createServerCorsOptionsDelegate } from '../../../src/middleware/corsOrigin';

// Import routes
import authRoutes from '../../../src/api/auth';
import walletRoutes from '../../../src/api/wallets';
import deviceRoutes from '../../../src/api/devices';
import transactionRoutes from '../../../src/api/transactions';
import labelRoutes from '../../../src/api/labels';
import bitcoinRoutes from '../../../src/api/bitcoin';
import adminRoutes from '../../../src/api/admin';
import syncRoutes from '../../../src/api/sync';
import draftRoutes from '../../../src/api/drafts';
import priceRoutes from '../../../src/api/price';

let testApp: Express | null = null;

interface TestAppOptions {
  clientUrl?: string;
  nodeEnv?: string;
}

function buildTestApp(options: TestAppOptions = {}): Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(cors(createServerCorsOptionsDelegate({
    clientUrl: options.clientUrl ?? 'http://localhost',
    nodeEnv: options.nodeEnv ?? 'development',
  })));
  app.use(express.json({ limit: '50mb' }));

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/wallets', walletRoutes);
  app.use('/api/v1/devices', deviceRoutes);
  app.use('/api/v1/transactions', transactionRoutes);
  app.use('/api/v1/labels', labelRoutes);
  app.use('/api/v1/bitcoin', bitcoinRoutes);
  app.use('/api/v1/admin', adminRoutes);
  app.use('/api/v1/sync', syncRoutes);
  app.use('/api/v1/drafts', draftRoutes);
  app.use('/api/v1/price', priceRoutes);

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  app.use(errorHandler);

  return app;
}

/**
 * Create a test Express app instance
 */
export function createTestApp(): Express {
  if (testApp) return testApp;
  testApp = buildTestApp();
  return testApp;
}

export function createIsolatedTestApp(options: TestAppOptions = {}): Express {
  return buildTestApp(options);
}

/**
 * Get the test app instance
 */
export function getTestApp(): Express {
  if (!testApp) {
    return createTestApp();
  }
  return testApp;
}

/**
 * Reset test app state
 */
export function resetTestApp(): void {
  testApp = null;
}
