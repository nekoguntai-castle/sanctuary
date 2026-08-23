import { describe, expect, it, vi } from 'vitest';
import {
  createSyncIntentRecoveryCoordinator,
  type SyncIntentRecoveryDependencies,
} from '../../../src/worker/syncIntentRecovery';

const NOW = new Date('2026-08-22T12:00:00.000Z');

function dependencies(
  overrides: Partial<SyncIntentRecoveryDependencies> = {},
): SyncIntentRecoveryDependencies {
  return {
    findStrandedFullResyncWalletsPage: vi.fn().mockResolvedValue([]),
    enqueueReservedFullResyncWakeup: vi.fn().mockResolvedValue(true),
    recoverIncrementalSync: vi.fn().mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      unavailable: 0,
    }),
    now: () => NOW,
    ...overrides,
  };
}

describe('syncIntentRecovery', () => {
  it('is dormant until called and repairs exact full generations before incremental work', async () => {
    const order: string[] = [];
    const deps = dependencies({
      findStrandedFullResyncWalletsPage: vi.fn(async () => {
        order.push('find-full');
        return [{
          id: 'wallet-1',
          name: 'wallet',
          requestedFullResyncGeneration: 7,
          processedFullResyncGeneration: 4,
        }];
      }),
      enqueueReservedFullResyncWakeup: vi.fn(async () => {
        order.push('enqueue-full');
        return true;
      }),
      recoverIncrementalSync: vi.fn(async () => {
        order.push('incremental');
        return { scanned: 0, enqueued: 0, unavailable: 0 };
      }),
    });
    const coordinator = createSyncIntentRecoveryCoordinator(deps);

    expect(deps.findStrandedFullResyncWalletsPage).not.toHaveBeenCalled();
    await expect(coordinator.runNow()).resolves.toEqual({
      fullResync: { scanned: 1, enqueued: 1, unavailable: 0 },
      incremental: { scanned: 0, enqueued: 0, unavailable: 0 },
      errors: [],
    });
    expect(order).toEqual(['find-full', 'enqueue-full', 'incremental']);
    expect(deps.enqueueReservedFullResyncWakeup).toHaveBeenCalledWith({
      walletId: 'wallet-1',
      generation: 7,
      reason: 'reconcile-stranded-full-resync',
    });
  });

  it('advances past unavailable rows and revisits them after the bounded cursor wraps', async () => {
    const recoverIncrementalSync = vi.fn()
      .mockResolvedValueOnce({ scanned: 2, enqueued: 2, unavailable: 0, nextCursor: 'wallet-2' })
      .mockResolvedValueOnce({ scanned: 0, enqueued: 0, unavailable: 0 })
      .mockResolvedValueOnce({ scanned: 1, enqueued: 0, unavailable: 1, nextCursor: 'wallet-1' })
      .mockResolvedValueOnce({ scanned: 1, enqueued: 1, unavailable: 0, nextCursor: 'wallet-3' })
      .mockResolvedValueOnce({ scanned: 0, enqueued: 0, unavailable: 0 })
      .mockResolvedValueOnce({ scanned: 1, enqueued: 1, unavailable: 0, nextCursor: 'wallet-1' });
    const coordinator = createSyncIntentRecoveryCoordinator(
      dependencies({ recoverIncrementalSync }),
      { incrementalPageSize: 20 },
    );

    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();

    expect(recoverIncrementalSync.mock.calls.map(([options]) => options)).toEqual([
      { now: NOW, limit: 20 },
      { now: NOW, cursor: 'wallet-2', limit: 20 },
      { now: NOW, limit: 20 },
      { now: NOW, cursor: 'wallet-1', limit: 20 },
      { now: NOW, cursor: 'wallet-3', limit: 20 },
      { now: NOW, limit: 20 },
    ]);
  });

  it('advances full-resync pages before wrapping to revisit unavailable wallets', async () => {
    const findStrandedFullResyncWalletsPage = vi.fn()
      .mockResolvedValueOnce([{
        id: 'wallet-1',
        name: 'one',
        requestedFullResyncGeneration: 1,
        processedFullResyncGeneration: 0,
      }])
      .mockResolvedValueOnce([{
        id: 'wallet-2',
        name: 'two',
        requestedFullResyncGeneration: 2,
        processedFullResyncGeneration: 0,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{
        id: 'wallet-1',
        name: 'one',
        requestedFullResyncGeneration: 1,
        processedFullResyncGeneration: 0,
      }]);
    const enqueueReservedFullResyncWakeup = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage,
      enqueueReservedFullResyncWakeup,
    }));

    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();

    expect(findStrandedFullResyncWalletsPage.mock.calls).toEqual([
      [undefined],
      ['wallet-1'],
      ['wallet-2'],
      [undefined],
    ]);
    expect(enqueueReservedFullResyncWakeup).toHaveBeenCalledTimes(3);
  });

  it('coalesces overlapping passes into one single-flight promise', async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const findStrandedFullResyncWalletsPage = vi.fn(async () => {
      await blocked;
      return [];
    });
    const coordinator = createSyncIntentRecoveryCoordinator(
      dependencies({ findStrandedFullResyncWalletsPage }),
    );

    const first = coordinator.runNow();
    const second = coordinator.runNow();
    expect(second).toBe(first);
    expect(findStrandedFullResyncWalletsPage).toHaveBeenCalledOnce();
    release?.();
    await first;
  });

  it('contains phase failures so full recovery cannot suppress incremental recovery', async () => {
    const observe = vi.fn();
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage: vi.fn().mockRejectedValue(new Error('database down')),
      recoverIncrementalSync: vi.fn().mockResolvedValue({
        scanned: 1,
        enqueued: 1,
        unavailable: 0,
        nextCursor: 'wallet-1',
      }),
      observe,
    }));

    await expect(coordinator.runNow()).resolves.toEqual({
      fullResync: { scanned: 0, enqueued: 0, unavailable: 0 },
      incremental: { scanned: 1, enqueued: 1, unavailable: 0, nextCursor: 'wallet-1' },
      errors: ['full_resync'],
    });
    expect(observe).toHaveBeenCalledWith({
      phase: 'full_resync',
      outcome: 'failed',
      count: 1,
    });
  });

  it('contains observer and per-wallet enqueue failures while continuing the page', async () => {
    const observe = vi.fn(() => {
      throw new Error('telemetry unavailable');
    });
    const enqueueReservedFullResyncWakeup = vi.fn()
      .mockRejectedValueOnce(new Error('queue unavailable'))
      .mockResolvedValueOnce(true);
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage: vi.fn().mockResolvedValue([
        {
          id: 'wallet-1',
          name: 'one',
          requestedFullResyncGeneration: 1,
          processedFullResyncGeneration: 0,
        },
        {
          id: 'wallet-2',
          name: 'two',
          requestedFullResyncGeneration: 2,
          processedFullResyncGeneration: 0,
        },
      ]),
      enqueueReservedFullResyncWakeup,
      recoverIncrementalSync: vi.fn().mockResolvedValue({
        scanned: 1,
        enqueued: 0,
        unavailable: 1,
        nextCursor: 'wallet-3',
      }),
      observe,
    }));

    await expect(coordinator.runNow()).resolves.toEqual({
      fullResync: { scanned: 2, enqueued: 1, unavailable: 1 },
      incremental: {
        scanned: 1,
        enqueued: 0,
        unavailable: 1,
        nextCursor: 'wallet-3',
      },
      errors: [],
    });
    expect(enqueueReservedFullResyncWakeup).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(2);
  });

  it('uses the current time and resets the cursor after incremental recovery fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const recoverIncrementalSync = vi.fn()
      .mockResolvedValueOnce({
        scanned: 1,
        enqueued: 1,
        unavailable: 0,
        nextCursor: 'wallet-1',
      })
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce({ scanned: 0, enqueued: 0, unavailable: 0 });
    const observe = vi.fn();
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      recoverIncrementalSync,
      now: undefined,
      observe,
    }));

    await coordinator.runNow();
    await expect(coordinator.runNow()).resolves.toMatchObject({
      incremental: { scanned: 0, enqueued: 0, unavailable: 0 },
      errors: ['incremental'],
    });
    await coordinator.runNow();

    expect(recoverIncrementalSync.mock.calls.map(([options]) => options)).toEqual([
      { now: NOW, limit: 100 },
      { now: NOW, cursor: 'wallet-1', limit: 100 },
      { now: NOW, limit: 100 },
    ]);
    expect(observe).toHaveBeenCalledWith({
      phase: 'incremental',
      outcome: 'failed',
      count: 1,
    });
    vi.useRealTimers();
  });

  it('stops its timer and waits for an in-flight pass to settle', async () => {
    let timerCallback: (() => void) | undefined;
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setInterval = vi.fn((callback: () => void) => {
      timerCallback = callback;
      return timer;
    }) as unknown as typeof globalThis.setInterval;
    const clearInterval = vi.fn() as unknown as typeof globalThis.clearInterval;
    let release: (() => void) | undefined;
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    const findStrandedFullResyncWalletsPage = vi.fn(async () => {
      await blocked;
      return [];
    });
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage,
      setInterval,
      clearInterval,
    }), { intervalMs: 500 });

    const started = coordinator.start();
    timerCallback?.();
    const stopped = coordinator.stop();
    await Promise.resolve();
    expect(clearInterval).toHaveBeenCalledWith(timer);
    expect(findStrandedFullResyncWalletsPage).toHaveBeenCalledOnce();
    release?.();
    await Promise.all([started, stopped]);
    timerCallback?.();
    await Promise.resolve();
    expect(findStrandedFullResyncWalletsPage).toHaveBeenCalledOnce();
    await expect(coordinator.runNow()).rejects.toThrow('is stopped');
    await expect(coordinator.start()).rejects.toThrow('is stopped');
  });

  it('starts only one timer and can stop before it was started', async () => {
    const timer = { unref: vi.fn() } as unknown as NodeJS.Timeout;
    const setInterval = vi.fn(() => timer) as unknown as typeof globalThis.setInterval;
    const clearInterval = vi.fn() as unknown as typeof globalThis.clearInterval;
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      setInterval,
      clearInterval,
    }));

    await coordinator.start();
    await coordinator.start();
    expect(setInterval).toHaveBeenCalledOnce();
    await coordinator.stop();
    expect(clearInterval).toHaveBeenCalledOnce();

    const dormantClearInterval = vi.fn() as unknown as typeof globalThis.clearInterval;
    const dormant = createSyncIntentRecoveryCoordinator(dependencies({
      clearInterval: dormantClearInterval,
    }));
    await dormant.stop();
    expect(dormantClearInterval).not.toHaveBeenCalled();
  });

  it.each([
    { options: { intervalMs: 0 }, message: 'intervalMs' },
    { options: { incrementalPageSize: 1.5 }, message: 'incrementalPageSize' },
  ])('rejects invalid bounds for $message', ({ options, message }) => {
    expect(() => createSyncIntentRecoveryCoordinator(dependencies(), options))
      .toThrow(message);
  });
});
