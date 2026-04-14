import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireLock,
  extendLock,
  releaseLock,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';

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
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
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

      setIntervalSpy.mockRestore();
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
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
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

      setIntervalSpy.mockRestore();
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
      const setIntervalSpy = vi.spyOn(global, 'setInterval').mockImplementation((cb: any) => {
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

      setIntervalSpy.mockRestore();
    });
};
