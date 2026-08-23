import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../../src/constants/walletSyncActivation';
import { createWalletSyncActivationGate } from '../../../../src/services/sync/walletSyncActivationGate';

const activatedAt = new Date('2026-08-22T12:00:00.000Z');
const activation = {
  version: 1 as const,
  activatedAt: activatedAt.toISOString(),
  mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
};
const ready = {
  ready: true as const,
  requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
};

describe('walletSyncActivationGate', () => {
  const dependencies = {
    activatePolicy: vi.fn(),
    readFleet: vi.fn(),
    readPolicy: vi.fn(),
  };
  const gate = createWalletSyncActivationGate(dependencies);

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.activatePolicy.mockResolvedValue(activation);
    dependencies.readFleet.mockResolvedValue(ready);
    dependencies.readPolicy.mockResolvedValue({ mode: 'dormant' });
  });

  it('reports a missing durable activation as dormant without consulting Redis', async () => {
    await expect(gate.inspect(activatedAt)).resolves.toEqual({
      status: 'dormant',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    });
    expect(dependencies.readFleet).not.toHaveBeenCalled();
  });

  it('uses the current time when inspection omits an explicit clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(activatedAt);
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
    try {
      await expect(gate.inspect()).resolves.toMatchObject({ status: 'active' });
      expect(dependencies.readFleet).toHaveBeenCalledWith(activatedAt.getTime());
      dependencies.readPolicy.mockResolvedValue({ mode: 'dormant' });
      await expect(gate.activate()).resolves.toMatchObject({ status: 'active' });
      expect(dependencies.activatePolicy).toHaveBeenCalledWith(activatedAt);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports active only when the durable floor and current fleet both pass', async () => {
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });

    await expect(gate.inspect(activatedAt)).resolves.toEqual({
      status: 'active',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      activatedAt: activatedAt.toISOString(),
    });
    expect(dependencies.readFleet).toHaveBeenCalledWith(activatedAt.getTime());
  });

  it.each([
    'no_workers',
    'incomplete_fleet',
    'worker_below_floor',
    'unavailable',
    'timeout',
  ] as const)('closes an active gate for fleet evidence %s', async (reason) => {
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
    dependencies.readFleet.mockResolvedValue({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason,
    });

    await expect(gate.inspect(activatedAt)).resolves.toEqual({
      status: 'fleet_blocked',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason,
    });
  });

  it('persists activation only after an exact ready fleet observation', async () => {
    await expect(gate.activate(activatedAt)).resolves.toEqual({
      status: 'active',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      activatedAt: activatedAt.toISOString(),
    });
    expect(dependencies.readFleet).toHaveBeenCalledWith(activatedAt.getTime());
    expect(dependencies.activatePolicy).toHaveBeenCalledWith(activatedAt);
  });

  it('never writes activation when the fleet is not exactly ready', async () => {
    dependencies.readFleet.mockResolvedValue({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'worker_below_floor',
    });

    await expect(gate.activate(activatedAt)).resolves.toEqual({
      status: 'fleet_blocked',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'worker_below_floor',
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('rechecks the live fleet for an existing activation without rewriting it', async () => {
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });

    await expect(gate.activate(activatedAt)).resolves.toMatchObject({
      status: 'active',
      activatedAt: activatedAt.toISOString(),
    });
    expect(dependencies.readFleet).toHaveBeenCalledOnce();
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it.each([
    [
      'policy read',
      () => dependencies.readPolicy.mockRejectedValue(new Error('db down')),
      { status: 'unavailable', reason: 'policy_unavailable' },
    ],
    [
      'fleet read',
      () => dependencies.readFleet.mockRejectedValue(new Error('redis down')),
      { status: 'unavailable', reason: 'fleet_unavailable' },
    ],
  ] as const)('contains an unavailable %s during inspection', async (_name, arrange, expected) => {
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
    arrange();

    await expect(gate.inspect(activatedAt)).resolves.toEqual({
      ...expected,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    });
  });

  it('contains policy persistence failure after readiness without claiming activation', async () => {
    dependencies.activatePolicy.mockRejectedValue(new Error('write failed'));

    await expect(gate.activate(activatedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'policy_unavailable',
    });
  });

  it('contains an unavailable fleet during activation without writing policy', async () => {
    dependencies.readFleet.mockRejectedValue(new Error('redis down'));

    await expect(gate.activate(activatedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'fleet_unavailable',
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('does not consult or mutate fleet state when durable policy is unreadable', async () => {
    dependencies.readPolicy.mockRejectedValue(new Error('corrupt policy'));

    await expect(gate.activate(activatedAt)).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'policy_unavailable',
    });
    expect(dependencies.readFleet).not.toHaveBeenCalled();
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });
});
