import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { errorHandler } from '../../../src/errors/errorHandler';

const {
  mockIsDockerProxyAvailable,
  mockGetTorStatus,
  mockStartTor,
  mockStopTor,
  mockCacheGetStats,
  mockDlqGetStats,
  mockDlqGetByCategory,
  mockDlqGetAll,
  mockDlqRemove,
  mockDlqClearCategory,
  mockDlqDequeueForRetry,
  mockDlqAdd,
  mockGetWebSocketServer,
  mockGetRateLimitEvents,
  mockQueueSync,
} = vi.hoisted(() => ({
  mockIsDockerProxyAvailable: vi.fn(),
  mockGetTorStatus: vi.fn(),
  mockStartTor: vi.fn(),
  mockStopTor: vi.fn(),
  mockCacheGetStats: vi.fn(),
  mockDlqGetStats: vi.fn(),
  mockDlqGetByCategory: vi.fn(),
  mockDlqGetAll: vi.fn(),
  mockDlqRemove: vi.fn(),
  mockDlqClearCategory: vi.fn(),
  mockDlqDequeueForRetry: vi.fn(),
  mockDlqAdd: vi.fn(),
  mockGetWebSocketServer: vi.fn(),
  mockGetRateLimitEvents: vi.fn(),
  mockQueueSync: vi.fn(),
}));

