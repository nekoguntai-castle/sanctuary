import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IncrementalSyncLifecycleState,
} from '../../../../src/repositories/types';
import {
  recordSyncLockContention,
  runSyncAttemptWithTimeout,
  runSettledSyncAttemptWithTimeout,
} from '../../../../src/services/sync/syncAttemptLifecycle';
import {
  isSyncAttemptTimeoutError,
  SyncAttemptTimeoutError,
} from '../../../../src/services/sync/syncAttemptErrors';

const persistedState: IncrementalSyncLifecycleState = {
  id: 'wallet-1',
  requestedIncrementalSyncGeneration: 1,
  claimedIncrementalSyncGeneration: 1,
  processedIncrementalSyncGeneration: 1,
  incrementalSyncLeaseToken: null,
  incrementalSyncClaimedAt: null,
  incrementalSyncLeaseExpiresAt: null,
  syncActionRequiredAt: null,
  requestedFullResyncGeneration: 0,
  preparedFullResyncGeneration: 0,
  processedFullResyncGeneration: 0,
  syncInProgress: false,
  lastSyncedAt: new Date('2026-08-20T12:01:00.000Z'),
  lastSyncedBlockHeight: 840_000,
  lastSyncStatus: 'success',
  lastSyncError: null,
  lastSyncFailureClass: null,
  syncExecutionOwner: null,
  syncRetryCount: 0,
  syncNextRetryAt: null,
  syncStartedAt: null,
  syncStateVersion: 7,
};

afterEach(() => {
  vi.useRealTimers();
});

