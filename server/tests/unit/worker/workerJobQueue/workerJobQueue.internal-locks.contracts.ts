import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acquireLock,
  capturedLogs,
  extendLock,
  mockHardTerminate,
  releaseLock,
  type WorkerJobQueueAccessor,
} from './workerJobQueueTestHarness';
import { processJobWithLock } from '../../../../src/worker/workerJobQueue/jobProcessor';
import { hasSupportedSyncJobContractVersion } from '../../../../src/jobs/syncJobContract';
import { registerWorkerJobQueueInternalLockConfigContracts } from './workerJobQueue.internal-lock-config.contracts';

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

    it('rejects unsupported sync versions before lock acquisition or contention effects', async () => {
      const handler = vi.fn();
      const onLockRetryBudgetExhausted = vi.fn();
      const moveToDelayed = vi.fn();
      const registered = {
        handler,
        validateData: hasSupportedSyncJobContractVersion,
        lockOptions: {
          lockKey: () => 'sync:wallet:future',
          retryDelayMsIfUnavailable: () => 5000,
          onLockRetryBudgetExhausted,
        },
      };
      const job = {
        id: 'future-sync-job',
        data: { version: 2, walletId: 'future' },
        timestamp: 0,
        moveToDelayed,
      };

      await expect(processJobWithLock('sync:sync-wallet', registered, job as any))
        .rejects.toMatchObject({
          name: 'UnrecoverableError',
          message: 'Unrecoverable job payload: invalid payload for sync:sync-wallet',
        });
      expect(acquireLock).not.toHaveBeenCalled();
      expect(moveToDelayed).not.toHaveBeenCalled();
      expect(onLockRetryBudgetExhausted).not.toHaveBeenCalled();
      expect(handler).not.toHaveBeenCalled();
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
      expect(capturedLogs).toContainEqual({
        level: 'warn',
        message: 'Skipping job - lock held: sync:locked',
        meta: { jobId: 'j-3', lockKey: 'lock:wallet-1', walletId: 'wallet-1' },
      });
    });

    it('rejects retry-owned jobs when their distributed lock is held', async () => {
      vi.mocked(acquireLock).mockResolvedValueOnce(null);
      const handler = vi.fn(async () => ({ ok: true }));

      queue.registerHandler('sync', {
        name: 'retry-locked',
        queue: 'sync',
        handler,
        lockOptions: {
          lockKey: (data) => `lock:${(data as any).walletId}`,
          retryDelayMsIfUnavailable: (data) => (data as any).fullResync === true ? 5000 : null,
        },
      });

      const moveToDelayed = vi.fn().mockResolvedValue(undefined);
      const updateData = vi.fn().mockResolvedValue(undefined);
      const job = {
        id: 'retry-locked-job',
        name: 'retry-locked',
        data: { walletId: 'wallet-1', fullResync: true },
        token: 'worker-token',
        timestamp: Date.now(),
        moveToDelayed,
        updateData,
      };
      await expect((queue as any).processJob('sync', job))
        .rejects.toHaveProperty('name', 'DelayedError');
      expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'worker-token');
      expect(handler).not.toHaveBeenCalled();
      // The budget is read from the job's own enqueue time, so nothing has to be
      // written back into the payload to make it survive the DelayedError.
      expect(updateData).not.toHaveBeenCalled();
    });

    it('fails a lock-contended retry job once its re-delay budget is exhausted', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      const handler = vi.fn(async () => ({ ok: true }));
      const registered = {
        handler,
        lockOptions: {
          lockKey: () => 'lock:wallet-budget',
          lockTtlMs: 20_000,
          retryDelayMsIfUnavailable: () => 5_000,
        },
      };
      const job: any = {
        id: 'budget-job',
        data: { walletId: 'wallet-budget', fullResync: true },
        token: 'worker-token',
        timestamp: Date.now(),
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn().mockResolvedValue(undefined),
      };

      // Inside the window it keeps re-delaying, however many times it bounces.
      await expect(processJobWithLock('sync:budget', registered as any, job))
        .rejects.toHaveProperty('name', 'DelayedError');
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1);

      // Once the wallet has been contended for the whole window, the job must
      // fail normally so BullMQ finalizes it and releases its dedup key.
      job.timestamp = Date.now() - 20_001;
      await expect(processJobWithLock('sync:budget', registered as any, job))
        .rejects.toHaveProperty('name', 'LockRetryBudgetExhaustedError');
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
      expect(handler).not.toHaveBeenCalled();
      expect(capturedLogs).toContainEqual(expect.objectContaining({
        level: 'error',
        meta: expect.objectContaining({
          lockKey: 'lock:wallet-budget',
          walletId: 'wallet-budget',
        }),
      }));
    });

    it('gives a BullMQ attempt retry its own full re-delay window', async () => {
      // A payload counter was never reset once the lock was finally acquired, so
      // attempt 2 of 3 began with a spent budget and gave up on first contention.
      vi.mocked(acquireLock).mockResolvedValue(null);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:wallet-reattempt',
          lockTtlMs: 20_000,
          retryDelayMsIfUnavailable: () => 5_000,
        },
      };
      const job: any = {
        id: 'reattempt-job',
        data: { walletId: 'wallet-reattempt' },
        token: 'worker-token',
        timestamp: Date.now(),
        attemptsMade: 2,
        opts: { attempts: 3 },
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn().mockResolvedValue(undefined),
      };

      await expect(processJobWithLock('sync:reattempt', registered as any, job))
        .rejects.toHaveProperty('name', 'DelayedError');
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    });

    it('accepts a retry window computed from the job data', async () => {
      // Different work needs different patience: a full resync should wait out a
      // whole sync, an ordinary one must give up before the next stale sweep.
      vi.mocked(acquireLock).mockResolvedValue(null);
      const onLockRetryBudgetExhausted = vi.fn().mockResolvedValue(undefined);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:wallet-fn-window',
          lockTtlMs: 5_000,
          maxLockRetryWindowMs: (data: any) => (data.fullResync === true ? 60_000 : 1_000),
          retryDelayMsIfUnavailable: () => 5_000,
          onLockRetryBudgetExhausted,
        },
      };
      const job: any = {
        id: 'fn-window-job',
        data: { walletId: 'wallet-fn-window' },
        token: 'worker-token',
        timestamp: Date.now() - 1_001,
        attemptsMade: 0,
        opts: { attempts: 3 },
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn().mockResolvedValue(undefined),
      };

      // 1001ms waited against the ordinary 1000ms window: budget exhausted.
      await expect(processJobWithLock('sync:fn-window', registered as any, job))
        .rejects.toHaveProperty('name', 'LockRetryBudgetExhaustedError');
      expect(onLockRetryBudgetExhausted).toHaveBeenCalledWith(
        job.data,
        expect.objectContaining({ retryWindowMs: 1_000 }),
      );
    });

    it('lets the handler record the terminal outcome when the budget runs out', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      const onLockRetryBudgetExhausted = vi.fn().mockResolvedValue(undefined);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:wallet-record',
          lockTtlMs: 5_000,
          maxLockRetryWindowMs: 5_000,
          retryDelayMsIfUnavailable: () => 5_000,
          onLockRetryBudgetExhausted,
        },
      };
      const job: any = {
        id: 'record-job',
        data: { walletId: 'wallet-record' },
        token: 'worker-token',
        timestamp: Date.now() - 5_001,
        attemptsMade: 0,
        opts: { attempts: 3 },
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn().mockResolvedValue(undefined),
      };

      await expect(processJobWithLock('sync:record', registered as any, job))
        .rejects.toHaveProperty('name', 'LockRetryBudgetExhaustedError');

      // retriesExhausted must reflect the real attempt state: giving up here
      // still burns only one of three BullMQ attempts.
      expect(onLockRetryBudgetExhausted).toHaveBeenCalledWith(
        { walletId: 'wallet-record' },
        {
          lockKey: 'lock:wallet-record',
          retryWindowMs: 5_000,
          message: expect.stringContaining('lock:wallet-record'),
          isFinalAttempt: false,
        },
      );
    });

    it('tells the handler when the give-up is the final attempt', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      const onLockRetryBudgetExhausted = vi.fn().mockResolvedValue(undefined);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:wallet-final',
          lockTtlMs: 5_000,
          retryDelayMsIfUnavailable: () => 5_000,
          onLockRetryBudgetExhausted,
        },
      };
      const job: any = {
        id: 'final-job',
        data: { walletId: 'wallet-final' },
        token: 'worker-token',
        timestamp: Date.now() - 5_001,
        attemptsMade: 2,
        opts: { attempts: 3 },
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn().mockResolvedValue(undefined),
      };

      await expect(processJobWithLock('sync:final', registered as any, job))
        .rejects.toHaveProperty('name', 'LockRetryBudgetExhaustedError');
      expect(onLockRetryBudgetExhausted).toHaveBeenCalledWith(
        { walletId: 'wallet-final' },
        expect.objectContaining({ isFinalAttempt: true }),
      );
    });

    it('still fails the job when recording the terminal outcome throws', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:wallet-record-fails',
          lockTtlMs: 5_000,
          maxLockRetryWindowMs: 1,
          retryDelayMsIfUnavailable: () => 5_000,
          onLockRetryBudgetExhausted: vi.fn().mockRejectedValue(new Error('database down')),
        },
      };
      const job: any = {
        id: 'record-fails-job',
        data: { walletId: 'wallet-record-fails' },
        token: 'worker-token',
        timestamp: Date.now() - 1_000,
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn(),
      };

      // The give-up is what releases the deduplication key. A bookkeeping
      // failure must not turn it back into an unbounded re-delay.
      await expect(processJobWithLock('sync:record-fails', registered as any, job))
        .rejects.toHaveProperty('name', 'LockRetryBudgetExhaustedError');
      expect(capturedLogs).toContainEqual(expect.objectContaining({
        level: 'error',
        message: expect.stringContaining('Failed to record lock retry budget exhaustion'),
      }));
    });

    it('honours an explicit re-delay window over the lock TTL', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:wallet-window',
          lockTtlMs: 600_000,
          maxLockRetryWindowMs: 5_000,
          retryDelayMsIfUnavailable: () => 5_000,
        },
      };
      const job: any = {
        id: 'window-job',
        data: { walletId: 'wallet-window' },
        token: 'worker-token',
        timestamp: Date.now(),
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
        updateData: vi.fn().mockResolvedValue(undefined),
      };

      await expect(processJobWithLock('sync:window', registered as any, job))
        .rejects.toHaveProperty('name', 'DelayedError');

      // Past the explicit 5s window but far inside the 600s lock TTL.
      job.timestamp = Date.now() - 5_001;
      await expect(processJobWithLock('sync:window', registered as any, job))
        .rejects.toThrow('lock:wallet-window');
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    });

    it('re-delays a job whose payload names no wallet', async () => {
      // Lock scoping is a handler convention, not a queue guarantee; a payload
      // without a walletId must still get its re-delay rather than crash.
      vi.mocked(acquireLock).mockResolvedValue(null);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:anonymous',
          lockTtlMs: 20_000,
          retryDelayMsIfUnavailable: () => 5_000,
        },
      };
      const job: any = {
        id: 'anonymous-job',
        data: { reason: 'manual' },
        token: 'worker-token',
        timestamp: Date.now(),
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
      };

      await expect(processJobWithLock('sync:anonymous', registered as any, job))
        .rejects.toHaveProperty('name', 'DelayedError');
      expect(job.moveToDelayed).toHaveBeenCalledTimes(1);
    });

    it('treats a job with no declared attempts as single-shot', async () => {
      vi.mocked(acquireLock).mockResolvedValue(null);
      const onLockRetryBudgetExhausted = vi.fn().mockResolvedValue(undefined);
      const registered = {
        handler: vi.fn(async () => ({ ok: true })),
        lockOptions: {
          lockKey: () => 'lock:no-attempts',
          lockTtlMs: 5_000,
          retryDelayMsIfUnavailable: () => 5_000,
          onLockRetryBudgetExhausted,
        },
      };
      const job: any = {
        id: 'no-attempts-job',
        data: 'not-a-record',
        token: 'worker-token',
        timestamp: Date.now() - 5_001,
        attemptsMade: 0,
        opts: {},
        moveToDelayed: vi.fn().mockResolvedValue(undefined),
      };

      await expect(processJobWithLock('sync:no-attempts', registered as any, job))
        .rejects.toHaveProperty('name', 'LockRetryBudgetExhaustedError');
      expect(onLockRetryBudgetExhausted).toHaveBeenCalledWith(
        'not-a-record',
        expect.objectContaining({ isFinalAttempt: true }),
      );
    });

    it('rejects without running the handler when lock authority is unavailable', async () => {
      const authorityError = new Error('lock authority unavailable');
      const handler = vi.fn(async () => ({ ok: true }));
      vi.mocked(acquireLock).mockRejectedValueOnce(authorityError);

      queue.registerHandler('sync', {
        name: 'authority-unavailable',
        queue: 'sync',
        handler,
        lockOptions: {
          lockKey: () => 'lock:authority-unavailable',
          lockTtlMs: 1500,
        },
      });

      await expect(
        (queue as any).processJob('sync', {
          id: 'authority-job',
          name: 'authority-unavailable',
          data: {},
        }),
      ).rejects.toBe(authorityError);

      expect(handler).not.toHaveBeenCalled();
      expect(vi.mocked(releaseLock)).not.toHaveBeenCalled();
      expect(mockHardTerminate).not.toHaveBeenCalled();
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

    registerWorkerJobQueueInternalLockConfigContracts(getQueue);

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
