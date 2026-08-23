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
  mockDlqGetSnapshot,
  mockDlqRemove,
  mockDlqClearCategory,
  mockDlqClaimForRetry,
  mockDlqReleaseRetry,
  mockDlqAcknowledgeRetry,
  mockEnqueueDeadLetterJob,
  mockGetWebSocketServer,
  mockGetRateLimitEvents,
} = vi.hoisted(() => ({
  mockIsDockerProxyAvailable: vi.fn(),
  mockGetTorStatus: vi.fn(),
  mockStartTor: vi.fn(),
  mockStopTor: vi.fn(),
  mockCacheGetStats: vi.fn(),
  mockDlqGetSnapshot: vi.fn(),
  mockDlqRemove: vi.fn(),
  mockDlqClearCategory: vi.fn(),
  mockDlqClaimForRetry: vi.fn(),
  mockDlqReleaseRetry: vi.fn(),
  mockDlqAcknowledgeRetry: vi.fn(),
  mockEnqueueDeadLetterJob: vi.fn(),
  mockGetWebSocketServer: vi.fn(),
  mockGetRateLimitEvents: vi.fn(),
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
    getSnapshot: mockDlqGetSnapshot,
    remove: mockDlqRemove,
    clearCategory: mockDlqClearCategory,
    claimForRetry: mockDlqClaimForRetry,
    releaseRetry: mockDlqReleaseRetry,
    acknowledgeRetry: mockDlqAcknowledgeRetry,
  },
}));

vi.mock('../../../src/services/sync/syncDeadLetterRetryAdmission', () => ({
  retryDeadLetterSyncJob: mockEnqueueDeadLetterJob,
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

    mockDlqGetSnapshot.mockResolvedValue({
      stats: { total: 2, byCategory: { sync: 1, push: 1 } },
      entries: [
        { id: 'dlq-1', category: 'sync', errorStack: 'sync-error'.repeat(80) },
        { id: 'dlq-2', category: 'push', errorStack: 'push-stack' },
      ],
    });
    mockDlqRemove.mockResolvedValue(true);
    mockDlqClearCategory.mockResolvedValue(3);
    mockDlqClaimForRetry.mockResolvedValue({
      status: 'claimed',
      claim: {
        token: 'claim-token',
        expiresAt: new Date(),
        entry: {
          id: 'sync-123',
          category: 'sync',
          operation: 'sync:sync-wallet',
          job: {
            version: 1,
            queue: 'sync',
            name: 'sync-wallet',
            jobId: 'job-1',
            data: { walletId: 'wallet-1' },
            options: { attempts: 3 },
            exhaustedAttempt: 3,
          },
        },
      },
    });
    mockDlqReleaseRetry.mockResolvedValue(true);
    mockDlqAcknowledgeRetry.mockResolvedValue(true);
    mockEnqueueDeadLetterJob.mockResolvedValue(true);

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
    expect(mockDlqGetSnapshot).toHaveBeenCalledWith({
      category: undefined,
      limit: 50,
    });
    expect(response.body.stats).toEqual({ total: 2, byCategory: { sync: 1, push: 1 } });
    expect(response.body.entries[0].errorStack.length).toBeLessThanOrEqual(500);
  });

  it('returns dead letter entries for a specific category and handles dlq errors', async () => {
    const categoryResponse = await request(app)
      .get('/api/v1/admin/dlq')
      .query({ category: 'sync', limit: '10' });

    expect(categoryResponse.status).toBe(200);
    expect(mockDlqGetSnapshot).toHaveBeenCalledWith({
      category: 'sync',
      limit: 10,
    });

    mockDlqGetSnapshot.mockRejectedValueOnce(new Error('dlq read failed'));
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

  it('claims, dispatches, and acknowledges a worker retry', async () => {
    const response = await request(app).post('/api/v1/admin/dlq/sync-123/retry');

    expect(response.status).toBe(200);
    expect(response.body.entry).toEqual({
      id: 'sync-123',
      category: 'sync',
      operation: 'sync:sync-wallet',
    });
    expect(response.body.retry).toEqual({
      success: true,
      message: 'Worker retry accepted',
    });
    expect(mockEnqueueDeadLetterJob).toHaveBeenCalledWith(
      expect.objectContaining({ queue: 'sync', name: 'sync-wallet' }),
      'sync-123',
    );
    expect(mockDlqAcknowledgeRetry).toHaveBeenCalledWith(
      'sync-123',
      'claim-token',
    );
  });

  it('returns 404 when retrying a non-existent DLQ entry', async () => {
    mockDlqClaimForRetry.mockResolvedValue({ status: 'missing' });

    const response = await request(app).post('/api/v1/admin/dlq/missing/retry');

    expect(response.status).toBe(404);
    expect(response.body.message).toBe('Dead letter entry not found');
  });

  it('returns 409 when another caller holds the retry lease', async () => {
    mockDlqClaimForRetry.mockResolvedValue({ status: 'busy' });
    const response = await request(app).post('/api/v1/admin/dlq/busy/retry');
    expect(response.status).toBe(409);
    expect(response.body.message).toContain('already being retried');
  });

  it('releases unsupported diagnostic entries without deleting them', async () => {
    mockDlqClaimForRetry.mockResolvedValue({
      status: 'claimed',
      claim: {
        token: 'claim-token',
        expiresAt: new Date(),
        entry: {
          id: 'push-456',
          category: 'push',
          operation: 'push_notification',
        },
      },
    });
    const response = await request(app).post('/api/v1/admin/dlq/push-456/retry');

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('not a retriable worker job');
    expect(mockDlqReleaseRetry).toHaveBeenCalledWith(
      'push-456',
      'claim-token',
    );
  });

  it('releases the lease when the worker queue rejects dispatch', async () => {
    mockEnqueueDeadLetterJob.mockResolvedValue(false);
    const response = await request(app).post('/api/v1/admin/dlq/sync-123/retry');
    expect(response.status).toBe(503);
    expect(mockDlqReleaseRetry).toHaveBeenCalledWith(
      'sync-123',
      'claim-token',
    );
    expect(mockDlqAcknowledgeRetry).not.toHaveBeenCalled();
  });

  it('releases the lease when retry dispatch throws', async () => {
    mockEnqueueDeadLetterJob.mockRejectedValue(new Error('queue full'));
    const response = await request(app).post('/api/v1/admin/dlq/sync-123/retry');

    expect(response.status).toBe(500);
    expect(mockDlqReleaseRetry).toHaveBeenCalledWith(
      'sync-123',
      'claim-token',
    );
  });

  it('reports acknowledgement loss after an accepted retry', async () => {
    mockDlqAcknowledgeRetry.mockResolvedValue(false);
    const response = await request(app).post('/api/v1/admin/dlq/sync-123/retry');
    expect(response.status).toBe(503);
    expect(mockDlqReleaseRetry).not.toHaveBeenCalled();
  });

  it('returns 500 when claiming throws unexpectedly', async () => {
    mockDlqClaimForRetry.mockRejectedValue(
      new Error('database connection lost'),
    );

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
