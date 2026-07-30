import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireLock,
  extendLock,
  mockHardTerminate,
  releaseLock,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';
import { processJobWithLock } from '../../../../src/worker/workerJobQueue/jobProcessor';

export const registerWorkerJobQueueInternalLockContracts = (getQueue: WorkerJobQueueAccessor) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
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

    it('releases the lock when a handler throws synchronously', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:sync-throw',
        token: 'token-sync-throw',
        expiresAt: Date.now() + 2000,
        isLocal: false,
      } as any);
      queue.registerHandler('sync', {
        name: 'sync-throw',
        queue: 'sync',
        handler: (() => {
          throw new Error('synchronous handler failure');
        }) as any,
        lockOptions: { lockKey: () => 'lock:sync-throw', lockTtlMs: 2000 },
      });

      await expect((queue as any).processJob('sync', {
        id: 'j-sync-throw',
        name: 'sync-throw',
        data: {},
      })).rejects.toThrow('synchronous handler failure');

      expect(releaseLock).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'token-sync-throw' })
      );
    });

    it('schedules refresh strictly before short lock TTL expiry', async () => {
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
      expect(mockHardTerminate).toHaveBeenCalledOnce();
      expect(mockHardTerminate).toHaveBeenCalledWith(1);
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
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
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

      setTimeoutSpy.mockRestore();
    });

    it('does not terminate or stale-release when handler settlement wins an in-flight refresh race', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:handler-wins',
        token: 'token-handler-wins',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      let resolveRefresh: ((value: null) => void) | undefined;
      vi.mocked(extendLock).mockImplementationOnce(
        () => new Promise((resolve) => { resolveRefresh = resolve; })
      );
      let refreshCallback: (() => void) | undefined;
      const fakeTimer = { unref: vi.fn() } as any;
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        refreshCallback = cb;
        return fakeTimer;
      });
      let resolveHandler: ((value: unknown) => void) | undefined;
      queue.registerHandler('sync', {
        name: 'handler-wins',
        queue: 'sync',
        handler: vi.fn(() => new Promise((resolve) => { resolveHandler = resolve; })),
        lockOptions: { lockKey: () => 'lock:handler-wins', lockTtlMs: 1800 },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-handler-wins',
        name: 'handler-wins',
        data: {},
      });
      await Promise.resolve();
      await Promise.resolve();
      refreshCallback?.();
      await Promise.resolve();
      resolveHandler?.({ committed: true });
      await Promise.resolve();
      await Promise.resolve();
      resolveRefresh?.(null);

      await expect(runPromise).resolves.toEqual({ committed: true });
      expect(mockHardTerminate).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:handler-wins' })
      );
      setTimeoutSpy.mockRestore();
    });

    it('does not terminate or stale-release when an in-flight refresh rejects after settlement', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:handler-wins-error',
        token: 'token-handler-wins-error',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      let rejectRefresh: ((error: Error) => void) | undefined;
      vi.mocked(extendLock).mockImplementationOnce(
        () => new Promise((_resolve, reject) => { rejectRefresh = reject; })
      );
      let refreshCallback: (() => void) | undefined;
      const fakeTimer = { unref: vi.fn() } as any;
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        refreshCallback = cb;
        return fakeTimer;
      });
      let resolveHandler: ((value: unknown) => void) | undefined;
      const runPromise = processJobWithLock(
        'sync:handler-wins-error',
        {
          handler: () => new Promise((resolve) => { resolveHandler = resolve; }),
          lockOptions: { lockKey: () => 'lock:handler-wins-error', lockTtlMs: 1800 },
        },
        { id: 'j-handler-wins-error', data: {} } as any,
      );
      await Promise.resolve();
      await Promise.resolve();
      refreshCallback?.();
      await Promise.resolve();
      resolveHandler?.({ committed: true });
      await Promise.resolve();
      await Promise.resolve();
      rejectRefresh?.(new Error('late refresh failure'));

      await expect(runPromise).resolves.toEqual({ committed: true });
      expect(mockHardTerminate).not.toHaveBeenCalled();
      expect(releaseLock).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:handler-wins-error' })
      );
      setTimeoutSpy.mockRestore();
    });

    it('terminates exactly once when refresh loss wins before handler settlement', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:loss-wins',
        token: 'token-loss-wins',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      let resolveRefresh: ((value: null) => void) | undefined;
      vi.mocked(extendLock).mockImplementationOnce(
        () => new Promise((resolve) => { resolveRefresh = resolve; })
      );
      let refreshCallback: (() => void) | undefined;
      const fakeTimer = { unref: vi.fn() } as any;
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        refreshCallback = cb;
        return fakeTimer;
      });
      let capturedSignal: AbortSignal | undefined;
      queue.registerHandler('sync', {
        name: 'loss-wins',
        queue: 'sync',
        handler: vi.fn((_job, execution) => {
          capturedSignal = execution?.signal;
          return new Promise(() => undefined);
        }),
        lockOptions: { lockKey: () => 'lock:loss-wins', lockTtlMs: 1800 },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-loss-wins',
        name: 'loss-wins',
        data: {},
      });
      const rejection = expect(runPromise).rejects.toThrow('Lock lost for sync:loss-wins');
      await Promise.resolve();
      await Promise.resolve();
      refreshCallback?.();
      resolveRefresh?.(null);

      await rejection;
      expect(capturedSignal?.aborted).toBe(true);
      expect(mockHardTerminate).toHaveBeenCalledTimes(1);
      expect(releaseLock).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:loss-wins' })
      );
      refreshCallback?.();
      expect(mockHardTerminate).toHaveBeenCalledTimes(1);
      setTimeoutSpy.mockRestore();
    });

    it('fails closed when an injected hard terminator unexpectedly returns', async () => {
      vi.useFakeTimers();
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:returning-terminator',
        token: 'token-returning-terminator',
        expiresAt: Date.now() + 30,
        isLocal: false,
      } as any);
      vi.mocked(extendLock).mockResolvedValueOnce(null);
      const returningTerminator = vi.fn(() => undefined) as any;

      const runPromise = processJobWithLock(
        'sync:returning-terminator',
        {
          handler: async () => new Promise(() => undefined),
          lockOptions: { lockKey: () => 'lock:returning-terminator', lockTtlMs: 30 },
        },
        { id: 'j-returning-terminator', data: {} } as any,
        { hardTerminate: returningTerminator },
      );
      const rejection = expect(runPromise).rejects.toThrow(
        'Lock lost for sync:returning-terminator'
      );
      await vi.advanceTimersByTimeAsync(10);

      await rejection;
      expect(returningTerminator).toHaveBeenCalledOnce();
      expect(releaseLock).not.toHaveBeenCalledWith(
        expect.objectContaining({ key: 'lock:returning-terminator' })
      );
      vi.useRealTimers();
    });

    it('cooperatively aborts and releases owned work during ordinary shutdown', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:shutdown',
        token: 'token-shutdown',
        expiresAt: Date.now() + 2000,
        isLocal: false,
      } as any);
      const shutdownController = new AbortController();
      let handlerStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => { handlerStarted = resolve; });

      const runPromise = processJobWithLock(
        'sync:shutdown',
        {
          handler: async (_job, execution) => {
            handlerStarted?.();
            await new Promise<void>((resolve) => {
              execution?.signal.addEventListener('abort', () => resolve(), { once: true });
            });
            execution?.throwIfAborted();
          },
          lockOptions: { lockKey: () => 'lock:shutdown', lockTtlMs: 2000 },
        },
        { id: 'j-shutdown', data: {} } as any,
        { shutdownSignal: shutdownController.signal },
      );
      await started;
      shutdownController.abort(new Error('test shutdown'));

      await expect(runPromise).rejects.toThrow('test shutdown');
      expect(mockHardTerminate).not.toHaveBeenCalled();
      expect(releaseLock).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'token-shutdown' })
      );
    });

    it('serializes refresh ticks while an extension is in flight', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce({
        key: 'lock:serialized',
        token: 'token-serialized',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      } as any);
      let resolveRefresh: ((value: any) => void) | undefined;
      vi.mocked(extendLock).mockImplementationOnce(
        () => new Promise((resolve) => { resolveRefresh = resolve; })
      );
      const callbacks: Array<() => void> = [];
      const fakeTimer = { unref: vi.fn() } as any;
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
        callbacks.push(cb);
        return fakeTimer;
      });
      let resolveHandler: (() => void) | undefined;
      queue.registerHandler('sync', {
        name: 'serialized',
        queue: 'sync',
        handler: vi.fn(() => new Promise<void>((resolve) => { resolveHandler = resolve; })),
        lockOptions: { lockKey: () => 'lock:serialized', lockTtlMs: 1800 },
      });

      const runPromise = (queue as any).processJob('sync', {
        id: 'j-serialized',
        name: 'serialized',
        data: {},
      });
      await Promise.resolve();
      await Promise.resolve();
      callbacks[0]?.();
      callbacks[0]?.();
      expect(extendLock).toHaveBeenCalledTimes(1);

      resolveRefresh?.({
        key: 'lock:serialized',
        token: 'token-refreshed',
        expiresAt: Date.now() + 1800,
        isLocal: false,
      });
      await Promise.resolve();
      await Promise.resolve();
      resolveHandler?.();
      await runPromise;
      expect(releaseLock).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'token-refreshed' })
      );
      setTimeoutSpy.mockRestore();
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
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
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
      expect(mockHardTerminate).toHaveBeenCalledOnce();

      setTimeoutSpy.mockRestore();
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
      const setTimeoutSpy = vi.spyOn(global, 'setTimeout').mockImplementation((cb: any) => {
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
      expect(mockHardTerminate).toHaveBeenCalledOnce();

      setTimeoutSpy.mockRestore();
    });
};
