import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createdWorkers,
  mockDlqAdd,
  mockRecordCaptureTerminal,
  mockRecordNotificationTelemetry,
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
        'sync',
        expect.objectContaining({
          id: 'job-2',
          name: 'sync-wallet',
          attemptsMade: 3,
        }),
        expect.any(Error)
      );
    });

    it('records safe transaction attempt and terminal outcomes from worker callbacks', () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };

      setupWorkerEventHandlers('notifications', fakeWorker as any);
      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 'a'.repeat(64) },
        returnvalue: {
          outcome: 'accepted',
          failureClass: 'none',
          channelOutcomes: [{ channel: 'telegram', outcome: 'accepted', failureClass: 'none' }],
        },
      });
      handlers.failed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 'a'.repeat(64) },
        progress: {
          version: 1,
          attemptOrdinal: 5,
          notification: {
            outcome: 'rejected',
            failureClass: 'authentication',
            channels: [{ channel: 'telegram', outcome: 'rejected', failureClass: 'authentication' }],
          },
        },
        attemptsMade: 5,
        opts: { attempts: 5 },
      }, new Error('provider poison'));

      expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'terminal_completed',
          outcome: 'accepted',
          failureClass: 'none',
        }),
      );
      expect(mockRecordCaptureTerminal).toHaveBeenCalledWith(expect.objectContaining({
        terminalState: 'failed',
        telegramOutcome: 'rejected',
        telegramFailureClass: 'authentication',
      }));
      expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'attempt_failed',
          outcome: 'rejected',
          failureClass: 'authentication',
        }),
      );
      expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'terminal_failure',
          outcome: 'rejected',
          failureClass: 'authentication',
        }),
      );
      expect(JSON.stringify(mockRecordNotificationTelemetry.mock.calls)).not.toContain(
        'provider poison',
      );
    });

    it('records bounded capture fallbacks for malformed or absent channel results', () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };
      setupWorkerEventHandlers('notifications', fakeWorker as any);

      handlers.completed?.({ name: 'transaction-notify' });
      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 1, txid: 'f'.repeat(64) },
      });
      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 1 },
      });

      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 'b'.repeat(64) },
        returnvalue: null,
      });
      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 'c'.repeat(64) },
        returnvalue: { outcome: 'accepted', failureClass: 'none' },
      });
      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 'd'.repeat(64) },
        returnvalue: { channelOutcomes: [null, 'invalid'] },
      });
      handlers.completed?.({
        name: 'transaction-notify',
        data: { walletId: 'wallet-1', txid: 'e'.repeat(64) },
        returnvalue: {
          channelOutcomes: [{ channel: 'telegram', outcome: 'private', failureClass: 'private' }],
        },
      });

      expect(mockRecordCaptureTerminal).toHaveBeenCalledWith(expect.objectContaining({
        telegramOutcome: 'ambiguous',
        telegramFailureClass: 'unknown',
      }));
      expect(mockRecordCaptureTerminal).toHaveBeenCalledWith(expect.objectContaining({
        telegramOutcome: 'not_registered',
        telegramFailureClass: 'none',
      }));
    });

    it('does not attribute stale prior-attempt progress to a later crash', () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };
      setupWorkerEventHandlers('notifications', fakeWorker as any);

      handlers.failed?.({
        name: 'transaction-notify',
        progress: {
          version: 1,
          attemptOrdinal: 1,
          notification: { outcome: 'rejected', failureClass: 'authentication' },
        },
        attemptsMade: 2,
        opts: { attempts: 5 },
      }, new Error('later crash poison'));

      expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(
        expect.objectContaining({
          stage: 'attempt_failed',
          outcome: 'ambiguous',
          failureClass: 'unknown',
        }),
      );
      expect(JSON.stringify(mockRecordNotificationTelemetry.mock.calls))
        .not.toContain('authentication');
    });

    it('treats missing and primitive attempt progress as ambiguous', () => {
      const handlers: Record<string, (...args: any[]) => void> = {};
      const fakeWorker = {
        on: vi.fn((event: string, handler: (...args: any[]) => void) => {
          handlers[event] = handler;
        }),
      };
      setupWorkerEventHandlers('notifications', fakeWorker as any);

      for (const progress of [undefined, 'stale-private-progress']) {
        handlers.failed?.({
          name: 'transaction-notify',
          progress,
          attemptsMade: 1,
          opts: { attempts: 5 },
        }, new Error('failure detail'));
      }

      expect(mockRecordNotificationTelemetry).toHaveBeenCalledTimes(2);
      expect(mockRecordNotificationTelemetry).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'attempt_failed',
        outcome: 'ambiguous',
        failureClass: 'unknown',
      }));
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
