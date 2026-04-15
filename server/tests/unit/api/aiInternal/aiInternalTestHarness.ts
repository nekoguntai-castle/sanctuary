import { afterEach, beforeAll, beforeEach, vi } from 'vitest';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';

import { errorHandler } from '../../../../src/errors/errorHandler';

vi.mock('../../../../src/models/prisma', () => {
  const mockTransaction = {
    findFirst: vi.fn(),
    count: vi.fn(),
  };
  const mockWallet = {
    findFirst: vi.fn(),
  };
  const mockLabel = {
    findMany: vi.fn(),
  };
  const mockAddress = {
    count: vi.fn(),
  };
  const mockUTXO = {
    count: vi.fn(),
  };

  return {
    __esModule: true,
    default: {
      transaction: mockTransaction,
      wallet: mockWallet,
      label: mockLabel,
      address: mockAddress,
      uTXO: mockUTXO,
    },
  };
});

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../../src/websocket/notifications', () => ({
  notificationService: {
    broadcastModelDownloadProgress: vi.fn(),
  },
}));

vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      req.user = { userId: 'test-user-123', username: 'testuser', isAdmin: false };
      next();
    } else {
      res.status(401).json({ error: 'Unauthorized' });
    }
  },
}));

import aiInternalRouter from '../../../../src/api/ai-internal';
import prisma from '../../../../src/models/prisma';
import { notificationService } from '../../../../src/websocket/notifications';

export const internalIp = '10.0.0.1';
export const authHeader = 'Bearer valid-token';

export const mockPrisma = prisma as unknown as {
  transaction: { findFirst: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  wallet: { findFirst: ReturnType<typeof vi.fn> };
  label: { findMany: ReturnType<typeof vi.fn> };
  address: { count: ReturnType<typeof vi.fn> };
  uTXO: { count: ReturnType<typeof vi.fn> };
};

export const mockNotificationService = notificationService as unknown as {
  broadcastModelDownloadProgress: ReturnType<typeof vi.fn>;
};

export let app: Express;

export function createAiInternalApp(configure?: (app: Express) => void): Express {
  const testApp = express();
  testApp.use(express.json());
  testApp.set('trust proxy', true);
  configure?.(testApp);
  testApp.use('/internal/ai', aiInternalRouter);
  testApp.use(errorHandler);
  return testApp;
}

export function aiInternalRequest() {
  return request(app);
}

export function setupAiInternalApiTestHooks(): void {
  beforeAll(() => {
    app = createAiInternalApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
}
