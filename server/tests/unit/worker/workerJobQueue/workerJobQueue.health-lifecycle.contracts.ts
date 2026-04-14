import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type WorkerJobQueueAccessor } from './workerJobQueueTestHarness';

export const registerWorkerJobQueueHealthLifecycleContracts = (getQueue: WorkerJobQueueAccessor) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
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

  describe('getJobCompletionTimes', () => {
    it('returns empty object initially', async () => {
      await queue.initialize();
      expect(queue.getJobCompletionTimes()).toEqual({});
    });

    it('records completion timestamps via event handlers', async () => {
      await queue.initialize();

      // The setupWorkerEventHandlers was called with the completion map.
      // Simulate a completed event by calling the handler registered on the worker.
      const syncWorker = (queue as any).queues.get('sync').worker;
      const completedCalls = syncWorker.on.mock.calls.filter(
        (call: any) => call[0] === 'completed'
      );
      // The first 'completed' listener is from setupWorkerEventHandlers
      const completedHandler = completedCalls[0][1];

      completedHandler({
        id: 'j-1',
        name: 'sync-wallet',
        processedOn: 100,
        finishedOn: 200,
      });

      const times = queue.getJobCompletionTimes();
      expect(times['sync:sync-wallet']).toBeGreaterThan(0);
    });
  });

  describe('onJobCompleted', () => {
    /** Helper: get the last 'completed' listener registered on a queue's worker */
    function getOnCompleted(queueName: string) {
      const worker = (queue as any).queues.get(queueName).worker;
      const completedCalls = worker.on.mock.calls.filter(
        (call: any) => call[0] === 'completed'
      );
      return completedCalls[completedCalls.length - 1][1];
    }

    it('calls callback when matching job completes', async () => {
      await queue.initialize();
      const callback = vi.fn();

      queue.onJobCompleted('sync', 'check-stale-wallets', callback);

      const onCompleted = getOnCompleted('sync');
      // BullMQ Worker completed event: (job, returnvalue, prev)
      onCompleted({ name: 'check-stale-wallets' }, { staleWalletIds: ['w1'] });

      expect(callback).toHaveBeenCalledWith({ staleWalletIds: ['w1'] });
    });

    it('does not call callback for non-matching job names', async () => {
      await queue.initialize();
      const callback = vi.fn();

      queue.onJobCompleted('sync', 'check-stale-wallets', callback);

      const onCompleted = getOnCompleted('sync');
      onCompleted({ name: 'sync-wallet' }, {});

      expect(callback).not.toHaveBeenCalled();
    });

    it('handles async callback errors gracefully', async () => {
      await queue.initialize();
      const callback = vi.fn().mockRejectedValue(new Error('callback failed'));

      queue.onJobCompleted('sync', 'check-stale-wallets', callback);

      const onCompleted = getOnCompleted('sync');
      // Should not throw
      onCompleted({ name: 'check-stale-wallets' }, {});
      await Promise.resolve();
    });

    it('handles sync callback errors gracefully', async () => {
      await queue.initialize();
      const callback = vi.fn().mockImplementation(() => { throw new Error('sync error'); });

      queue.onJobCompleted('sync', 'check-stale-wallets', callback);

      const onCompleted = getOnCompleted('sync');
      // Should not throw
      onCompleted({ name: 'check-stale-wallets' }, {});
    });

    it('warns when queue does not exist', async () => {
      await queue.initialize();

      // Should not throw for non-existent queue
      queue.onJobCompleted('nonexistent', 'some-job', vi.fn());
    });
  });
};
