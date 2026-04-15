import { beforeAll, beforeEach, vi } from 'vitest';

import { resetPrismaMocks } from '../../../mocks/prisma';

// Mock Prisma BEFORE other imports
vi.mock('../../../../src/models/prisma', async () => {
  const { mockPrismaClient: prisma } = await import('../../../mocks/prisma');
  return {
    __esModule: true,
    default: prisma,
  };
});

// Mock auth middleware to bypass JWT validation
vi.mock('../../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, res: any, next: any) => {
    req.user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

// Mock device access middleware
vi.mock('../../../../src/middleware/deviceAccess', () => ({
  requireDeviceAccess: () => (req: any, res: any, next: any) => {
    req.deviceRole = req.headers['x-test-device-role'] || 'owner';
    req.deviceId = req.params.id;
    next();
  },
}));

// Mock device access service
vi.mock('../../../../src/services/deviceAccess', () => ({
  getUserAccessibleDevices: vi.fn(),
  getDeviceShareInfo: vi.fn(),
  shareDeviceWithUser: vi.fn(),
  removeUserFromDevice: vi.fn(),
  shareDeviceWithGroup: vi.fn(),
  checkDeviceOwnerAccess: vi.fn(),
}));

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mock requestContext (needed by errorHandler and auth middleware)
vi.mock('../../../../src/utils/requestContext', () => ({
  requestContext: {
    getRequestId: () => 'test-request-id',
    setUser: vi.fn(),
    get: () => undefined,
    run: (_ctx: unknown, fn: () => unknown) => fn(),
    getUserId: () => undefined,
    getTraceId: () => undefined,
    setTraceId: vi.fn(),
    getDuration: () => 0,
    generateRequestId: () => 'test-request-id',
  },
}));

import express from 'express';
import { errorHandler } from '../../../../src/errors/errorHandler';

// Create test app - must import router AFTER mocks are set up
const createTestApp = async () => {
  const app = express();
  app.use(express.json());

  // Import router dynamically after mocks
  const devicesModule = await import('../../../../src/api/devices');
  app.use('/api/v1/devices', devicesModule.default);
  app.use(errorHandler);

  return app;
};

export let app: express.Application;

export function setupDevicesApiTestHooks(): void {
  beforeAll(async () => {
    app = await createTestApp();
  });

  beforeEach(() => {
    resetPrismaMocks();
    vi.clearAllMocks();
  });
}
