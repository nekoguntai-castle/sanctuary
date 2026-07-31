import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  mockRedis,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';

export const registerWorkerJobQueueHealthLifecycleContracts = (getQueue: WorkerJobQueueAccessor) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
  });

  afterEach(() => {
    vi.useRealTimers();
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

    it('runs periodic DLQ reconciliation until shutdown clears the timer', async () => {
      vi.useFakeTimers();
      const reconcile = vi.spyOn(queue, 'reconcileDeadLetters');
      await queue.initialize();
      reconcile.mockClear();

      await vi.advanceTimersByTimeAsync(60_000);
      expect(reconcile).toHaveBeenCalledTimes(1);

      await queue.shutdown();
      reconcile.mockClear();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(reconcile).not.toHaveBeenCalled();
    });

    it('awaits and contains a rejecting in-flight DLQ reconciliation', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;
      let rejectReconciliation!: (error: Error) => void;
      syncQueue.getJobs.mockReturnValueOnce(new Promise((_, reject) => {
        rejectReconciliation = reject;
      }));

      const reconciliation = queue.reconcileDeadLetters();
      const rejection = expect(reconciliation).rejects.toThrow(
        'Failed to reconcile exhausted jobs',
      );
      let shutdownSettled = false;
      const shutdown = queue.shutdown().then(() => {
        shutdownSettled = true;
      });
      await Promise.resolve();
      expect(shutdownSettled).toBe(false);

      rejectReconciliation(new Error('Redis unavailable'));
      await rejection;
      await shutdown;
      expect(shutdownSettled).toBe(true);
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

  describe('getRecurringHeartbeatSnapshot', () => {
    it('returns an empty healthy snapshot when no freshness definitions exist', async () => {
      await queue.initialize();
      await expect(queue.getRecurringHeartbeatSnapshot([])).resolves.toEqual({
        healthy: true,
        records: {},
      });
    });

    it('records only matching BullMQ scheduler completions', async () => {
      await queue.initialize();
      await queue.scheduleRecurring({
        schedulerId: 'sync:check-stale-wallets',
        queue: 'sync',
        name: 'check-stale-wallets',
        data: {},
        recurrence: { every: 90_000 },
        freshness: { maxAgeMs: 180_000, startupGraceMs: 120_000 },
      });
      const syncWorker = (queue as any).queues.get('sync').worker;
      const recurringData = (queue as any).queues
        .get('sync')
        .queue.upsertJobScheduler.mock.calls[0][2].data;
      const completedHandler = syncWorker.on.mock.calls.find(
        (call: any[]) => call[0] === 'completed',
      )[1];
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      completedHandler({
        id: 'manual',
        name: 'check-stale-wallets',
        opts: {},
      });
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      completedHandler({
        id: 'wrong-name',
        name: 'sync-wallet',
        repeatJobKey: 'sync:check-stale-wallets',
        data: recurringData,
        timestamp: 2_000,
        opts: { repeat: { every: 90_000 } },
      });
      const notificationsWorker = (queue as any).queues.get(
        'notifications',
      ).worker;
      const notificationsCompleted = notificationsWorker.on.mock.calls.find(
        (call: any[]) => call[0] === 'completed',
      )[1];
      notificationsCompleted({
        id: 'wrong-queue',
        name: 'check-stale-wallets',
        repeatJobKey: 'sync:check-stale-wallets',
        data: recurringData,
        timestamp: 2_000,
        opts: { repeat: { every: 90_000 } },
      });
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(1);

      completedHandler({
        id: 'recurring',
        name: 'check-stale-wallets',
        repeatJobKey: 'sync:check-stale-wallets',
        data: recurringData,
        // BullMQ creates the first job before the generation is persisted.
        timestamp: 500,
        processedOn: 2_000,
        opts: { repeat: { every: 90_000 } },
      });
      await Promise.resolve();
      expect(mockRedis.eval).toHaveBeenCalledTimes(2);
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
