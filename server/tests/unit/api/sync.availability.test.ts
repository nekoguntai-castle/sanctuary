import express from 'express';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockWalletRepository, mockSyncIntentAdmission, mockDescribeWalletSyncAvailability, mockDescribeRefusedWalletSync,
} = vi.hoisted(() => ({
  mockWalletRepository: { findByIdWithAccess: vi.fn() },
  mockSyncIntentAdmission: { request: vi.fn(), requestFullResync: vi.fn() },
  mockDescribeWalletSyncAvailability: vi.fn(),
  mockDescribeRefusedWalletSync: vi.fn(),
}));

vi.mock('../../../src/repositories', () => ({
  walletRepository: mockWalletRepository,
  addressRepository: {},
}));

vi.mock('../../../src/services/wallet', () => ({
  getUserWalletRole: vi.fn().mockResolvedValue('owner'),
}));

vi.mock('../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: mockSyncIntentAdmission,
}));

vi.mock('../../../src/services/sync/walletSyncAvailability', () => ({
  describeWalletSyncAvailability: mockDescribeWalletSyncAvailability,
  describeRefusedWalletSync: mockDescribeRefusedWalletSync,
}));

vi.mock('../../../src/services/bitcoin/blockchain', () => ({}));

vi.mock('../../../src/services/workerSyncQueue', () => ({
  enqueueWalletSyncBatch: vi.fn(),
  enqueueFullResyncBatch: vi.fn(),
}));

vi.mock('../../../src/config', () => ({
  getConfig: () => ({ sync: {} }),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: () => ({ userId: 'test-user-id', username: 'testuser', isAdmin: false }),
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as express.Request & { user?: unknown }).user = { userId: 'test-user-id', username: 'testuser', isAdmin: false };
    next();
  },
}));

vi.mock('../../../src/middleware/rateLimit', () => ({
  rateLimitByUser: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock('../../../src/utils/requestContext', () => ({
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

import syncRouter from '../../../src/api/sync';
import { errorHandler } from '../../../src/errors/errorHandler';

describe('Sync API - availability', () => {
  let app: express.Application;
  const paused = { state: 'paused', reason: 'restart_recovery', resumesAt: '2026-11-05T00:14:00.000Z' };
  const activation = { status: 'fleet_blocked', requiredFloor: 1, reason: 'restart_observed' };

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/sync', syncRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockDescribeWalletSyncAvailability.mockReturnValue(paused);
    mockDescribeRefusedWalletSync.mockReturnValue(paused);
    mockWalletRepository.findByIdWithAccess.mockResolvedValue({ id: 'wallet-1' });
  });

  it('GET /sync/availability reports whether new sync work is admitted', async () => {
    const response = await request(app).get('/sync/availability');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(paused);
  });

  it('POST /sync/wallet/:walletId includes the pause in a blocked 503', async () => {
    mockSyncIntentAdmission.request.mockResolvedValue({ status: 'blocked', activation });

    const response = await request(app).post('/sync/wallet/wallet-1').send({});

    expect(response.status).toBe(503);
    expect(response.body.message).toBe('Wallet sync is paused until the background worker is ready');
    expect(response.body.details).toEqual({ syncAvailability: paused });
    expect(mockDescribeRefusedWalletSync).toHaveBeenCalledWith(activation);
  });

  it('POST /sync/resync/:walletId includes the pause in a blocked 503', async () => {
    mockSyncIntentAdmission.requestFullResync.mockResolvedValue({ status: 'blocked', activation });

    const response = await request(app).post('/sync/resync/wallet-1').send({});

    expect(response.status).toBe(503);
    expect(response.body.details).toEqual({ syncAvailability: paused });
    expect(mockDescribeRefusedWalletSync).toHaveBeenCalledWith(activation);
  });
});
