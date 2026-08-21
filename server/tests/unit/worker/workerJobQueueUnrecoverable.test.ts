import { UnrecoverableError } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';
import { setupWorkerEventHandlers } from '../../../src/worker/workerJobQueue/eventHandlers';
import { isRetainedUnrecoverableJobFailure } from '../../../src/worker/workerJobQueue/jobFailureClassification';

describe('worker queue unrecoverable failure contract', () => {
  it('normalizes a cross-realm failure into BullMQ retained terminal evidence', () => {
    const handlers: Record<string, (...args: any[]) => void> = {};
    const worker = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers[event] = handler;
      }),
    };
    const recordExhaustedJob = vi.fn().mockResolvedValue('entry-1');
    setupWorkerEventHandlers('sync', worker as any, undefined, recordExhaustedJob);

    handlers.failed?.({
      id: 'invalid-job',
      name: 'sync-wallet',
      attemptsMade: 1,
      opts: { attempts: 3 },
    }, { name: 'UnrecoverableError', message: 'invalid payload' });

    const normalized = recordExhaustedJob.mock.calls[0]?.[3];
    expect(normalized).toBeInstanceOf(UnrecoverableError);
    expect(normalized.stack).toMatch(/^UnrecoverableError: invalid payload/);
    expect(isRetainedUnrecoverableJobFailure({
      failedReason: normalized.message,
      stacktrace: [normalized.stack],
    })).toBe(true);
  });
});