vi.mock('../../../src/middleware/auth', () => ({
  requireAuthenticatedUser: (req: any) => req.user ?? { userId: 'test-user-id', username: 'testuser', isAdmin: false },
  authenticate: (req: any, _res: any, next: () => void) => {
    req.user = { userId: 'admin-1', username: 'admin', isAdmin: true };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock('../../../src/services/cache', () => ({
  cache: {
    getStats: mockCacheGetStats,
  },
}));

vi.mock('../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    getStats: mockDlqGetStats,
    getByCategory: mockDlqGetByCategory,
    getAll: mockDlqGetAll,
    remove: mockDlqRemove,
    clearCategory: mockDlqClearCategory,
    dequeueForRetry: mockDlqDequeueForRetry,
    add: mockDlqAdd,
  },
}));

vi.mock('../../../src/services/syncService', () => ({
  getSyncService: () => ({
    queueSync: mockQueueSync,
  }),
}));

vi.mock('../../../src/websocket/server', () => ({
  getWebSocketServer: mockGetWebSocketServer,
  getRateLimitEvents: mockGetRateLimitEvents,
}));

vi.mock('../../../src/utils/docker', () => ({
  isDockerProxyAvailable: mockIsDockerProxyAvailable,
  getTorStatus: mockGetTorStatus,
  startTor: mockStartTor,
  stopTor: mockStopTor,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import infrastructureRouter from '../../../src/api/admin/infrastructure';

describe('Admin Infrastructure Routes', () => {
  let app: Express;

  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', infrastructureRouter);
    app.use(errorHandler);
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsDockerProxyAvailable.mockResolvedValue(true);
    mockGetTorStatus.mockResolvedValue({ exists: true, running: true, message: 'Tor is running' });
    mockStartTor.mockResolvedValue({ success: true, message: 'Started' });
    mockStopTor.mockResolvedValue({ success: true, message: 'Stopped' });

    mockCacheGetStats.mockReturnValue({ hits: 9, misses: 1, sets: 3, evictions: 0 });

    mockDlqGetStats.mockReturnValue({ total: 2, byCategory: { sync: 1, push: 1 } });
    mockDlqGetByCategory.mockReturnValue([
      { id: 'dlq-sync-1', category: 'sync', errorStack: 'sync-error'.repeat(80) },
    ]);
    mockDlqGetAll.mockReturnValue([
      { id: 'dlq-1', category: 'sync', errorStack: 'sync-stack' },
      { id: 'dlq-2', category: 'push', errorStack: 'push-stack' },
    ]);
    mockDlqRemove.mockResolvedValue(true);
    mockDlqClearCategory.mockResolvedValue(3);

    mockGetWebSocketServer.mockReturnValue({
      getStats: () => ({
        clients: 10,
        maxClients: 100,
        uniqueUsers: 7,
        maxPerUser: 5,
        subscriptions: 15,
        channels: 3,
        channelList: ['wallet:1', 'wallet:2', 'alerts'],
        rateLimits: { perMinute: 120 },
      }),
    });
    mockGetRateLimitEvents.mockReturnValue([
      { userId: 'u1', path: '/ws', timestamp: '2025-01-01T00:00:00.000Z' },
    ]);
  });

  it('returns unavailable tor status when docker proxy is not available', async () => {
    mockIsDockerProxyAvailable.mockResolvedValue(false);

    const response = await request(app).get('/api/v1/admin/tor-container/status');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      available: false,
      exists: false,
      running: false,
      message: 'Docker management not available',
    });
    expect(mockGetTorStatus).not.toHaveBeenCalled();
  });

  it('returns tor status details when docker proxy is available', async () => {
    const response = await request(app).get('/api/v1/admin/tor-container/status');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      available: true,
      exists: true,
      running: true,
      message: 'Tor is running',
    });
  });

  it('handles tor status errors', async () => {
    mockIsDockerProxyAvailable.mockRejectedValue(new Error('docker api failed'));

    const response = await request(app).get('/api/v1/admin/tor-container/status');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('starts tor container and handles failed start and exceptions', async () => {
    const success = await request(app).post('/api/v1/admin/tor-container/start');
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ success: true, message: 'Started' });

    mockStartTor.mockResolvedValueOnce({ success: false, message: 'Already running' });
    const failed = await request(app).post('/api/v1/admin/tor-container/start');
    expect(failed.status).toBe(400);
    expect(failed.body).toMatchObject({
      error: 'Failed to start',
      message: 'Already running',
    });

    mockStartTor.mockRejectedValueOnce(new Error('start failed'));
    const errored = await request(app).post('/api/v1/admin/tor-container/start');
    expect(errored.status).toBe(500);
    expect(errored.body.code).toBe('INTERNAL_ERROR');
  });

  it('stops tor container and handles failed stop and exceptions', async () => {
    const success = await request(app).post('/api/v1/admin/tor-container/stop');
    expect(success.status).toBe(200);
    expect(success.body).toEqual({ success: true, message: 'Stopped' });

    mockStopTor.mockResolvedValueOnce({ success: false, message: 'Already stopped' });
    const failed = await request(app).post('/api/v1/admin/tor-container/stop');
    expect(failed.status).toBe(400);
    expect(failed.body).toMatchObject({
      error: 'Failed to stop',
      message: 'Already stopped',
    });

    mockStopTor.mockRejectedValueOnce(new Error('stop failed'));
    const errored = await request(app).post('/api/v1/admin/tor-container/stop');
    expect(errored.status).toBe(500);
    expect(errored.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns cache metrics with calculated hit rate', async () => {
    const response = await request(app).get('/api/v1/admin/metrics/cache');

    expect(response.status).toBe(200);
    expect(response.body.stats).toEqual({ hits: 9, misses: 1, sets: 3, evictions: 0 });
    expect(response.body.hitRate).toBe('90.0%');
    expect(typeof response.body.timestamp).toBe('string');
  });

  it('returns N/A cache hit rate when there is no cache traffic', async () => {
    mockCacheGetStats.mockReturnValue({ hits: 0, misses: 0, sets: 0, evictions: 0 });

    const response = await request(app).get('/api/v1/admin/metrics/cache');

    expect(response.status).toBe(200);
    expect(response.body.hitRate).toBe('N/A');
  });

  it('handles cache metrics errors', async () => {
    mockCacheGetStats.mockImplementation(() => {
      throw new Error('cache unavailable');
    });

    const response = await request(app).get('/api/v1/admin/metrics/cache');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns websocket stats and recent rate limit events', async () => {
    const response = await request(app).get('/api/v1/admin/websocket/stats');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      connections: {
        current: 10,
        max: 100,
        uniqueUsers: 7,
        maxPerUser: 5,
      },
      subscriptions: {
        total: 15,
        channels: 3,
      },
      recentRateLimitEvents: [
        { userId: 'u1', path: '/ws', timestamp: '2025-01-01T00:00:00.000Z' },
      ],
    });
  });

  it('handles websocket stats errors', async () => {
    mockGetWebSocketServer.mockImplementation(() => {
      throw new Error('ws unavailable');
    });

    const response = await request(app).get('/api/v1/admin/websocket/stats');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('returns dead letter queue entries for all categories with truncation', async () => {
    const response = await request(app)
      .get('/api/v1/admin/dlq')
      .query({ limit: '50' });

    expect(response.status).toBe(200);
    expect(mockDlqGetAll).toHaveBeenCalledWith(50);
    expect(mockDlqGetByCategory).not.toHaveBeenCalled();
    expect(response.body.stats).toEqual({ total: 2, byCategory: { sync: 1, push: 1 } });
    expect(response.body.entries[0].errorStack.length).toBeLessThanOrEqual(500);
  });

  it('returns dead letter entries for a specific category and handles dlq errors', async () => {
    const categoryResponse = await request(app)
      .get('/api/v1/admin/dlq')
      .query({ category: 'sync', limit: '10' });

    expect(categoryResponse.status).toBe(200);
    expect(mockDlqGetByCategory).toHaveBeenCalledWith('sync');

    mockDlqGetStats.mockImplementation(() => {
      throw new Error('dlq stats failed');
    });
    const errorResponse = await request(app).get('/api/v1/admin/dlq');

    expect(errorResponse.status).toBe(500);
    expect(errorResponse.body.code).toBe('INTERNAL_ERROR');
  });

  it('deletes dead letter entries and returns not-found when missing', async () => {
    const removed = await request(app).delete('/api/v1/admin/dlq/dlq-1');
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ success: true });

    mockDlqRemove.mockResolvedValueOnce(false);
    const missing = await request(app).delete('/api/v1/admin/dlq/missing');
    expect(missing.status).toBe(404);
    expect(missing.body.message).toBe('Dead letter entry not found');

    mockDlqRemove.mockRejectedValueOnce(new Error('delete failed'));
    const errored = await request(app).delete('/api/v1/admin/dlq/boom');
    expect(errored.status).toBe(500);
    expect(errored.body.code).toBe('INTERNAL_ERROR');
  });

  it('retries a sync DLQ entry and queues wallet sync', async () => {
    mockDlqDequeueForRetry.mockResolvedValue({
      id: 'sync-123',
      category: 'sync',
      operation: 'wallet_sync',
      payload: { walletId: 'wallet-1' },
      error: 'timeout',
      attempts: 3,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
    });

    const response = await request(app).post('/api/v1/admin/dlq/sync-123/retry');

    expect(response.status).toBe(200);
    expect(response.body.entry).toEqual({
      id: 'sync-123',
      category: 'sync',
      operation: 'wallet_sync',
    });
    expect(response.body.retry).toEqual({
      success: true,
      message: 'Queued wallet sync for wallet-1',
    });
    expect(mockQueueSync).toHaveBeenCalledWith('wallet-1', 'normal');
  });

  it('returns 404 when retrying a non-existent DLQ entry', async () => {
    mockDlqDequeueForRetry.mockResolvedValue(null);

    const response = await request(app).post('/api/v1/admin/dlq/missing/retry');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Dead letter entry not found');
  });

  it('returns not-implemented message for unsupported DLQ categories', async () => {
    mockDlqDequeueForRetry.mockResolvedValue({
      id: 'push-456',
      category: 'push',
      operation: 'push_notification',
      payload: { userId: 'u1' },
      error: 'timeout',
      attempts: 1,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
    });

    const response = await request(app).post('/api/v1/admin/dlq/push-456/retry');

    expect(response.status).toBe(200);
    expect(response.body.retry).toEqual({
      success: false,
      message: 'Retry not implemented for category: push',
    });
  });

  it('returns failure for sync entry missing walletId', async () => {
    mockDlqDequeueForRetry.mockResolvedValue({
      id: 'sync-789',
      category: 'sync',
      operation: 'wallet_sync',
      payload: {},
      error: 'timeout',
      attempts: 1,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
    });

    const response = await request(app).post('/api/v1/admin/dlq/sync-789/retry');

    expect(response.status).toBe(200);
    expect(response.body.retry.success).toBe(false);
    expect(response.body.retry.message).toBe('Missing walletId in payload');
  });

  it('re-adds entry to DLQ when retry dispatch throws', async () => {
    mockDlqDequeueForRetry.mockResolvedValue({
      id: 'sync-err',
      category: 'sync',
      operation: 'wallet_sync',
      payload: { walletId: 'wallet-2' },
      error: 'original error',
      attempts: 2,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
      metadata: { walletId: 'wallet-2' },
    });
    mockQueueSync.mockImplementation(() => {
      throw new Error('queue full');
    });
    mockDlqAdd.mockResolvedValue('sync-err-re');

    const response = await request(app).post('/api/v1/admin/dlq/sync-err/retry');

    expect(response.status).toBe(500);
    expect(response.body.message).toBe('Retry dispatch failed — entry re-added to DLQ');
    expect(mockDlqAdd).toHaveBeenCalledWith(
      'sync',
      'wallet_sync',
      { walletId: 'wallet-2' },
      expect.any(Error),
      3,
      { walletId: 'wallet-2' },
    );
  });

  it('returns 500 when dequeueForRetry throws unexpectedly', async () => {
    mockDlqDequeueForRetry.mockRejectedValue(new Error('database connection lost'));

    const response = await request(app).post('/api/v1/admin/dlq/some-id/retry');

    expect(response.status).toBe(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });

  it('clears dead letter categories with validation and error handling', async () => {
    const invalid = await request(app).delete('/api/v1/admin/dlq/category/not-a-category');
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toContain('Invalid category');

    const valid = await request(app).delete('/api/v1/admin/dlq/category/sync');
    expect(valid.status).toBe(200);
    expect(valid.body).toEqual({ success: true, removed: 3 });
    expect(mockDlqClearCategory).toHaveBeenCalledWith('sync');

    mockDlqClearCategory.mockRejectedValueOnce(new Error('clear failed'));
    const errored = await request(app).delete('/api/v1/admin/dlq/category/push');
    expect(errored.status).toBe(500);
    expect(errored.body.code).toBe('INTERNAL_ERROR');
  });
});
