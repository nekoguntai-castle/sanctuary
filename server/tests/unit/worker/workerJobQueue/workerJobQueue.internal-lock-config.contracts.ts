import { expect, it, vi } from 'vitest';

import {
  acquireLock,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';
import { processJobWithLock } from '../../../../src/worker/workerJobQueue/jobProcessor';

export const registerWorkerJobQueueInternalLockConfigContracts = (
  getQueue: WorkerJobQueueAccessor,
) => {
  it('schedules refresh strictly before short lock TTL expiry', async () => {
    const queue = getQueue();
    vi.mocked(acquireLock).mockResolvedValueOnce({
      key: 'lock:short-ttl',
      token: 'token-short-ttl',
      expiresAt: Date.now() + 9,
      isLocal: false,
    } as any);
    const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
    queue.registerHandler('sync', {
      name: 'short-ttl',
      queue: 'sync',
      handler: vi.fn(async () => undefined),
      lockOptions: { lockKey: () => 'lock:short-ttl', lockTtlMs: 9 },
    });

    await (queue as any).processJob('sync', {
      id: 'j-short-ttl',
      name: 'short-ttl',
      data: {},
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 3);
    setTimeoutSpy.mockRestore();
  });

  it('uses default lock TTL when lockTtlMs is not provided', async () => {
    const queue = getQueue();
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
    expect(vi.mocked(acquireLock)).toHaveBeenCalledWith(
      'lock:default-ttl',
      { ttlMs: 5 * 60 * 1000 },
    );
  });

  it.each([1, 1.5])('rejects invalid lock TTL %s before acquiring a lock', async (lockTtlMs) => {
    await expect(processJobWithLock(
      'sync:invalid-ttl',
      {
        handler: async () => undefined,
        lockOptions: { lockKey: () => 'lock:invalid-ttl', lockTtlMs },
      },
      { id: 'j-invalid-ttl', data: {} } as any,
    )).rejects.toThrow('must be an integer of at least 2ms');
    expect(acquireLock).not.toHaveBeenCalled();
  });

  it('passes an already-aborted shutdown signal to an unlocked handler', async () => {
    const shutdownController = new AbortController();
    shutdownController.abort(new Error('shutdown already requested'));

    await expect(processJobWithLock(
      'sync:unlocked-pre-aborted',
      {
        handler: async (_job, execution) => execution?.throwIfAborted(),
      },
      { id: 'j-unlocked-pre-aborted', data: {} } as any,
      { shutdownSignal: shutdownController.signal },
    )).rejects.toThrow('shutdown already requested');
  });
};