describe('runSyncAttemptWithTimeout', () => {
  it('passes the exact attempt deadline to the execution', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    let receivedDeadline = 0;

    await runSyncAttemptWithTimeout(
      async (_signal, deadlineAt) => { receivedDeadline = deadlineAt; },
      1_000,
      100,
    );

    expect(receivedDeadline).toBe(Date.now() + 1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns a completed attempt and clears its duration timer', async () => {
    vi.useFakeTimers();

    await expect(
      runSyncAttemptWithTimeout(async () => 'complete', 1_000, 100),
    ).resolves.toBe('complete');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves an execution failure that happens before cancellation', async () => {
    vi.useFakeTimers();
    const executionError = new Error('pipeline failed');

    await expect(runSyncAttemptWithTimeout(
      async () => { throw executionError; },
      1_000,
      100,
    )).rejects.toBe(executionError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a timed-out attempt and preserves the timeout reason', async () => {
    vi.useFakeTimers();
    let receivedReason: unknown;
    const observer = {
      timeout: vi.fn(),
      aborted: vi.fn(),
      abortGraceExhausted: vi.fn(),
    };
    const pending = runSyncAttemptWithTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            receivedReason = signal.reason;
            reject(signal.reason);
          });
        }),
      1_000,
      100,
      undefined,
      observer,
    );
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(await rejection).toBe(receivedReason);
    expect(receivedReason).toMatchObject({
      message: 'Sync attempt timed out after 1000ms',
    });
    expect(observer.timeout).toHaveBeenCalledOnce();
    expect(observer.aborted).not.toHaveBeenCalled();
    expect(observer.abortGraceExhausted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a cooperative completion during the abort grace window', async () => {
    vi.useFakeTimers();
    const observer = {
      timeout: vi.fn(),
      aborted: vi.fn(),
      abortGraceExhausted: vi.fn(),
    };
    const pending = runSyncAttemptWithTimeout(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve('settled safely'));
        }),
      1_000,
      100,
      undefined,
      observer,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe('settled safely');
    expect(observer.timeout).not.toHaveBeenCalled();
    expect(observer.aborted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the unwind of an attempt that hangs after abort', async () => {
    vi.useFakeTimers();
    let receivedReason: unknown;
    const observer = {
      timeout: vi.fn(),
      aborted: vi.fn(),
      abortGraceExhausted: vi.fn(),
    };
    const pending = runSyncAttemptWithTimeout(
      (signal) => {
        signal.addEventListener('abort', () => {
          receivedReason = signal.reason;
        });
        return new Promise(() => undefined);
      },
      1_000,
      250,
      undefined,
      observer,
    );
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    await vi.advanceTimersByTimeAsync(1_250);

    expect(await rejection).toBe(receivedReason);
    expect(receivedReason).toMatchObject({
      message: 'Sync attempt timed out after 1000ms',
    });
    expect(observer.timeout).toHaveBeenCalledOnce();
    expect(observer.abortGraceExhausted).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards and preserves a parent cancellation reason', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error('queue is shutting down');
    const observer = {
      timeout: vi.fn(),
      aborted: vi.fn(),
      abortGraceExhausted: vi.fn(),
    };
    const pending = runSyncAttemptWithTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      1_000,
      100,
      parent.signal,
      observer,
    );
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    parent.abort(reason);
    await vi.runAllTimersAsync();

    expect(await rejection).toBe(reason);
    expect(observer.aborted).toHaveBeenCalledOnce();
    expect(observer.timeout).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('publishes timeout only after cancellation becomes terminal', async () => {
    vi.useFakeTimers();
    const parentSignal = {
      aborted: false,
      reason: new Error('parent cancellation did not win'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const observer = {
      timeout: vi.fn(),
      aborted: vi.fn(),
      abortGraceExhausted: vi.fn(),
    };
    const pending = runSyncAttemptWithTimeout(
      signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      100,
      50,
      parentSignal,
      observer,
    );
    const rejection = pending.catch(error => error);

    await vi.advanceTimersByTimeAsync(100);

    await expect(rejection).resolves.toBeInstanceOf(SyncAttemptTimeoutError);
    expect(observer.timeout).toHaveBeenCalledOnce();
    expect(observer.aborted).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores duplicate delivery from the same parent cancellation listener', async () => {
    vi.useFakeTimers();
    const reason = new Error('one parent cancellation');
    let parentListener!: () => void;
    const parentSignal = {
      aborted: false,
      reason,
      addEventListener: vi.fn((_event, listener) => { parentListener = listener as () => void; }),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const observer = {
      timeout: vi.fn(),
      aborted: vi.fn(),
      abortGraceExhausted: vi.fn(),
    };
    const pending = runSyncAttemptWithTimeout(
      async signal => {
        signal.throwIfAborted();
        return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      },
      1_000,
      100,
      parentSignal,
      observer,
    );
    const rejection = pending.catch(error => error);

    parentListener();
    parentListener();

    await expect(rejection).resolves.toBe(reason);
    expect(observer.aborted).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recognizes only the typed attempt timeout error', () => {
    expect(isSyncAttemptTimeoutError(new SyncAttemptTimeoutError(100))).toBe(true);
    expect(isSyncAttemptTimeoutError(new Error('Sync attempt timed out after 100ms'))).toBe(false);
  });

  it('handles a parent signal that was already aborted without a reason', async () => {
    vi.useFakeTimers();
    const parentSignal = {
      aborted: true,
      reason: undefined,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const pending = runSyncAttemptWithTimeout(
      async signal => signal.throwIfAborted(),
      1_000,
      100,
      parentSignal,
    );
    const rejection = pending.catch(error => error);

    await vi.runAllTimersAsync();

    await expect(rejection).resolves.toMatchObject({
      message: 'Sync attempt was cancelled',
    });
    expect(parentSignal.addEventListener).not.toHaveBeenCalled();
    expect(parentSignal.removeEventListener).toHaveBeenCalled();
  });

  it('records only final lock-contention exhaustion through the idle-only writer', async () => {
    const writeIfIdle = vi.fn().mockResolvedValue(persistedState);

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: false },
      writeIfIdle,
    )).resolves.toBeNull();
    expect(writeIfIdle).not.toHaveBeenCalled();

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: true },
      writeIfIdle,
    )).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'failed',
      state: persistedState,
    });
    expect(writeIfIdle).toHaveBeenCalledWith('wallet-1', 'lock budget exhausted');
  });

  it('publishes nothing when a running sync owns the row', async () => {
    const writeIfIdle = vi.fn().mockResolvedValue(null);

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: true },
      writeIfIdle,
    )).resolves.toBeNull();
    // A lost CAS is a decision, not a transient failure: no retry.
    expect(writeIfIdle).toHaveBeenCalledTimes(1);
  });

  it('ignores the duration timer after parent cancellation already won', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error('queue is shutting down');
    const pending = runSyncAttemptWithTimeout(
      () => new Promise(() => undefined),
      100,
      200,
      parent.signal,
    );
    const rejection = pending.catch(error => error);

    parent.abort(reason);
    await vi.advanceTimersByTimeAsync(300);

    await expect(rejection).resolves.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('runSettledSyncAttemptWithTimeout', () => {
  it('passes the exact attempt deadline to the execution', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-20T12:00:00.000Z'));
    let receivedDeadline = 0;

    await runSettledSyncAttemptWithTimeout(
      async (_signal, deadlineAt) => { receivedDeadline = deadlineAt; },
      1_000,
    );

    expect(receivedDeadline).toBe(Date.now() + 1_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers cancellation but waits for an uncooperative execution to settle', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error('ownership lost');
    let settle!: (value: string) => void;
    const execution = new Promise<string>((resolve) => { settle = resolve; });
    const attempt = runSettledSyncAttemptWithTimeout(
      () => execution,
      1_000,
      parent.signal,
    );
    let finished = false;
    void attempt.finally(() => { finished = true; }).catch(() => undefined);

    parent.abort(reason);
    await Promise.resolve();

    expect(finished).toBe(false);
    settle('late success');
    await expect(attempt).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('ignores duplicate parent cancellation delivery while waiting for settlement', async () => {
    vi.useFakeTimers();
    const reason = new Error('ownership epoch ended');
    let parentListener!: () => void;
    const parentSignal = {
      aborted: false,
      reason,
      addEventListener: vi.fn((_event, listener) => { parentListener = listener as () => void; }),
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    let settle!: () => void;
    const execution = new Promise<void>(resolve => { settle = resolve; });
    const attempt = runSettledSyncAttemptWithTimeout(
      () => execution,
      1_000,
      parentSignal,
    );

    parentListener();
    parentListener();
    settle();

    await expect(attempt).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('does not start execution when its parent is already cancelled', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error('former ownership epoch');
    parent.abort(reason);
    const execute = vi.fn(async () => 'must not run');

    await expect(runSettledSyncAttemptWithTimeout(
      execute,
      1_000,
      parent.signal,
    )).rejects.toBe(reason);

    expect(execute).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });

  it('times out an uncooperative execution but still waits for settlement', async () => {
    vi.useFakeTimers();
    let settle!: (value: string) => void;
    const execution = new Promise<string>(resolve => { settle = resolve; });
    const attempt = runSettledSyncAttemptWithTimeout(() => execution, 1_000);
    const rejection = attempt.catch(error => error);

    await vi.advanceTimersByTimeAsync(1_000);
    let finished = false;
    void attempt.finally(() => { finished = true; }).catch(() => undefined);
    await Promise.resolve();
    expect(finished).toBe(false);

    settle('late success');
    await expect(rejection).resolves.toMatchObject({
      message: 'Sync attempt timed out after 1000ms',
    });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe('lock-contention persistence', () => {
  const finalContention = { error: 'lock budget exhausted', isFinalAttempt: true };

  it('recovers from transient persistence failures', async () => {
    vi.useFakeTimers();
    const writeIfIdle = vi.fn()
      .mockRejectedValueOnce(new Error('pool unavailable'))
      .mockRejectedValueOnce(new Error('pool unavailable'))
      .mockResolvedValueOnce(persistedState);

    const pending = recordSyncLockContention('wallet-1', finalContention, writeIfIdle);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ transition: 'failed', state: persistedState });
    expect(writeIfIdle).toHaveBeenCalledTimes(3);
    for (const call of writeIfIdle.mock.calls) {
      expect(call).toEqual(['wallet-1', 'lock budget exhausted']);
    }
  });

  it('does not repeat a successful write that returns an invalid snapshot', async () => {
    const writeIfIdle = vi.fn().mockResolvedValueOnce({
      ...persistedState,
      syncExecutionOwner: 'legacy-owner',
    });

    await expect(
      recordSyncLockContention('wallet-1', finalContention, writeIfIdle),
    ).resolves.toBeNull();
    expect(writeIfIdle).toHaveBeenCalledOnce();
  });

  it('rejects a persisted snapshot with an unknown failure class', async () => {
    const writeIfIdle = vi.fn().mockResolvedValueOnce({
      ...persistedState,
      lastSyncFailureClass: 'legacy-class',
    });

    await expect(
      recordSyncLockContention('wallet-1', finalContention, writeIfIdle),
    ).resolves.toBeNull();
  });

  it('returns null after four failures without throwing', async () => {
    vi.useFakeTimers();
    const writeIfIdle = vi.fn().mockRejectedValue(new Error('permanently unavailable'));

    const pending = recordSyncLockContention('wallet-1', finalContention, writeIfIdle);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeNull();
    expect(writeIfIdle).toHaveBeenCalledTimes(4);
  });
});
