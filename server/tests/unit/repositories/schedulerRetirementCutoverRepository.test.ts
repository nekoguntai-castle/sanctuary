import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(),
  executeRaw: vi.fn(),
  forbidSchedule: vi.fn(),
  projectReadiness: vi.fn(),
  queryRaw: vi.fn(),
  readActivation: vi.fn(),
  readCoverage: vi.fn(),
  readPolicy: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('../../../src/models/prisma', () => ({
  default: { $transaction: mocks.transaction },
}));

vi.mock('../../../src/generated/prisma/client', () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }),
    TransactionIsolationLevel: { ReadCommitted: 'ReadCommitted' },
  },
}));

vi.mock('../../../src/repositories/schedulerRetirementReadinessProjection', () => ({
  projectSchedulerRetirementReadiness: mocks.projectReadiness,
}));

vi.mock('../../../src/repositories/subscriptionCoverageReadRepository', () => ({
  readSubscriptionCoverageWithClient: mocks.readCoverage,
}));

vi.mock('../../../src/repositories/walletSyncActivationPolicyRepository', () => ({
  readWalletSyncActivationPolicyWithClient: mocks.readActivation,
}));

vi.mock('../../../src/repositories/walletSyncRetirementLock', () => ({
  acquireWalletSyncRetirementLock: mocks.acquireLock,
}));

vi.mock('../../../src/repositories/walletSyncSchedulePolicyRepository', () => ({
  forbidStaleWalletScheduleWithClient: mocks.forbidSchedule,
  readStaleWalletSchedulePolicyWithClient: mocks.readPolicy,
}));

import { establishSchedulerRetirementCutover } from '../../../src/repositories/schedulerRetirementCutoverRepository';

const EVALUATED_AT = new Date('2026-08-25T00:00:00.000Z');
const FORBIDDEN_AT = new Date('2026-08-25T00:01:00.000Z');
const TOMBSTONE = {
  version: 1 as const,
  forbiddenAt: FORBIDDEN_AT.toISOString(),
  compatibilityFloor: 2 as const,
};
const READY = {
  status: 'ready' as const,
  evaluatedAt: EVALUATED_AT,
  maxAllowedOpenGapAgeMs: 0 as const,
  networks: [],
};
const BLOCKED = { ...READY, status: 'blocked' as const };

describe('schedulerRetirementCutoverRepository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operation) => operation({
      $executeRaw: mocks.executeRaw,
      $queryRaw: mocks.queryRaw,
    }));
    mocks.readPolicy.mockResolvedValue({ mode: 'legacy_enabled' });
    mocks.readActivation.mockResolvedValue({
      mode: 'active',
      activation: {
        version: 1,
        activatedAt: EVALUATED_AT.toISOString(),
        mutationFenceFloor: 3,
      },
    });
    mocks.readCoverage.mockResolvedValue({ status: 'available' });
    mocks.projectReadiness.mockReturnValue(READY);
    mocks.queryRaw.mockResolvedValue([{ forbiddenAt: FORBIDDEN_AT }]);
    mocks.forbidSchedule.mockResolvedValue(TOMBSTONE);
  });

  it('serializes the cutover, locks readiness writers, and creates one tombstone', async () => {
    await expect(establishSchedulerRetirementCutover()).resolves.toEqual({
      status: 'forbidden',
      newlyForbidden: true,
      tombstone: TOMBSTONE,
    });

    const tx = expect.objectContaining({
      $executeRaw: mocks.executeRaw,
      $queryRaw: mocks.queryRaw,
    });
    expect(mocks.acquireLock).toHaveBeenCalledWith(tx);
    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.readCoverage).toHaveBeenCalledTimes(2);
    expect(mocks.forbidSchedule).toHaveBeenCalledWith(tx, FORBIDDEN_AT);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'ReadCommitted',
      maxWait: 10_000,
      timeout: 60_000,
    });
  });

  it('preserves an existing irreversible tombstone without re-evaluating readiness', async () => {
    mocks.readPolicy.mockResolvedValue({ mode: 'forbidden', tombstone: TOMBSTONE });

    await expect(establishSchedulerRetirementCutover()).resolves.toEqual({
      status: 'forbidden',
      newlyForbidden: false,
      tombstone: TOMBSTONE,
    });
    expect(mocks.readActivation).not.toHaveBeenCalled();
    expect(mocks.readCoverage).not.toHaveBeenCalled();
    expect(mocks.forbidSchedule).not.toHaveBeenCalled();
  });

  it('refuses cutover when durable activation is not active', async () => {
    mocks.readActivation.mockResolvedValue({ mode: 'dormant' });

    await expect(establishSchedulerRetirementCutover()).resolves.toEqual({
      status: 'legacy_enabled',
      reason: 'activation_not_durable',
    });
    expect(mocks.readCoverage).not.toHaveBeenCalled();
    expect(mocks.forbidSchedule).not.toHaveBeenCalled();
  });

  it('returns the exact pre-write readiness blocker without creating a tombstone', async () => {
    mocks.projectReadiness.mockReturnValue(BLOCKED);

    await expect(establishSchedulerRetirementCutover()).resolves.toEqual({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
      readiness: BLOCKED,
    });
    expect(mocks.forbidSchedule).not.toHaveBeenCalled();
  });

  it('rolls back and returns the exact blocker when readiness changes after the write', async () => {
    mocks.projectReadiness.mockReturnValueOnce(READY).mockReturnValueOnce(BLOCKED);

    await expect(establishSchedulerRetirementCutover()).resolves.toEqual({
      status: 'legacy_enabled',
      reason: 'readiness_blocked',
      readiness: BLOCKED,
    });
    expect(mocks.forbidSchedule).toHaveBeenCalledOnce();
  });

  it.each([
    { name: 'missing row', rows: [] },
    { name: 'invalid value', rows: [{ forbiddenAt: new Date('invalid') }] },
  ])('fails closed for an unavailable database timestamp: $name', async ({ rows }) => {
    mocks.queryRaw.mockResolvedValue(rows);

    await expect(establishSchedulerRetirementCutover()).rejects.toThrow(
      'Scheduler retirement database timestamp is unavailable',
    );
    expect(mocks.forbidSchedule).not.toHaveBeenCalled();
  });

  it('does not translate unrelated transaction failures into readiness blockers', async () => {
    const failure = new Error('database unavailable');
    mocks.transaction.mockRejectedValue(failure);

    await expect(establishSchedulerRetirementCutover()).rejects.toBe(failure);
  });
});
