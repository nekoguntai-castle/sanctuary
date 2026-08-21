import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WalletSyncStatePatch } from '../../../../src/repositories/types';
import {
  clearActiveSyncAttempt,
  persistSyncStateWithRetry,
  recordSyncFailure,
  recordSyncLockContention,
  recordSyncRetry,
  recordSyncSuccess,
  runSyncAttemptWithTimeout,
  startSyncAttempt,
  type SyncAttemptWriter,
} from '../../../../src/services/sync/syncAttemptLifecycle';

function createWriter(): SyncAttemptWriter {
  return {
    updateSyncState: vi.fn().mockResolvedValue({}),
    completeSyncSuccess: vi.fn().mockResolvedValue({}),
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

      await startSyncAttempt(
        'wallet-1',
        { owner, retryCount: 2, startedAt },
        writer,
      );

      expect(writer.updateSyncState).toHaveBeenCalledWith('wallet-1', {
        syncInProgress: true,
        syncExecutionOwner: owner,
        syncRetryCount: 2,
        syncNextRetryAt: null,
        syncStartedAt: startedAt,
      });
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

  it('records inline success without inventing a block height', async () => {
    const writer = createWriter();
    const syncedAt = new Date('2026-08-20T12:01:00.000Z');

    await recordSyncSuccess('wallet-1', { syncedAt }, writer);

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

    await recordSyncSuccess(
      'wallet-1',
      { syncedAt, lastSyncedBlockHeight: 900_000 },
      writer,
    );

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

  it.each(['inline', 'worker'] as const)(
    'records a clean classified retry for the %s adapter',
    async (owner) => {
      const writer = createWriter();
      const persist = vi.fn().mockResolvedValue(true);
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
      ).resolves.toBe(true);

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
      const persist = vi.fn().mockResolvedValue(true);

      await expect(
        recordSyncFailure('wallet-1', { error: new Error(message) }, writer, persist),
      ).resolves.toBe(true);

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
    ).resolves.toBe(true);
    await expect(
      recordSyncFailure('wallet-1', { error: 'terminal failure' }, writer),
    ).resolves.toBe(true);

    expect(writer.updateSyncState).toHaveBeenCalledTimes(2);
  });

  it('clears only active-attempt fields', async () => {
    const writer = createWriter();

    await clearActiveSyncAttempt('wallet-1', writer);

    expect(writer.updateSyncState).toHaveBeenCalledWith('wallet-1', {
      syncInProgress: false,
      syncExecutionOwner: null,
      syncRetryCount: 0,
      syncNextRetryAt: null,
      syncStartedAt: null,
    });
  });
});

describe('runSyncAttemptWithTimeout', () => {
  it('returns a completed attempt and clears its duration timer', async () => {
    vi.useFakeTimers();

    await expect(
      runSyncAttemptWithTimeout(async () => 'complete', 1_000, 100),
    ).resolves.toBe('complete');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts a timed-out attempt and preserves the timeout reason', async () => {
    vi.useFakeTimers();
    let receivedReason: unknown;
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
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts a cooperative completion during the abort grace window', async () => {
    vi.useFakeTimers();
    const pending = runSyncAttemptWithTimeout(
      (signal) =>
        new Promise((resolve) => {
          signal.addEventListener('abort', () => resolve('settled safely'));
        }),
      1_000,
      100,
    );

    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toBe('settled safely');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds the unwind of an attempt that hangs after abort', async () => {
    vi.useFakeTimers();
    let receivedReason: unknown;
    const pending = runSyncAttemptWithTimeout(
      (signal) => {
        signal.addEventListener('abort', () => {
          receivedReason = signal.reason;
        });
        return new Promise(() => undefined);
      },
      1_000,
      250,
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
    expect(vi.getTimerCount()).toBe(0);
  });

  it('forwards and preserves a parent cancellation reason', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const reason = new Error('queue is shutting down');
    const pending = runSyncAttemptWithTimeout(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      1_000,
      100,
      parent.signal,
    );
    const rejection = pending.then(
      () => undefined,
      (error: unknown) => error,
    );

    parent.abort(reason);
    await vi.runAllTimersAsync();

    expect(await rejection).toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
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
    const persist = vi.fn().mockResolvedValue(true);

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: false },
      writer,
      persist,
    )).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();

    await expect(recordSyncLockContention(
      'wallet-1',
      { error: 'lock budget exhausted', isFinalAttempt: true },
      writer,
      persist,
    )).resolves.toBe(true);
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

describe('persistSyncStateWithRetry', () => {
  const state: WalletSyncStatePatch = {
    lastSyncStatus: 'failed',
    lastSyncError: 'database unavailable',
  };

  it('writes once when persistence succeeds immediately', async () => {
    const writer = createWriter();

    await expect(
      persistSyncStateWithRetry('wallet-1', state, writer),
    ).resolves.toBe(true);
    expect(writer.updateSyncState).toHaveBeenCalledTimes(1);
  });

  it('recovers from transient persistence failures', async () => {
    vi.useFakeTimers();
    const writer = createWriter();
    vi.mocked(writer.updateSyncState)
      .mockRejectedValueOnce(new Error('pool unavailable'))
      .mockRejectedValueOnce(new Error('pool unavailable'))
      .mockResolvedValueOnce({});

    const pending = persistSyncStateWithRetry('wallet-1', state, writer);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(true);
    expect(writer.updateSyncState).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(writer.updateSyncState).mock.calls) {
      expect(call).toEqual(['wallet-1', state]);
    }
  });

  it('returns false after four failures without throwing', async () => {
    vi.useFakeTimers();
    const writer = createWriter();
    vi.mocked(writer.updateSyncState).mockRejectedValue(
      new Error('permanently unavailable'),
    );

    const pending = persistSyncStateWithRetry('wallet-1', state, writer);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(false);
    expect(writer.updateSyncState).toHaveBeenCalledTimes(4);
  });
});
