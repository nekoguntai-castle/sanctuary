import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  IncrementalSyncLifecycleState,
  WalletSyncStatePatch,
} from '../../../../src/repositories/types';
import {
  clearActiveSyncAttempt,
  persistSyncStateWithRetry,
  recordSyncFailure,
  recordSyncLockContention,
  recordSyncRetry,
  recordSyncSuccess,
  runSyncAttemptWithTimeout,
  runSettledSyncAttemptWithTimeout,
  startSyncAttempt,
  type SyncAttemptWriter,
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

function createWriter(
  state: IncrementalSyncLifecycleState = persistedState,
): SyncAttemptWriter {
  return {
    updateSyncState: vi.fn().mockResolvedValue(state),
    completeSyncSuccess: vi.fn().mockResolvedValue(state),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('sync attempt lifecycle', () => {
  it.each(['inline', 'worker'] as const)(
    'starts a %s-owned attempt with the canonical active state',
    async (owner) => {
      const writer = createWriter();
      const startedAt = new Date('2026-08-20T12:00:00.000Z');

      await expect(startSyncAttempt(
        'wallet-1',
        { owner, retryCount: 2, startedAt },
        writer,
      )).resolves.toEqual({
        walletId: 'wallet-1',
        transition: 'started',
        state: persistedState,
      });

      expect(writer.updateSyncState).toHaveBeenCalledWith('wallet-1', {
        syncInProgress: true,
        lastSyncStatus: 'syncing',
        syncExecutionOwner: owner,
        syncRetryCount: 2,
        syncNextRetryAt: null,
        syncStartedAt: startedAt,
      });
    },
  );

  it.each(['failed', 'retrying'])(
    'replaces a prior %s status when a new attempt starts',
    async (lastSyncStatus) => {
      const writer = createWriter({ ...persistedState, lastSyncStatus });
      vi.mocked(writer.updateSyncState).mockImplementationOnce(async (_walletId, patch) => ({
        ...persistedState,
        lastSyncStatus,
        ...patch,
      }));

      await expect(startSyncAttempt(
        'wallet-1',
        {
          owner: 'inline',
          retryCount: 0,
          startedAt: new Date('2026-08-20T12:00:00.000Z'),
        },
        writer,
      )).resolves.toMatchObject({
        transition: 'started',
        state: { lastSyncStatus: 'syncing' },
      });

      expect(writer.updateSyncState).toHaveBeenCalledWith(
        'wallet-1',
        expect.objectContaining({ lastSyncStatus: 'syncing' }),
      );
    },
  );

  it('surfaces a start-state persistence failure', async () => {
    const writer = createWriter();
    const persistenceError = new Error('database unavailable');
    vi.mocked(writer.updateSyncState).mockRejectedValueOnce(persistenceError);

    await expect(
      startSyncAttempt(
        'wallet-1',
        {
          owner: 'inline',
          retryCount: 0,
          startedAt: new Date('2026-08-20T12:00:00.000Z'),
        },
        writer,
      ),
    ).rejects.toBe(persistenceError);
  });

  it('rejects a persisted snapshot with an unknown execution owner', async () => {
    const writer = createWriter();
    vi.mocked(writer.updateSyncState).mockResolvedValueOnce({
      ...persistedState,
      syncExecutionOwner: 'legacy-owner',
    } as never);

    await expect(startSyncAttempt(
      'wallet-1',
      {
        owner: 'inline',
        retryCount: 0,
        startedAt: new Date('2026-08-20T12:00:00.000Z'),
      },
      writer,
    )).rejects.toThrow('Invalid persisted sync execution owner: legacy-owner');
  });

  it('records inline success without inventing a block height', async () => {
    const writer = createWriter();
    const syncedAt = new Date('2026-08-20T12:01:00.000Z');

    await expect(recordSyncSuccess('wallet-1', { syncedAt }, writer)).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'succeeded',
      state: persistedState,
    });

    expect(writer.completeSyncSuccess).not.toHaveBeenCalled();
    expect(writer.updateSyncState).toHaveBeenCalledWith('wallet-1', {
      lastSyncedAt: syncedAt,
      lastSyncStatus: 'success',
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncInProgress: false,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    });
  });

  it('dispatches worker success through the atomic block-height writer', async () => {
    const writer = createWriter();
    const syncedAt = new Date('2026-08-20T12:01:00.000Z');

    await expect(recordSyncSuccess(
      'wallet-1',
      { syncedAt, lastSyncedBlockHeight: 900_000 },
      writer,
    )).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'succeeded',
      state: persistedState,
    });

    expect(writer.completeSyncSuccess).toHaveBeenCalledWith(
      'wallet-1',
      syncedAt,
      900_000,
    );
    expect(writer.updateSyncState).not.toHaveBeenCalled();
  });

  it('surfaces a success-state persistence failure', async () => {
    const writer = createWriter();
    const persistenceError = new Error('database unavailable');
    vi.mocked(writer.completeSyncSuccess).mockRejectedValueOnce(persistenceError);

    await expect(
      recordSyncSuccess(
        'wallet-1',
        {
          syncedAt: new Date('2026-08-20T12:01:00.000Z'),
          lastSyncedBlockHeight: 0,
        },
        writer,
      ),
    ).rejects.toBe(persistenceError);
  });

  it('rejects a persisted snapshot with an unknown failure class', async () => {
    const writer = createWriter();
    vi.mocked(writer.updateSyncState).mockResolvedValueOnce({
      ...persistedState,
      lastSyncFailureClass: 'legacy-failure',
    } as never);

    await expect(recordSyncSuccess(
      'wallet-1',
      { syncedAt: new Date('2026-08-20T12:01:00.000Z') },
      writer,
    )).rejects.toThrow('Invalid persisted sync failure class: legacy-failure');
  });

  it.each(['inline', 'worker'] as const)(
    'records a clean classified retry for the %s adapter',
    async (owner) => {
      const writer = createWriter();
      const persist = vi.fn().mockResolvedValue(persistedState);
      const nextRetryAt = new Date('2026-08-20T12:02:00.000Z');

      await expect(
        recordSyncRetry(
          'wallet-1',
          {
            owner,
            retryCount: 1,
            nextRetryAt,
            error: new Error('Electrum connection refused'),
          },
          writer,
          persist,
        ),
      ).resolves.toEqual({
        walletId: 'wallet-1',
        transition: 'retrying',
        state: persistedState,
      });

      expect(persist).toHaveBeenCalledWith(
        'wallet-1',
        {
          lastSyncStatus: 'retrying',
          lastSyncError: 'Electrum connection refused',
          lastSyncFailureClass: 'electrum_unavailable',
          syncInProgress: false,
          syncExecutionOwner: owner,
          syncRetryCount: 1,
          syncNextRetryAt: nextRetryAt,
          syncStartedAt: null,
        },
        writer,
      );
    },
  );

  it.each([
    ['request timed out', 'timeout'],
    ['This operation was aborted', 'sync_cancelled'],
  ] as const)(
    'records terminal %s failures with class %s',
    async (message, failureClass) => {
      const writer = createWriter();
      const persist = vi.fn().mockResolvedValue(persistedState);

      await expect(
        recordSyncFailure('wallet-1', { error: new Error(message) }, writer, persist),
      ).resolves.toEqual({
        walletId: 'wallet-1',
        transition: 'failed',
        state: persistedState,
      });

      expect(persist).toHaveBeenCalledWith(
        'wallet-1',
        {
          lastSyncStatus: 'failed',
          lastSyncError: message,
          lastSyncFailureClass: failureClass,
          syncInProgress: false,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
        },
        writer,
      );
    },
  );

  it('uses bounded persistence by default for retry and failure state', async () => {
    const writer = createWriter();
    const nextRetryAt = new Date('2026-08-20T12:02:00.000Z');

    await expect(
      recordSyncRetry(
        'wallet-1',
        {
          owner: 'inline',
          retryCount: 1,
          nextRetryAt,
          error: 'temporary failure',
        },
        writer,
      ),
    ).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'retrying',
      state: persistedState,
    });
    await expect(
      recordSyncFailure('wallet-1', { error: 'terminal failure' }, writer),
    ).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'failed',
      state: persistedState,
    });

    expect(writer.updateSyncState).toHaveBeenCalledTimes(2);
  });

  it('returns null when injected retry persistence is exhausted', async () => {
    const writer = createWriter();
    const persist = vi.fn().mockResolvedValue(null);

    await expect(recordSyncRetry(
      'wallet-1',
      {
        owner: 'worker',
        retryCount: 3,
        nextRetryAt: new Date('2026-08-20T12:03:00.000Z'),
        error: 'still unavailable',
      },
      writer,
      persist,
    )).resolves.toBeNull();
  });

  it('clears an abandoned active attempt without leaving a syncing status', async () => {
    const writer = createWriter();

    await expect(clearActiveSyncAttempt('wallet-1', writer)).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'cleared',
      state: persistedState,
    });

    expect(writer.updateSyncState).toHaveBeenCalledWith('wallet-1', {
      syncInProgress: false,
      lastSyncStatus: null,
      lastSyncError: null,
      lastSyncFailureClass: null,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    });
  });
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

  it('records only final lock-contention exhaustion without clearing another holder flag', async () => {
    const writer = createWriter();
    const persist = vi.fn().mockResolvedValue(persistedState);

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: false },
      writer,
      persist,
    )).resolves.toBeNull();
    expect(persist).not.toHaveBeenCalled();

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: true },
      writer,
      persist,
    )).resolves.toEqual({
      walletId: 'wallet-1',
      transition: 'failed',
      state: persistedState,
    });
    expect(persist).toHaveBeenCalledWith('wallet-1', {
      lastSyncStatus: 'failed',
      lastSyncError: 'lock budget exhausted',
      lastSyncFailureClass: 'lock_contention',
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    }, writer);
    expect(vi.mocked(persist).mock.calls[0]?.[1]).not.toHaveProperty('syncInProgress');
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

