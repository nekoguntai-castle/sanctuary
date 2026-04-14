import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WorkerJobQueue,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';

export const registerWorkerJobQueueRecurringContracts = (getQueue: WorkerJobQueueAccessor) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
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

    it('should return early (idempotent) when exact jobId already exists', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: 'check-stale', id: 'repeat:sync:check-stale:*/5 * * * *', key: 'key-1' },
      ]);

      const job = await queue.scheduleRecurring('sync', 'check-stale', {}, '*/5 * * * *');

      expect(job).toBeNull();
      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(syncQueue.add).not.toHaveBeenCalled();
    });

    it('should remove stale repeatable with different cron before scheduling new one', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      // Old cron was every 10 min, new cron is every 5 min
      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: 'check-stale', id: 'repeat:sync:check-stale:*/10 * * * *', key: 'old-key' },
      ]);

      const job = await queue.scheduleRecurring('sync', 'check-stale', {}, '*/5 * * * *');

      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith('old-key');
      expect(job).toBeDefined();
      expect(syncQueue.add).toHaveBeenCalled();
    });

    it('should not remove repeatables belonging to a different job name', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: 'other-job', id: 'repeat:sync:other-job:*/5 * * * *', key: 'other-key' },
      ]);

      const job = await queue.scheduleRecurring('sync', 'check-stale', {}, '*/5 * * * *');

      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(job).toBeDefined();
    });

    it('should remove multiple stale repeatables for the same job name', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: 'check-stale', id: 'repeat:sync:check-stale:*/10 * * * *', key: 'stale-1' },
        { name: 'check-stale', id: 'repeat:sync:check-stale:*/15 * * * *', key: 'stale-2' },
      ]);

      const job = await queue.scheduleRecurring('sync', 'check-stale', {}, '*/5 * * * *');

      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith('stale-1');
      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith('stale-2');
      expect(job).toBeDefined();
    });
  });

  describe('removeRecurring', () => {
    it('should remove repeatable jobs by name', async () => {
      await queue.initialize();
      // Use a queue that exists in this test instance
      const q = new WorkerJobQueue({
        concurrency: 1,
        queues: ['maintenance'],
      });
      await q.initialize();
      const maintenanceQueue = (q as any).queues.get('maintenance').queue;

      maintenanceQueue.getRepeatableJobs.mockResolvedValue([
        { name: 'autopilot:record-fees', key: 'key-1' },
        { name: 'autopilot:evaluate', key: 'key-2' },
        { name: 'other-job', key: 'key-3' },
      ]);

      await q.removeRecurring('maintenance', 'autopilot:record-fees');

      expect(maintenanceQueue.removeRepeatableByKey).toHaveBeenCalledWith('key-1');
      expect(maintenanceQueue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    });

    it('should return early for non-existent queue', async () => {
      await queue.initialize();

      // Should not throw
      await queue.removeRecurring('nonexistent', 'some-job');
    });

    it('should purge waiting and delayed jobs when purgeQueued is true', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.getRepeatableJobs.mockResolvedValue([]);

      const mockWaitingJob = { name: 'check-stale', remove: vi.fn() };
      const mockDelayedJob = { name: 'check-stale', remove: vi.fn() };
      const mockOtherJob = { name: 'other-job', remove: vi.fn() };

      syncQueue.getJobs = vi.fn().mockResolvedValue([mockWaitingJob, mockOtherJob, mockDelayedJob]);

      await queue.removeRecurring('sync', 'check-stale', { purgeQueued: true });

      expect(mockWaitingJob.remove).toHaveBeenCalled();
      expect(mockDelayedJob.remove).toHaveBeenCalled();
      expect(mockOtherJob.remove).not.toHaveBeenCalled();
    });

    it('should not purge queued jobs when purgeQueued is not set', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.getRepeatableJobs.mockResolvedValue([]);

      await queue.removeRecurring('sync', 'check-stale');

      // getJobs should not be called since purgeQueued is not set
      expect(syncQueue.getJobs).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get('sync').queue;

      syncQueue.getRepeatableJobs.mockRejectedValue(new Error('Redis error'));

      // Should not throw
      await queue.removeRecurring('sync', 'check-stale');
    });
  });
};
