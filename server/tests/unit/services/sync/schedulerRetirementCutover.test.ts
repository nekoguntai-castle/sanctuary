import { beforeEach, describe, expect, it, vi } from 'vitest';

const singletonMocks = vi.hoisted(() => ({
  establish: vi.fn(),
  inspectActivation: vi.fn(),
  inspectRetirementFleet: vi.fn(),
  readPolicy: vi.fn(),
}));

vi.mock('../../../../src/repositories/schedulerRetirementCutoverRepository', () => ({
  schedulerRetirementCutoverRepository: { establish: singletonMocks.establish },
}));

vi.mock('../../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  readStaleWalletSchedulePolicy: singletonMocks.readPolicy,
}));

vi.mock('../../../../src/services/sync/walletSyncActivationGate', () => ({
  walletSyncActivationGate: { inspect: singletonMocks.inspectActivation },
}));

vi.mock('../../../../src/services/workerHeartbeatRegistry', () => ({
  WorkerHeartbeatReader: class {
    readSchedulerRetirementReadiness = singletonMocks.inspectRetirementFleet;
  },
}));

import {
  createSchedulerRetirementCutover,
  schedulerRetirementCutover,
} from '../../../../src/services/sync/schedulerRetirementCutover';

const ACTIVE = {
  status: 'active' as const,
  requiredFloor: 3 as const,
  activatedAt: '2026-08-25T00:00:00.000Z',
};

describe('schedulerRetirementCutover', () => {
  const readPolicy = vi.fn();
  const inspectActivation = vi.fn();
  const inspectRetirementFleet = vi.fn();
  const establish = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    readPolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    inspectActivation.mockResolvedValue(ACTIVE);
    inspectRetirementFleet.mockResolvedValue({ ready: true, requiredFloor: 2 });
    establish.mockResolvedValue({
      status: 'forbidden',
      newlyForbidden: true,
      tombstone: {
        version: 1,
        forbiddenAt: '2026-08-25T00:00:00.000Z',
        compatibilityFloor: 2,
      },
    });
    singletonMocks.readPolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    singletonMocks.inspectActivation.mockResolvedValue(ACTIVE);
    singletonMocks.inspectRetirementFleet.mockResolvedValue({
      ready: true,
      requiredFloor: 2,
    });
    singletonMocks.establish.mockResolvedValue({
      status: 'forbidden',
      newlyForbidden: true,
      tombstone: {
        version: 1,
        forbiddenAt: '2026-08-25T00:00:00.000Z',
        compatibilityFloor: 2,
      },
    });
  });

  function cutover() {
    return createSchedulerRetirementCutover({
      establish,
      inspectActivation,
      inspectRetirementFleet,
      readPolicy,
    });
  }

  it('treats an existing durable tombstone as authoritative and idempotent', async () => {
    const tombstone = {
      version: 1 as const,
      forbiddenAt: '2026-08-24T00:00:00.000Z',
      compatibilityFloor: 2 as const,
    };
    readPolicy.mockResolvedValue({ mode: 'forbidden', tombstone });

    await expect(cutover().attempt()).resolves.toEqual({
      status: 'forbidden',
      newlyForbidden: false,
      tombstone,
    });
    expect(inspectActivation).not.toHaveBeenCalled();
    expect(inspectRetirementFleet).not.toHaveBeenCalled();
    expect(establish).not.toHaveBeenCalled();
  });

  it('retains compatibility while any live worker is below the scheduler-retirement floor', async () => {
    inspectRetirementFleet.mockResolvedValue({
      ready: false,
      requiredFloor: 2,
      reason: 'worker_below_floor',
    });

    await expect(cutover().attempt()).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'retirement_fleet_blocked',
      retirementFleet: { reason: 'worker_below_floor' },
    });
    expect(establish).not.toHaveBeenCalled();
  });

  it('retains compatibility when live fleet activation is not active', async () => {
    inspectActivation.mockResolvedValue({
      status: 'fleet_blocked',
      requiredFloor: 3,
      reason: 'missing_current_worker',
    });

    await expect(cutover().attempt()).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'activation_blocked',
    });
    expect(establish).not.toHaveBeenCalled();
  });

  it('delegates the atomic readiness-and-marker transaction only after both fleet gates', async () => {
    const result = await cutover().attempt();

    expect(result).toMatchObject({ status: 'forbidden', newlyForbidden: true });
    expect(establish).toHaveBeenCalledOnce();
    expect(inspectActivation.mock.invocationCallOrder[0]).toBeLessThan(
      inspectRetirementFleet.mock.invocationCallOrder[0] ?? 0,
    );
    expect(inspectRetirementFleet.mock.invocationCallOrder[0]).toBeLessThan(
      establish.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('returns the repository readiness blocker without writing compatibility state', async () => {
    establish.mockResolvedValue({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
      readiness: {
        status: 'blocked',
        evaluatedAt: new Date('2026-08-25T00:00:00.000Z'),
        maxAllowedOpenGapAgeMs: 0,
        networks: [],
      },
    });

    await expect(cutover().attempt()).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
    });
  });

  it('wires the production singleton to activation and retirement-fleet readers', async () => {
    await expect(schedulerRetirementCutover.attempt()).resolves.toMatchObject({
      status: 'forbidden',
      newlyForbidden: true,
    });
    expect(singletonMocks.inspectActivation).toHaveBeenCalledOnce();
    expect(singletonMocks.inspectRetirementFleet).toHaveBeenCalledOnce();
    expect(singletonMocks.establish).toHaveBeenCalledOnce();
  });

  it('preserves the retirement-fleet blocker through the production singleton', async () => {
    singletonMocks.inspectRetirementFleet.mockResolvedValue({
      ready: false,
      requiredFloor: 2,
      reason: 'worker_below_floor',
    });

    await expect(schedulerRetirementCutover.attempt()).resolves.toMatchObject({
      status: 'legacy_enabled',
      reason: 'retirement_fleet_blocked',
      retirementFleet: { reason: 'worker_below_floor' },
    });
    expect(singletonMocks.establish).not.toHaveBeenCalled();
  });
});