describe('persistSyncStateWithRetry', () => {
  const state: WalletSyncStatePatch = {
    lastSyncStatus: 'failed',
    lastSyncError: 'database unavailable',
  };

  it('writes once when persistence succeeds immediately', async () => {
    const writer = createWriter();

    await expect(
      persistSyncStateWithRetry('wallet-1', state, writer),
    ).resolves.toEqual(persistedState);
    expect(writer.updateSyncState).toHaveBeenCalledTimes(1);
  });

  it('recovers from transient persistence failures', async () => {
    vi.useFakeTimers();
    const writer = createWriter();
    vi.mocked(writer.updateSyncState)
      .mockRejectedValueOnce(new Error('pool unavailable'))
      .mockRejectedValueOnce(new Error('pool unavailable'))
      .mockResolvedValueOnce(persistedState);

    const pending = persistSyncStateWithRetry('wallet-1', state, writer);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(persistedState);
    expect(writer.updateSyncState).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(writer.updateSyncState).mock.calls) {
      expect(call).toEqual(['wallet-1', state]);
    }
  });

  it('does not repeat a successful write that returns an invalid snapshot', async () => {
    const writer = createWriter();
    vi.mocked(writer.updateSyncState).mockResolvedValueOnce({
      ...persistedState,
      syncExecutionOwner: 'legacy-owner',
    } as never);

    await expect(
      persistSyncStateWithRetry('wallet-1', state, writer),
    ).resolves.toBeNull();
    expect(writer.updateSyncState).toHaveBeenCalledOnce();
  });

  it('returns null after four failures without throwing', async () => {
    vi.useFakeTimers();
    const writer = createWriter();
    vi.mocked(writer.updateSyncState).mockRejectedValue(
      new Error('permanently unavailable'),
    );

    const pending = persistSyncStateWithRetry('wallet-1', state, writer);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeNull();
    expect(writer.updateSyncState).toHaveBeenCalledTimes(4);
  });
});
