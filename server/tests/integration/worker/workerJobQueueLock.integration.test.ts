import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerJobQueue } from '../../../src/worker/workerJobQueue';
import { shutdownDistributedLock } from '../../../src/infrastructure/distributedLock';

function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('worker job queue locking integration', () => {
  afterEach(() => {
    shutdownDistributedLock();
    vi.useRealTimers();
  });

  it('does not run a second same-wallet sync while first long sync is still active', async () => {
    vi.useFakeTimers();
    const queue = new WorkerJobQueue({
      concurrency: 1,
      queues: ['sync'],
    });

    const firstStarted = createDeferred<void>();
    const releaseFirst = createDeferred<void>();
    let executions = 0;

    queue.registerHandler('sync', {
      name: 'sync-wallet',
      queue: 'sync',
      lockOptions: {
        lockKey: (data) => `sync:wallet:${(data as { walletId: string }).walletId}`,
        lockTtlMs: 1200,
      },
      handler: async () => {
        executions += 1;
        if (executions === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }

        return { execution: executions };
      },
    });

    const processJob = (queue as unknown as {
      processJob: (queueName: string, job: { id: string; name: string; data: { walletId: string } }) => Promise<unknown>;
    }).processJob.bind(queue);

    const firstRunPromise = processJob('sync', {
      id: 'job-1',
      name: 'sync-wallet',
      data: { walletId: 'wallet-1' },
    });

    await firstStarted.promise;

    // Advance beyond initial TTL. Refresh should keep the lock alive.
    await vi.advanceTimersByTimeAsync(1500);

    const secondRunResult = await processJob('sync', {
      id: 'job-2',
      name: 'sync-wallet',
      data: { walletId: 'wallet-1' },
    });

    expect(secondRunResult).toEqual({ skipped: true, reason: 'lock_held' });

    releaseFirst.resolve();
    await firstRunPromise;

    const thirdRunResult = await processJob('sync', {
      id: 'job-3',
      name: 'sync-wallet',
      data: { walletId: 'wallet-1' },
    });

    expect(thirdRunResult).toEqual({ execution: 2 });
  });
});
