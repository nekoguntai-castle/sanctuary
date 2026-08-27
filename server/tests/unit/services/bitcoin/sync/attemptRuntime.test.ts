import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  abortableSyncDelay,
  createSyncStageRuntime,
  isSyncStageBudgetError,
  mapWithSyncConcurrency,
  SyncRemoteStageBudgetError,
  throwIfAttemptAborted,
} from '../../../../../src/services/bitcoin/sync/attemptRuntime';

afterEach(() => {
  vi.useRealTimers();
});

describe('wallet sync attempt runtime', () => {
  it('caps a stage at the remaining attempt deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const controller = new AbortController();
    const stage = createSyncStageRuntime(
      { signal: controller.signal, deadlineAt: 2_000 },
      'history',
      5_000,
    );

    expect(stage.deadlineAt).toBe(2_000);
    stage.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is already aborted when no attempt time remains', () => {
    const controller = new AbortController();
    const stage = createSyncStageRuntime(
      { signal: controller.signal, deadlineAt: 1_000 },
      'transactions',
      5_000,
      1_000,
    );

    expect(() => stage.signal.throwIfAborted()).toThrow(SyncRemoteStageBudgetError);
    controller.abort(new Error('later parent abort'));
    expect(stage.signal.reason).toBeInstanceOf(SyncRemoteStageBudgetError);
    stage.dispose();
  });

  it('provides a stable reason for legacy cancellation signals without one', () => {
    let abortListener!: () => void;
    const signal = {
      aborted: false,
      reason: undefined,
      throwIfAborted: () => undefined,
      addEventListener: (_event: string, listener: () => void) => { abortListener = listener; },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const stage = createSyncStageRuntime(
      { signal, deadlineAt: Date.now() + 1_000 },
      'legacy_parent',
    );

    abortListener();

    expect(stage.signal.reason).toMatchObject({ message: 'Wallet sync cancelled' });
    stage.dispose();
  });

  it('propagates parent cancellation with the original reason', () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('lease ownership lost');
    const stage = createSyncStageRuntime(
      { signal: controller.signal, deadlineAt: Date.now() + 5_000 },
      'utxos',
    );

    controller.abort(reason);
    vi.advanceTimersByTime(5_000);

    expect(stage.signal.reason).toBe(reason);
    stage.dispose();
  });

  it('recognizes only stage budget errors', () => {
    expect(isSyncStageBudgetError(new SyncRemoteStageBudgetError('history'))).toBe(true);
    expect(isSyncStageBudgetError(new Error('history'))).toBe(false);
  });

  it('bounds fallback concurrency', async () => {
    let active = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    const work = mapWithSyncConcurrency([1, 2, 3, 4, 5, 6], 2, undefined, async value => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return value;
    });

    await vi.waitFor(() => expect(releases).toHaveLength(2));
    while (releases.length > 0) {
      releases.shift()!();
      await Promise.resolve();
    }

    await expect(work).resolves.toEqual([1, 2, 3, 4, 5, 6]);
    expect(peak).toBe(2);
  });

  it('completes a bounded delay and removes its cancellation listener', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const delayed = abortableSyncDelay(100, {
      signal: controller.signal,
      deadlineAt: Date.now() + 1_000,
    });

    await vi.advanceTimersByTimeAsync(100);

    await expect(delayed).resolves.toBeUndefined();
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('rejects a bounded delay with its cancellation reason', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error('attempt cancelled');
    const delayed = abortableSyncDelay(1_000, {
      signal: controller.signal,
      deadlineAt: Date.now() + 1_000,
    });

    controller.abort(reason);

    await expect(delayed).rejects.toBe(reason);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects immediately when the attempt is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const runtime = { signal: controller.signal, deadlineAt: Date.now() + 1_000 };

    expect(() => throwIfAttemptAborted(runtime)).toThrow();
    await expect(abortableSyncDelay(100, runtime)).rejects.toBe(controller.signal.reason);
  });
});
