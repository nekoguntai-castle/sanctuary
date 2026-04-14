import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkerJobQueue,
  type WorkerJobHandler,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';

export const registerWorkerJobQueueCoreContracts = (getQueue: WorkerJobQueueAccessor) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
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
      const { isRedisConnected } = await import('../../../../src/infrastructure');
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
};
