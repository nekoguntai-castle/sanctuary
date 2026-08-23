import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  activate: vi.fn(),
  inspect: vi.fn(),
  getRedisClient: vi.fn(),
  findFull: vi.fn(),
  enqueueFull: vi.fn(),
  recover: vi.fn(),
  recoverExpired: vi.fn(),
  createCoordinator: vi.fn(),
  coordinator: {
    start: vi.fn(),
    runNow: vi.fn(),
    stop: vi.fn(),
  },
}));

vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: mocks.getRedisClient,
}));
vi.mock('../../../src/repositories/resyncRepository', () => ({
  findStrandedFullResyncWalletsPage: mocks.findFull,
}));
vi.mock('../../../src/services/sync/walletSyncActivationGate', () => ({
  walletSyncActivationGate: { activate: mocks.activate, inspect: mocks.inspect },
}));
vi.mock('../../../src/services/sync/syncIntentAdmission', () => ({
  syncIntentAdmission: {
    recover: mocks.recover,
    recoverExpired: mocks.recoverExpired,
  },
}));
vi.mock('../../../src/worker/syncIntentRecovery', () => ({
  createSyncIntentRecoveryCoordinator: mocks.createCoordinator,
}));

import { createProductionWalletSyncRecoveryRuntime } from '../../../src/worker/walletSyncRecoveryRuntime';

const ACTIVE = {
  status: 'active' as const,
  requiredFloor: 1 as const,
  activatedAt: '2026-08-22T12:00:00.000Z',
};
const BLOCKED = {
  status: 'fleet_blocked' as const,
  requiredFloor: 1 as const,
  reason: 'worker_below_floor' as const,
};

describe('production walletSyncRecoveryRuntime composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.activate.mockResolvedValue(ACTIVE);
    mocks.inspect.mockResolvedValue(ACTIVE);
    mocks.enqueueFull.mockResolvedValue(true);
    mocks.recover.mockResolvedValue({ scanned: 0, enqueued: 0, unavailable: 0 });
    mocks.recoverExpired.mockResolvedValue({
      scanned: 0, enqueued: 0, locked: 0, unavailable: 0,
    });
    mocks.coordinator.start.mockResolvedValue({});
    mocks.coordinator.runNow.mockResolvedValue({});
    mocks.coordinator.stop.mockResolvedValue(undefined);
    mocks.createCoordinator.mockReturnValue(mocks.coordinator);
    mocks.getRedisClient.mockReturnValue(new EventEmitter());
  });

  it('fails closed when the shared Redis authority is absent', () => {
    mocks.getRedisClient.mockReturnValue(null);
    expect(() => createProductionWalletSyncRecoveryRuntime({
      enqueueReservedFullResyncWakeup: mocks.enqueueFull,
    }))
      .toThrow('Wallet-sync recovery requires Redis');
  });

  it('composes live-gated full, incremental, expired, startup, and shutdown boundaries', async () => {
    const runtime = createProductionWalletSyncRecoveryRuntime({
      enqueueReservedFullResyncWakeup: mocks.enqueueFull,
    });
    const dependencies = mocks.createCoordinator.mock.calls[0]?.[0];
    const fullWakeup = { walletId: 'wallet-1', generation: 7 };
    const incrementalOptions = { now: new Date('2026-08-22T12:00:00.000Z') };

    await expect(dependencies.authorize()).resolves.toBe(true);
    mocks.inspect.mockResolvedValueOnce(BLOCKED);
    await expect(dependencies.enqueueReservedFullResyncWakeup(fullWakeup))
      .resolves.toEqual({ status: 'blocked' });
    expect(mocks.enqueueFull).not.toHaveBeenCalled();
    await expect(dependencies.enqueueReservedFullResyncWakeup(fullWakeup))
      .resolves.toEqual({ status: 'enqueued' });
    expect(mocks.enqueueFull).toHaveBeenCalledWith(fullWakeup);
    mocks.enqueueFull.mockResolvedValueOnce(false);
    await expect(dependencies.enqueueReservedFullResyncWakeup(fullWakeup))
      .resolves.toEqual({ status: 'unavailable' });
    await dependencies.findStrandedFullResyncWalletsPage('wallet-0');
    await dependencies.recoverIncrementalSync(incrementalOptions);
    await dependencies.recoverExpiredIncrementalSync(incrementalOptions);
    expect(mocks.findFull).toHaveBeenCalledWith('wallet-0');
    expect(mocks.recover).toHaveBeenCalledWith(incrementalOptions);
    expect(mocks.recoverExpired).toHaveBeenCalledWith(incrementalOptions);

    await runtime.start();
    expect(mocks.activate).toHaveBeenCalled();
    expect(mocks.coordinator.start).toHaveBeenCalledOnce();
    await runtime.stop();
    expect(mocks.coordinator.stop).toHaveBeenCalledOnce();
  });
});
