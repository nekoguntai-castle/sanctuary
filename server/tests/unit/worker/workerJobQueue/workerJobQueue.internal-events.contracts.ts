import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createdWorkers,
  mockDlqAdd,
  setupWorkerEventHandlers,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';

export const registerWorkerJobQueueInternalEventContracts = (getQueue: WorkerJobQueueAccessor) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
  });

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

    it('hides recurring generation metadata from handlers and restores it for completion', async () => {
      await queue.initialize();
      let seenData: unknown;
      const handler = vi.fn(async (job) => {
        seenData = job.data;
        return job.data;
      });
      queue.registerHandler('sync', {
        name: 'from-recurring-worker',
        queue: 'sync',
        handler,
      });
      const job = {
        id: 'j-recurring-1',
        name: 'from-recurring-worker',
        data: {
          __sanctuaryRecurring: {
            version: 1,
            generationToken: 'generation-token',
          },
          payload: { walletId: 'w1' },
        },
      };

      await expect(createdWorkers[0].processFn?.(job)).resolves.toEqual({
        walletId: 'w1',
      });
      expect(seenData).toEqual({ walletId: 'w1' });
      expect(job.data.__sanctuaryRecurring.generationToken).toBe(
        'generation-token',
      );
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

    it('persists only scheduler-backed recurring completions', async () => {
      const persistRecurringCompletion = vi.fn().mockResolvedValue(undefined);
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };

      setupWorkerEventHandlers(
        'sync',
        fakeWorker as any,
        persistRecurringCompletion,
      );

      handlers.completed?.({
        id: 'job-1',
        name: 'sync-wallet',
        processedOn: 100,
        finishedOn: 200,
      });
      expect(persistRecurringCompletion).not.toHaveBeenCalled();

      handlers.completed?.({
        id: 'repeat-job-1',
        name: 'sync-wallet',
        repeatJobKey: 'sync:sync-wallet',
        processedOn: 100,
        finishedOn: 200,
      });
      await Promise.resolve();

      expect(persistRecurringCompletion).toHaveBeenCalledTimes(1);
    });

    it('contains recurring heartbeat callback failures after job completion', async () => {
      const persistRecurringCompletion = vi
        .fn()
        .mockRejectedValue(new Error('heartbeat unavailable'));
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };
      setupWorkerEventHandlers(
        'sync',
        fakeWorker as any,
        persistRecurringCompletion,
      );

      handlers.completed?.({
        id: 'recurring',
        name: 'check-stale-wallets',
        repeatJobKey: 'sync:check-stale-wallets',
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(persistRecurringCompletion).toHaveBeenCalledTimes(1);
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
};
