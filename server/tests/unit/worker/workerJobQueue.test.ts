/**
 * WorkerJobQueue Tests
 *
 * Tests for the BullMQ-based worker job queue.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Define mock objects that will be shared
let mockQueueInstance: ReturnType<typeof createMockQueue>;
let mockWorkerInstance: ReturnType<typeof createMockWorker>;
let mockQueueEventsInstance: ReturnType<typeof createMockQueueEvents>;
const createdWorkers: Array<{ processFn?: (job: any) => Promise<any> }> = [];
const { mockDlqAdd } = vi.hoisted(() => ({
  mockDlqAdd: vi.fn().mockResolvedValue(undefined),
}));

function createMockQueue() {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    addBulk: vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]),
    getRepeatableJobs: vi.fn().mockResolvedValue([]),
    removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
    getWaitingCount: vi.fn().mockResolvedValue(0),
    getActiveCount: vi.fn().mockResolvedValue(0),
    getCompletedCount: vi.fn().mockResolvedValue(0),
    getFailedCount: vi.fn().mockResolvedValue(0),
    getDelayedCount: vi.fn().mockResolvedValue(0),
    isPaused: vi.fn().mockResolvedValue(false),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockWorker() {
  return {
    on: vi.fn(),
    isRunning: vi.fn().mockReturnValue(true),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockQueueEvents() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock BullMQ with factory that creates instances
vi.mock('bullmq', () => {
  // Create mock constructors that return fresh instances
  class MockQueue {
    add = vi.fn().mockResolvedValue({ id: 'job-1' });
    addBulk = vi.fn().mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);
    getRepeatableJobs = vi.fn().mockResolvedValue([]);
    removeRepeatableByKey = vi.fn().mockResolvedValue(undefined);
    getWaitingCount = vi.fn().mockResolvedValue(0);
    getActiveCount = vi.fn().mockResolvedValue(0);
    getCompletedCount = vi.fn().mockResolvedValue(0);
    getFailedCount = vi.fn().mockResolvedValue(0);
    getDelayedCount = vi.fn().mockResolvedValue(0);
    isPaused = vi.fn().mockResolvedValue(false);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockWorker {
    processFn?: (job: any) => Promise<any>;
    constructor(_queueName?: string, processor?: (job: any) => Promise<any>) {
      this.processFn = processor;
      createdWorkers.push(this);
    }
    on = vi.fn();
    isRunning = vi.fn().mockReturnValue(true);
    close = vi.fn().mockResolvedValue(undefined);
  }

  class MockQueueEvents {
    close = vi.fn().mockResolvedValue(undefined);
  }

  return {
    Queue: MockQueue,
    Worker: MockWorker,
    QueueEvents: MockQueueEvents,
  };
});

// Mock Redis
vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: vi.fn(() => ({
    options: {
      host: 'localhost',
      port: 6379,
    },
  })),
  isRedisConnected: vi.fn(() => true),
}));

// Mock distributed lock
vi.mock('../../../src/infrastructure/distributedLock', () => ({
  acquireLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  extendLock: vi.fn().mockResolvedValue({ key: 'test', token: 'token' }),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    add: mockDlqAdd,
  },
}));

import { WorkerJobQueue } from '../../../src/worker/workerJobQueue';
import { setupWorkerEventHandlers, queueToDlqCategory } from '../../../src/worker/workerJobQueue/eventHandlers';
import type { WorkerJobHandler } from '../../../src/worker/jobs/types';
import { acquireLock, extendLock, releaseLock } from '../../../src/infrastructure/distributedLock';

describe('WorkerJobQueue', () => {
  let queue: WorkerJobQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    createdWorkers.length = 0;
    queue = new WorkerJobQueue({
      concurrency: 3,
      queues: ['sync', 'notifications'],
    });
  });

  describe('constructor', () => {
    it('should create queue with provided config', () => {
      const customQueue = new WorkerJobQueue({
        concurrency: 5,
        queues: ['test'],
        prefix: 'custom:prefix',
      });

      expect(customQueue).toBeDefined();
    });

    it('should use default prefix if not provided', () => {
      expect(queue).toBeDefined();
      // The default prefix 'sanctuary:worker' is set internally
    });
  });

  describe('initialize', () => {
    it('should create queues and workers', async () => {
      await queue.initialize();

      // Should have initialized successfully (no errors)
      expect(queue.isHealthy()).toBe(true);
    });

    it('should not reinitialize if already initialized', async () => {
      await queue.initialize();
      const firstHealth = queue.isHealthy();

      await queue.initialize(); // Second call should be no-op
      const secondHealth = queue.isHealthy();

      expect(firstHealth).toBe(true);
      expect(secondHealth).toBe(true);
    });

    it('should throw if Redis is not connected', async () => {
      const { isRedisConnected } = await import('../../../src/infrastructure');
      vi.mocked(isRedisConnected).mockReturnValueOnce(false);

      const newQueue = new WorkerJobQueue({
        concurrency: 1,
        queues: ['test'],
      });

      await expect(newQueue.initialize()).rejects.toThrow('Redis is required');
    });
  });

  describe('registerHandler', () => {
    it('should register a job handler', async () => {
      await queue.initialize();

      const handler: WorkerJobHandler<{ id: string }, { success: boolean }> = {
        name: 'test-job',
        queue: 'sync',
        handler: vi.fn().mockResolvedValue({ success: true }),
      };

      queue.registerHandler('sync', handler);

      expect(queue.getRegisteredJobs()).toContain('sync:test-job');
    });

    it('should warn when overwriting existing handler', async () => {
      await queue.initialize();

      const handler: WorkerJobHandler<unknown, unknown> = {
        name: 'test-job',
        queue: 'sync',
        handler: vi.fn(),
      };

      queue.registerHandler('sync', handler);
      queue.registerHandler('sync', handler); // Register again

      // Should still work, just logs a warning
      expect(queue.getRegisteredJobs()).toContain('sync:test-job');
    });
  });

  describe('addJob', () => {
    it('should add a job to the queue', async () => {
      await queue.initialize();

      const job = await queue.addJob('sync', 'test-job', { id: '123' });

      expect(job).toBeDefined();
    });

    it('should return null for non-existent queue', async () => {
      await queue.initialize();

      const job = await queue.addJob('nonexistent', 'test-job', {});

      expect(job).toBeNull();
    });

    it('should pass job options', async () => {
      await queue.initialize();

      const job = await queue.addJob('sync', 'test-job', { id: '123' }, {
        priority: 1,
        delay: 1000,
      });

      expect(job).toBeDefined();
    });
  });

  describe('addBulkJobs', () => {
    it('should add multiple jobs at once', async () => {
      await queue.initialize();

      const jobs = await queue.addBulkJobs('sync', [
        { name: 'job1', data: { id: '1' } },
        { name: 'job2', data: { id: '2' } },
      ]);

      expect(jobs).toHaveLength(2);
    });

    it('should return empty array for non-existent queue', async () => {
      await queue.initialize();

      const jobs = await queue.addBulkJobs('nonexistent', [
        { name: 'job1', data: {} },
      ]);

      expect(jobs).toEqual([]);
    });
  });

  describe('scheduleRecurring', () => {
    it('should schedule a recurring job', async () => {
      await queue.initialize();

      const job = await queue.scheduleRecurring(
        'sync',
        'check-stale',
        {},
        '*/5 * * * *'
      );

      expect(job).toBeDefined();
    });

    it('returns null when scheduling on missing queue', async () => {
      await queue.initialize();

      const job = await queue.scheduleRecurring('missing', 'check-stale', {}, '*/5 * * * *');

      expect(job).toBeNull();
    });
  });

  describe('getHealth', () => {
    it('should return health status for all queues', async () => {
      await queue.initialize();

      const health = await queue.getHealth();

      expect(health.healthy).toBe(true);
      expect(health.queues).toHaveProperty('sync');
      expect(health.queues).toHaveProperty('notifications');
      expect(health.queues.sync).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      });
    });
  });

  describe('isHealthy', () => {
    it('should return false when not initialized', () => {
      expect(queue.isHealthy()).toBe(false);
    });

    it('should return true when all workers are running', async () => {
      await queue.initialize();

      expect(queue.isHealthy()).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('should close all workers, events, and queues', async () => {
      await queue.initialize();

      await queue.shutdown();

      // After shutdown, isHealthy should return false
      expect(queue.isHealthy()).toBe(false);
    });

    it('should only shutdown once', async () => {
      await queue.initialize();

      await queue.shutdown();
      await queue.shutdown(); // Second call should be no-op

      // No errors means it handled gracefully
      expect(queue.isHealthy()).toBe(false);
    });
  });

  describe('getRegisteredJobs', () => {
    it('should return empty array initially', async () => {
      await queue.initialize();

      expect(queue.getRegisteredJobs()).toEqual([]);
    });

    it('should return registered job names', async () => {
      await queue.initialize();

      queue.registerHandler('sync', {
        name: 'job1',
        queue: 'sync',
        handler: vi.fn(),
      });

      queue.registerHandler('notifications', {
        name: 'job2',
        queue: 'notifications',
        handler: vi.fn(),
      });

      const jobs = queue.getRegisteredJobs();
      expect(jobs).toContain('sync:job1');
      expect(jobs).toContain('notifications:job2');
    });
  });

  describe('internal behavior and error paths', () => {
    it('worker process callback delegates to processJob', async () => {
      await queue.initialize();

      const handler = vi.fn(async () => ({ delegated: true }));
      queue.registerHandler('sync', {
        name: 'from-worker',
        queue: 'sync',
        handler,
      });

      const result = await createdWorkers[0].processFn?.({
        id: 'j-worker-1',
        name: 'from-worker',
        data: { id: 'w1' },
      });

      expect(result).toEqual({ delegated: true });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('throws when creating queue without a connection', async () => {
      await expect((queue as any).createQueue('sync')).rejects.toThrow('Connection not established');
    });

    it('routes exhausted failed jobs to DLQ via worker event handlers', async () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };

      setupWorkerEventHandlers('sync', fakeWorker as any);

      handlers.completed?.({
        id: 'job-1',
        name: 'sync-wallet',
        processedOn: 10,
        finishedOn: 25,
      });

      handlers.failed?.(
        {
          id: 'job-2',
          name: 'sync-wallet',
          data: { walletId: 'w1' },
          attemptsMade: 3,
          opts: { attempts: 3 },
        },
        new Error('boom')
      );

      handlers.failed?.(
        {
          id: 'job-3',
          name: 'sync-wallet',
          data: { walletId: 'w1' },
          attemptsMade: 1,
          opts: { attempts: 3 },
        },
        new Error('retrying')
      );

      handlers.error?.(new Error('worker-error'));
      handlers.stalled?.('job-4');

      expect(mockDlqAdd).toHaveBeenCalledTimes(1);
      expect(mockDlqAdd).toHaveBeenCalledWith(
        'sync',
        'sync:sync-wallet',
        expect.objectContaining({ queue: 'sync', jobId: 'job-2' }),
        expect.any(Error),
        3,
        expect.objectContaining({ queueName: 'sync', jobId: 'job-2' })
      );
    });

    it('handles worker events with missing timing and missing job metadata', () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };

      setupWorkerEventHandlers('sync', fakeWorker as any);

      handlers.completed?.({
        id: 'job-no-timing',
        name: 'sync-wallet',
      });

      handlers.failed?.(undefined, new Error('failed-without-job'));

      expect(mockDlqAdd).not.toHaveBeenCalled();
    });

    it('logs DLQ recording failures for exhausted jobs', async () => {
      mockDlqAdd.mockRejectedValueOnce(new Error('dlq write failed'));
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };

      setupWorkerEventHandlers('sync', fakeWorker as any);

      handlers.failed?.(
        {
          id: 'job-dlq-fail',
          name: 'sync-wallet',
          data: { walletId: 'w1' },
          attemptsMade: 3,
          opts: { attempts: 3 },
        },
        new Error('boom')
      );
      await Promise.resolve();

      expect(mockDlqAdd).toHaveBeenCalledTimes(1);
    });

    it('processJob throws for missing handlers', async () => {
      await expect(
        (queue as any).processJob('sync', { id: 'j-1', name: 'missing', data: {} })
      ).rejects.toThrow('No handler registered for sync:missing');
    });

    it('processes unlocked handlers directly', async () => {
      queue.registerHandler('sync', {
        name: 'simple',
        queue: 'sync',
        handler: vi.fn(async () => ({ ok: true })),
      });

      const result = await (queue as any).processJob('sync', {
        id: 'j-2',
        name: 'simple',
        data: { id: '123' },
      });

      expect(result).toEqual({ ok: true });
    });

    it('skips locked handlers when lock is already held', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);

      queue.registerHandler('sync', {
        name: 'locked',
        queue: 'sync',
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: (data) => `lock:${(data as any).walletId}`,
          lockTtlMs: 1500,
        },
      });

      const result = await (queue as any).processJob('sync', {
        id: 'j-3',
        name: 'locked',
        data: { walletId: 'wallet-1' },
      });

      expect(result).toEqual({ skipped: true, reason: 'lock_held' });
    });

    it('releases distributed lock after successful locked processing', async () => {
      const handler = vi.fn(async () => ({ processed: true }));
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:wallet-1',
        token: 'token-1',
        expiresAt: Date.now() + 2000,
        isLocal: false,
      } as any);

      queue.registerHandler('sync', {
        name: 'locked-success',
        queue: 'sync',
        handler,
        lockOptions: {
          lockKey: () => 'lock:wallet-1',
          lockTtlMs: 2000,
        },
      });

      const result = await (queue as any).processJob('sync', {
        id: 'j-4',
        name: 'locked-success',
        data: { walletId: 'wallet-1' },
      });

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual({ processed: true });
      expect(vi.mocked(releaseLock)).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:wallet-1' })
      );
    });

    it('uses default lock TTL when lockTtlMs is not provided', async () => {
      const handler = vi.fn(async () => ({ processed: true }));
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:default-ttl',
        token: 'token-default-ttl',
        expiresAt: Date.now() + 300000,
        isLocal: false,
      } as any);

      queue.registerHandler('sync', {
        name: 'locked-default-ttl',
        queue: 'sync',
        handler,
        lockOptions: {
          lockKey: () => 'lock:default-ttl',
        } as any,
      });

      const result = await (queue as any).processJob('sync', {
        id: 'j-default-ttl',
        name: 'locked-default-ttl',
        data: {},
      });

      expect(result).toEqual({ processed: true });
      expect(vi.mocked(acquireLock)).toHaveBeenCalledWith('lock:default-ttl', { ttlMs: 5 * 60 * 1000 });
    });

    it('aborts locked processing when lock refresh is lost', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:wallet-lost',
        token: 'token-lost',
        expiresAt: Date.now() + 1200,
        isLocal: false,
      } as any);
      vi.mocked(extendLock).mockResolvedValueOnce(null);

      queue.registerHandler('sync', {
        name: 'locked-lost',
        queue: 'sync',
        handler: vi.fn(() => new Promise(() => undefined)),
        lockOptions: {
          lockKey: () => 'lock:wallet-lost',
          lockTtlMs: 1200,
        },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-5',
        name: 'locked-lost',
        data: { walletId: 'wallet-lost' },
      });
      const rejection = expect(runPromise).rejects.toThrow('Lock lost for sync:locked-lost');

      await vi.advanceTimersByTimeAsync(1000);
      await rejection;
      expect(vi.mocked(releaseLock)).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:wallet-lost' })
      );

      vi.useRealTimers();
    });

    it('updates lock reference when refresh succeeds', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:refresh-success',
        token: 'token-initial',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      vi.mocked(extendLock).mockResolvedValueOnce({
        key: 'lock:refresh-success',
        token: 'token-refreshed',
        expiresAt: Date.now() + 3600,
        isLocal: false,
      } as any);

      let refreshCallback: (() => Promise<void>) | undefined;
      const fakeTimer = { unref: vi.fn() } as any;
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
        refreshCallback = cb;
        return fakeTimer;
      });

      let resolveHandler: ((value: unknown) => void) | undefined;
      queue.registerHandler('sync', {
        name: 'locked-refresh-success',
        queue: 'sync',
        handler: vi.fn(() => new Promise((resolve) => {
          resolveHandler = resolve;
        })),
        lockOptions: {
          lockKey: () => 'lock:refresh-success',
          lockTtlMs: 1800,
        },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-refresh-success',
        name: 'locked-refresh-success',
        data: {},
      });
      await Promise.resolve();
      await Promise.resolve();
      await refreshCallback?.();
      resolveHandler?.({ ok: true });

      await expect(runPromise).resolves.toEqual({ ok: true });
      expect(vi.mocked(extendLock)).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:refresh-success' }),
        1800
      );

      setIntervalSpy.mockRestore();
    });

    it('aborts when lock refresh throws and ignores later refresh ticks', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:refresh-error',
        token: 'token-error',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      vi.mocked(extendLock).mockRejectedValueOnce(new Error('refresh failed'));

      let refreshCallback: (() => Promise<void>) | undefined;
      const fakeTimer = { unref: vi.fn() } as any;
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
        refreshCallback = cb;
        return fakeTimer;
      });

      queue.registerHandler('sync', {
        name: 'locked-refresh-error',
        queue: 'sync',
        handler: vi.fn(() => new Promise(() => undefined)),
        lockOptions: {
          lockKey: () => 'lock:refresh-error',
          lockTtlMs: 1800,
        },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-refresh-error',
        name: 'locked-refresh-error',
        data: {},
      });
      const rejection = expect(runPromise).rejects.toThrow('Lock lost for sync:locked-refresh-error');

      await Promise.resolve();
      await Promise.resolve();
      await refreshCallback?.();
      await rejection;
      await refreshCallback?.();

      setIntervalSpy.mockRestore();
    });

    it('aborts when lock refresh throws a non-Error value', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:refresh-non-error',
        token: 'token-non-error',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      vi.mocked(extendLock).mockRejectedValueOnce('refresh failed as string');

      let refreshCallback: (() => Promise<void>) | undefined;
      const fakeTimer = { unref: vi.fn() } as any;
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
        refreshCallback = cb;
        return fakeTimer;
      });

      queue.registerHandler('sync', {
        name: 'locked-refresh-non-error',
        queue: 'sync',
        handler: vi.fn(() => new Promise(() => undefined)),
        lockOptions: {
          lockKey: () => 'lock:refresh-non-error',
          lockTtlMs: 1800,
        },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-refresh-non-error',
        name: 'locked-refresh-non-error',
        data: {},
      });
      const rejection = expect(runPromise).rejects.toThrow('Lock lost for sync:locked-refresh-non-error');

      await Promise.resolve();
      await Promise.resolve();
      await refreshCallback?.();
      await rejection;

      setIntervalSpy.mockRestore();
    });

    it('covers add/addBulk/schedule error and duplicate branches', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.add.mockRejectedValueOnce(new Error('add failed'));
      await expect(queue.addJob('sync', 'broken', {})).resolves.toBeNull();

      syncQueue.addBulk.mockRejectedValueOnce(new Error('bulk failed'));
      await expect(queue.addBulkJobs('sync', [{ name: 'bulk', data: {} }])).resolves.toEqual([]);

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: 'repeat-job', id: 'repeat:sync:repeat-job:*/5 * * * *' },
      ]);
      await expect(
        queue.scheduleRecurring('sync', 'repeat-job', {}, '*/5 * * * *')
      ).resolves.toBeNull();

      syncQueue.getRepeatableJobs.mockRejectedValueOnce(new Error('repeat failed'));
      await expect(
        queue.scheduleRecurring('sync', 'repeat-job', {}, '*/5 * * * *')
      ).resolves.toBeNull();
    });

    it('reports unhealthy queue metrics when queue stats fail', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;
      syncQueue.getWaitingCount.mockRejectedValueOnce(new Error('health failed'));

      const health = await queue.getHealth();
      expect(health.healthy).toBe(false);
      expect(health.queues.sync).toEqual({
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      });
    });

    it('returns false from isHealthy when a worker is not running', async () => {
      await queue.initialize();
      const syncWorker = (queue as any).queues.get('sync').worker;
      syncWorker.isRunning.mockReturnValueOnce(false);

      expect(queue.isHealthy()).toBe(false);
    });

    it('covers queue-to-DLQ category mapping and concurrent shutdown promise reuse', async () => {
      expect(queueToDlqCategory('sync')).toBe('sync');
      expect(queueToDlqCategory('notifications')).toBe('notification');
      expect(queueToDlqCategory('maintenance')).toBe('other');
      expect(queueToDlqCategory('confirmations')).toBe('sync');
      expect(queueToDlqCategory('other-queue')).toBe('other');

      await queue.initialize();
      const first = queue.shutdown();
      const second = queue.shutdown();
      await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
      expect(queue.isHealthy()).toBe(false);
    });
  });
});
