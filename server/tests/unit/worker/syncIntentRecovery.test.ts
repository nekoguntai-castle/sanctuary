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
    enqueueReservedFullResyncWakeup: vi.fn().mockResolvedValue({ status: 'enqueued' }),
    recoverIncrementalSync: vi.fn().mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      unavailable: 0,
    }),
    recoverExpiredIncrementalSync: vi.fn().mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      locked: 0,
      unavailable: 0,
    }),
    authorize: vi.fn().mockResolvedValue(true),
    now: () => NOW,
    ...overrides,
  };
}

describe('syncIntentRecovery', () => {
  it('fails closed with zero work when recovery is unauthorized', async () => {
    const deps = dependencies({
      authorize: vi.fn().mockResolvedValue(false),
      observe: vi.fn(),
    });
    const coordinator = createSyncIntentRecoveryCoordinator(deps);

    await expect(coordinator.runNow()).resolves.toEqual({
      fullResync: { scanned: 0, enqueued: 0, unavailable: 0 },
      incremental: { scanned: 0, enqueued: 0, unavailable: 0 },
      expiredIncremental: {
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
      },
      errors: [],
    });

    expect(deps.authorize).toHaveBeenCalledOnce();
    expect(deps.findStrandedFullResyncWalletsPage).not.toHaveBeenCalled();
    expect(deps.enqueueReservedFullResyncWakeup).not.toHaveBeenCalled();
    expect(deps.recoverIncrementalSync).not.toHaveBeenCalled();
    expect(deps.recoverExpiredIncrementalSync).not.toHaveBeenCalled();
    expect(deps.observe).not.toHaveBeenCalled();
  });

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
        return { status: 'enqueued' as const };
      }),
      recoverIncrementalSync: vi.fn(async () => {
        order.push('incremental');
        return { scanned: 0, enqueued: 0, unavailable: 0 };
      }),
      recoverExpiredIncrementalSync: vi.fn(async () => {
        order.push('expired-incremental');
        return { scanned: 0, enqueued: 0, locked: 0, unavailable: 0 };
      }),
    });
    const coordinator = createSyncIntentRecoveryCoordinator(deps);

    expect(deps.findStrandedFullResyncWalletsPage).not.toHaveBeenCalled();
    await expect(coordinator.runNow()).resolves.toEqual({
      fullResync: { scanned: 1, enqueued: 1, unavailable: 0 },
      incremental: { scanned: 0, enqueued: 0, unavailable: 0 },
      expiredIncremental: {
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
      },
      errors: [],
    });
    expect(order).toEqual(['find-full', 'enqueue-full', 'incremental', 'expired-incremental']);
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

  it('fairly advances and wraps the expired incremental composite cursor', async () => {
    const firstCursor = {
      leaseExpiresAt: new Date('2026-08-22T11:01:00.000Z'),
      walletId: 'wallet-2',
    };
    const unavailableCursor = {
      leaseExpiresAt: new Date('2026-08-22T11:00:00.000Z'),
      walletId: 'wallet-1',
    };
    const lockedCursor = {
      leaseExpiresAt: new Date('2026-08-22T11:02:00.000Z'),
      walletId: 'wallet-3',
    };
    const recoverExpiredIncrementalSync = vi
      .fn()
      .mockResolvedValueOnce({
        scanned: 2,
        enqueued: 2,
        locked: 0,
        unavailable: 0,
        nextCursor: firstCursor,
      })
      .mockResolvedValueOnce({
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
      })
      .mockResolvedValueOnce({
        scanned: 1,
        enqueued: 0,
        locked: 0,
        unavailable: 1,
        nextCursor: unavailableCursor,
      })
      .mockResolvedValueOnce({
        scanned: 1,
        enqueued: 0,
        locked: 1,
        unavailable: 0,
        nextCursor: lockedCursor,
      })
      .mockResolvedValueOnce({
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
      })
      .mockResolvedValueOnce({
        scanned: 1,
        enqueued: 1,
        locked: 0,
        unavailable: 0,
        nextCursor: unavailableCursor,
      });
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({ recoverExpiredIncrementalSync }), {
      incrementalPageSize: 20,
    });

    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();
    await coordinator.runNow();

    expect(recoverExpiredIncrementalSync.mock.calls.map(([options]) => options)).toEqual([
      { now: NOW, limit: 20 },
      { now: NOW, cursor: firstCursor, limit: 20 },
      { now: NOW, limit: 20 },
      { now: NOW, cursor: unavailableCursor, limit: 20 },
      { now: NOW, cursor: lockedCursor, limit: 20 },
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
      .mockResolvedValueOnce({ status: 'unavailable' })
      .mockResolvedValue({ status: 'enqueued' });
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

  it('does not advance full-resync recovery past a mid-page activation block', async () => {
    const page = [
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
      {
        id: 'wallet-3',
        name: 'three',
        requestedFullResyncGeneration: 3,
        processedFullResyncGeneration: 0,
      },
    ];
    const findStrandedFullResyncWalletsPage = vi.fn().mockResolvedValue(page);
    const enqueueReservedFullResyncWakeup = vi.fn()
      .mockResolvedValueOnce({ status: 'enqueued' })
      .mockResolvedValue({ status: 'blocked' });
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage,
      enqueueReservedFullResyncWakeup,
    }));

    await expect(coordinator.runNow()).resolves.toMatchObject({
      fullResync: { scanned: 1, enqueued: 1, unavailable: 1 },
    });
    await coordinator.runNow();

    expect(findStrandedFullResyncWalletsPage.mock.calls).toEqual([
      [undefined],
      ['wallet-1'],
    ]);
    expect(enqueueReservedFullResyncWakeup).toHaveBeenCalledTimes(3);
  });

  it('restarts full-resync recovery from the beginning when the first row is blocked', async () => {
    const findStrandedFullResyncWalletsPage = vi.fn().mockResolvedValue([{
      id: 'wallet-1',
      name: 'one',
      requestedFullResyncGeneration: 1,
      processedFullResyncGeneration: 0,
    }]);
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage,
      enqueueReservedFullResyncWakeup: vi.fn().mockResolvedValue({ status: 'blocked' }),
    }));

    await expect(coordinator.runNow()).resolves.toMatchObject({
      fullResync: { scanned: 0, enqueued: 0, unavailable: 1 },
    });
    await coordinator.runNow();

    expect(findStrandedFullResyncWalletsPage.mock.calls).toEqual([
      [undefined],
      [undefined],
    ]);
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
    const recoverExpiredIncrementalSync = vi.fn().mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      locked: 0,
      unavailable: 0,
    });
    const deps = dependencies({
      findStrandedFullResyncWalletsPage,
      recoverExpiredIncrementalSync,
    });
    const coordinator = createSyncIntentRecoveryCoordinator(deps);

    const first = coordinator.runNow();
    const second = coordinator.runNow();
    expect(second).toBe(first);
    await Promise.resolve();
    expect(findStrandedFullResyncWalletsPage).toHaveBeenCalledOnce();
    release?.();
    await first;
    expect(deps.authorize).toHaveBeenCalledOnce();
    expect(recoverExpiredIncrementalSync).toHaveBeenCalledOnce();
  });

  it('contains phase failures so full recovery cannot suppress later phases', async () => {
    const observe = vi.fn();
    const recoverExpiredIncrementalSync = vi.fn().mockResolvedValue({
      scanned: 1,
      enqueued: 0,
      locked: 1,
      unavailable: 0,
      nextCursor: {
        leaseExpiresAt: new Date('2026-08-22T11:00:00.000Z'),
        walletId: 'wallet-expired',
      },
    });
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage: vi.fn().mockRejectedValue(new Error('database down')),
      recoverIncrementalSync: vi.fn().mockResolvedValue({
        scanned: 1,
        enqueued: 1,
        unavailable: 0,
        nextCursor: 'wallet-1',
      }),
      recoverExpiredIncrementalSync,
      observe,
    }));

    await expect(coordinator.runNow()).resolves.toEqual({
      fullResync: { scanned: 0, enqueued: 0, unavailable: 0 },
      incremental: { scanned: 1, enqueued: 1, unavailable: 0, nextCursor: 'wallet-1' },
      expiredIncremental: {
        scanned: 1,
        enqueued: 0,
        locked: 1,
        unavailable: 0,
        nextCursor: {
          leaseExpiresAt: new Date('2026-08-22T11:00:00.000Z'),
          walletId: 'wallet-expired',
        },
      },
      errors: ['full_resync'],
    });
    expect(recoverExpiredIncrementalSync).toHaveBeenCalledOnce();
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
      .mockResolvedValueOnce({ status: 'enqueued' });
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
      recoverExpiredIncrementalSync: vi.fn().mockResolvedValue({
        scanned: 2,
        enqueued: 0,
        locked: 0,
        unavailable: 2,
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
      expiredIncremental: {
        scanned: 2,
        enqueued: 0,
        locked: 0,
        unavailable: 2,
      },
      errors: [],
    });
    expect(enqueueReservedFullResyncWakeup).toHaveBeenCalledTimes(2);
    expect(observe).toHaveBeenCalledTimes(3);
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

  it('isolates expired recovery failures, resets its cursor, and observes outcomes', async () => {
    const expiredCursor = {
      leaseExpiresAt: new Date('2026-08-22T11:00:00.000Z'),
      walletId: 'wallet-expired',
    };
    const recoverExpiredIncrementalSync = vi
      .fn()
      .mockResolvedValueOnce({
        scanned: 1,
        enqueued: 0,
        locked: 0,
        unavailable: 1,
        nextCursor: expiredCursor,
      })
      .mockRejectedValueOnce(new Error('expired recovery unavailable'))
      .mockResolvedValueOnce({
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
      });
    const recoverIncrementalSync = vi.fn().mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      unavailable: 0,
    });
    const observe = vi.fn();
    const coordinator = createSyncIntentRecoveryCoordinator(
      dependencies({
        recoverIncrementalSync,
        recoverExpiredIncrementalSync,
        observe,
      }),
    );

    await coordinator.runNow();
    await expect(coordinator.runNow()).resolves.toMatchObject({
      fullResync: { scanned: 0, enqueued: 0, unavailable: 0 },
      incremental: { scanned: 0, enqueued: 0, unavailable: 0 },
      expiredIncremental: {
        scanned: 0,
        enqueued: 0,
        locked: 0,
        unavailable: 0,
      },
      errors: ['expired_incremental'],
    });
    await coordinator.runNow();

    expect(recoverExpiredIncrementalSync.mock.calls.map(([options]) => options)).toEqual([
      { now: NOW, limit: 100 },
      { now: NOW, cursor: expiredCursor, limit: 100 },
      { now: NOW, limit: 100 },
    ]);
    expect(recoverIncrementalSync).toHaveBeenCalledTimes(3);
    expect(observe.mock.calls).toEqual([
      [{ phase: 'expired_incremental', outcome: 'unavailable', count: 1 }],
      [{ phase: 'expired_incremental', outcome: 'failed', count: 1 }],
    ]);
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
    const recoverExpiredIncrementalSync = vi.fn().mockResolvedValue({
      scanned: 0,
      enqueued: 0,
      locked: 0,
      unavailable: 0,
    });
    const coordinator = createSyncIntentRecoveryCoordinator(dependencies({
      findStrandedFullResyncWalletsPage,
      recoverExpiredIncrementalSync,
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
    expect(recoverExpiredIncrementalSync).toHaveBeenCalledOnce();
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
