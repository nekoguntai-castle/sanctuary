import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../../../src/constants/walletSyncActivation';
import {
  createWalletSyncActivationGate,
  WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
} from '../../../../src/services/sync/walletSyncActivationGate';

const firstReadyAt = new Date('2026-08-22T12:00:00.000Z');
const stabilizedAt = new Date('2026-08-22T12:01:00.000Z');
const drainHorizonMs = 60_000;
const activation = {
  version: 1 as const,
  activatedAt: stabilizedAt.toISOString(),
  mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
};
const ready = {
  ready: true as const,
  requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  registryIncarnation: 'incarnation-1',
};

function stabilization(
  candidateReadySince: Date | null,
  lastReadyAt: Date | null,
  drainHorizonSatisfied: boolean,
) {
  return {
    state: {
      version: 1 as const,
      requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      candidateReadySince: candidateReadySince?.toISOString() ?? null,
      lastReadyAt: lastReadyAt?.toISOString() ?? null,
    },
    readyObservationAccepted: candidateReadySince !== null,
    drainHorizonSatisfied,
    continuity: 'none' as 'held' | 'incarnation_changed' | 'none',
  };
}

const firstReadySample = stabilization(firstReadyAt, firstReadyAt, false);
const continuouslyReady = stabilization(firstReadyAt, stabilizedAt, true);
const resetEvidence = stabilization(null, null, false);

describe('walletSyncActivationGate', () => {
  const dependencies = {
    activatePolicy: vi.fn(),
    drainHorizonMs: vi.fn(),
    inspectReadiness: vi.fn(),
    observeReadiness: vi.fn(),
    readFleet: vi.fn(),
    readPolicy: vi.fn(),
  };
  const gate = createWalletSyncActivationGate(dependencies);

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.activatePolicy.mockResolvedValue(activation);
    dependencies.drainHorizonMs.mockReturnValue(drainHorizonMs);
    dependencies.inspectReadiness.mockResolvedValue(firstReadySample);
    dependencies.observeReadiness.mockResolvedValue(firstReadySample);
    dependencies.readFleet.mockResolvedValue(ready);
    dependencies.readPolicy.mockResolvedValue({ mode: 'dormant' });
  });

  it('does not activate from a single ready fleet sample', async () => {
    await expect(gate.activate(firstReadyAt)).resolves.toEqual({
      status: 'stabilizing',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      candidateReadySince: firstReadyAt.toISOString(),
    });
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'ready', observedAt: firstReadyAt, registryIncarnation: 'incarnation-1' },
      evaluatedAt: firstReadyAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
    expect(dependencies.inspectReadiness).not.toHaveBeenCalled();
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('activates only after continuous fresh evidence satisfies the drain horizon', async () => {
    dependencies.observeReadiness
      .mockResolvedValueOnce(firstReadySample)
      .mockResolvedValueOnce(continuouslyReady);

    await expect(gate.activate(firstReadyAt)).resolves.toMatchObject({ status: 'stabilizing' });
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'active',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      activatedAt: stabilizedAt.toISOString(),
    });
    expect(dependencies.activatePolicy).toHaveBeenCalledOnce();
    expect(dependencies.activatePolicy).toHaveBeenCalledWith(stabilizedAt);
  });

  it('uses a read-only stabilization snapshot for a ready inspection', async () => {
    dependencies.inspectReadiness.mockResolvedValue(continuouslyReady);
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'dormant',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    });
    expect(dependencies.inspectReadiness).toHaveBeenCalledWith({
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
      registryIncarnation: 'incarnation-1',
    });
    expect(dependencies.observeReadiness).not.toHaveBeenCalled();
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('requires current live and stabilized evidence for an existing active marker', async () => {
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
    await expect(gate.inspect(stabilizedAt)).resolves.toMatchObject({ status: 'stabilizing' });

    dependencies.inspectReadiness.mockResolvedValue(continuouslyReady);
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'active',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      activatedAt: stabilizedAt.toISOString(),
    });
    expect(dependencies.observeReadiness).not.toHaveBeenCalled();
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  describe('re-admission after activation', () => {
    const heldContinuity = { ...firstReadySample, continuity: 'held' as const };

    it('re-admits on current exact readiness when continuity is held', async () => {
      dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
      dependencies.observeReadiness.mockResolvedValue(heldContinuity);
      dependencies.inspectReadiness.mockResolvedValue(heldContinuity);

      await expect(gate.activate(firstReadyAt)).resolves.toEqual({
        status: 'active',
        requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
        activatedAt: stabilizedAt.toISOString(),
      });
      await expect(gate.inspect(firstReadyAt)).resolves.toMatchObject({ status: 'active' });
      expect(dependencies.activatePolicy).not.toHaveBeenCalled();
    });

    it('still drains when the policy predates the binary floor', async () => {
      dependencies.readPolicy.mockResolvedValue({
        mode: 'active',
        activation: { ...activation, mutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR - 1 },
      });
      dependencies.inspectReadiness.mockResolvedValue(heldContinuity);

      await expect(gate.inspect(firstReadyAt)).resolves.toMatchObject({ status: 'stabilizing' });
    });

    it('never establishes the first activation from continuity alone', async () => {
      dependencies.observeReadiness.mockResolvedValue(heldContinuity);

      await expect(gate.activate(firstReadyAt)).resolves.toMatchObject({ status: 'stabilizing' });
      expect(dependencies.activatePolicy).not.toHaveBeenCalled();
    });

    it('taints and fails closed when the registry incarnation changed', async () => {
      dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
      dependencies.inspectReadiness.mockResolvedValue({
        ...continuouslyReady,
        continuity: 'incarnation_changed' as const,
      });
      dependencies.observeReadiness.mockResolvedValue(resetEvidence);

      await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
        status: 'unavailable',
        requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
        reason: 'stabilization_unavailable',
      });
      expect(dependencies.observeReadiness).toHaveBeenCalledWith(expect.objectContaining({
        observation: { status: 'blocked', taint: true },
      }));
    });
  });

  it.each([
    'no_workers',
    'incomplete_fleet',
    'worker_below_floor',
    'restart_observed',
    'unavailable',
    'timeout',
  ] as const)('resets stabilization and propagates mixed-fleet reason %s', async (reason) => {
    const taint = !['no_workers', 'unavailable', 'timeout'].includes(reason);
    dependencies.readFleet.mockResolvedValue({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason,
      taint,
    });
    dependencies.observeReadiness.mockResolvedValue(resetEvidence);

    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'fleet_blocked',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason,
    });
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'blocked', taint },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('resets unavailable fleet evidence and fails closed without activating', async () => {
    dependencies.readFleet.mockRejectedValue(new Error('redis unavailable'));
    dependencies.observeReadiness.mockResolvedValue(resetEvidence);

    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'fleet_unavailable',
    });
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'unavailable', taint: false },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('starts a new stabilization interval after a blocked mixed-fleet sample', async () => {
    dependencies.readFleet
      .mockResolvedValueOnce({
        ready: false,
        requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
        reason: 'incomplete_fleet',
      })
      .mockResolvedValueOnce(ready);
    dependencies.observeReadiness
      .mockResolvedValueOnce(resetEvidence)
      .mockResolvedValueOnce(stabilization(stabilizedAt, stabilizedAt, false));

    await expect(gate.activate(firstReadyAt)).resolves.toMatchObject({
      status: 'fleet_blocked',
      reason: 'incomplete_fleet',
    });
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'stabilizing',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      candidateReadySince: stabilizedAt.toISOString(),
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('fails closed when stabilization data is malformed or unavailable', async () => {
    dependencies.observeReadiness.mockRejectedValue(new Error('malformed stabilization'));
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('fails closed when a ready observation produces no candidate interval', async () => {
    dependencies.observeReadiness.mockResolvedValue({
      ...resetEvidence,
      readyObservationAccepted: true,
    });
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('fails closed when blocked evidence cannot be durably reset', async () => {
    dependencies.readFleet.mockResolvedValue({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'worker_below_floor',
    });
    dependencies.observeReadiness.mockRejectedValue(new Error('database unavailable'));
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
  });

  it('fails closed when unavailable fleet evidence cannot be durably reset', async () => {
    dependencies.readFleet.mockRejectedValue(new Error('redis unavailable'));
    dependencies.observeReadiness.mockRejectedValue(new Error('database unavailable'));
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
  });

  it('fails closed when reset configuration is unavailable', async () => {
    dependencies.readPolicy.mockRejectedValue(new Error('database unavailable'));
    dependencies.drainHorizonMs.mockImplementation(() => {
      throw new Error('configuration unavailable');
    });
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
    expect(dependencies.observeReadiness).not.toHaveBeenCalled();
  });

  it('durably resets unsafe blocked inspection without consulting read-only evidence', async () => {
    dependencies.readFleet.mockResolvedValue({
      ready: false,
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'restart_observed',
      taint: true,
    });
    dependencies.observeReadiness.mockResolvedValue(resetEvidence);

    await expect(gate.inspect(stabilizedAt)).resolves.toMatchObject({
      status: 'fleet_blocked',
      reason: 'restart_observed',
    });
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'blocked', taint: true },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
    expect(dependencies.inspectReadiness).not.toHaveBeenCalled();
  });

  it('fails closed when a ready inspection cannot read stabilization', async () => {
    dependencies.inspectReadiness.mockRejectedValue(new Error('database unavailable'));
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'unavailable', taint: false },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
  });

  it('fails closed when a ready inspection finds stale evidence', async () => {
    dependencies.inspectReadiness.mockResolvedValue({
      ...firstReadySample,
      readyObservationAccepted: false,
    });
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'unavailable', taint: false },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
  });

  it('durably resets stabilization when the policy is unreadable', async () => {
    dependencies.readPolicy.mockRejectedValue(new Error('corrupt policy'));
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'policy_unavailable',
    });
    expect(dependencies.readFleet).not.toHaveBeenCalled();
    expect(dependencies.inspectReadiness).not.toHaveBeenCalled();
    expect(dependencies.observeReadiness).toHaveBeenCalledWith({
      observation: { status: 'unavailable', taint: false },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });

  it('reports stabilization unavailable when policy evidence cannot be reset', async () => {
    dependencies.readPolicy.mockRejectedValue(new Error('corrupt policy'));
    dependencies.observeReadiness.mockRejectedValue(new Error('database unavailable'));
    await expect(gate.inspect(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
  });

  it('contains activation persistence failure after stabilization', async () => {
    dependencies.observeReadiness.mockResolvedValue(continuouslyReady);
    dependencies.activatePolicy.mockRejectedValue(new Error('write failed'));
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'policy_unavailable',
    });
    expect(dependencies.observeReadiness).toHaveBeenLastCalledWith({
      observation: { status: 'unavailable', taint: false },
      evaluatedAt: stabilizedAt,
      readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
      drainHorizonMs,
    });
  });

  it('fails closed when activation persistence failure cannot reset readiness', async () => {
    dependencies.observeReadiness
      .mockResolvedValueOnce(continuouslyReady)
      .mockRejectedValueOnce(new Error('database unavailable'));
    dependencies.activatePolicy.mockRejectedValue(new Error('write failed'));
    await expect(gate.activate(stabilizedAt)).resolves.toEqual({
      status: 'unavailable',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: 'stabilization_unavailable',
    });
  });

  it('uses the current time and injected drain horizon when no clock is supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(stabilizedAt);
    dependencies.observeReadiness.mockResolvedValue(continuouslyReady);
    try {
      await expect(gate.activate()).resolves.toMatchObject({ status: 'active' });
      expect(dependencies.readFleet).toHaveBeenCalledWith(stabilizedAt.getTime());
      expect(dependencies.drainHorizonMs).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves idempotent activation results for concurrent stabilized callers', async () => {
    dependencies.observeReadiness.mockResolvedValue(continuouslyReady);
    const [first, second] = await Promise.all([
      gate.activate(stabilizedAt),
      gate.activate(stabilizedAt),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({ status: 'active', activatedAt: stabilizedAt.toISOString() });
    expect(dependencies.activatePolicy).toHaveBeenCalledTimes(2);
  });

  it('keeps concurrent ready inspections read-only', async () => {
    dependencies.readPolicy.mockResolvedValue({ mode: 'active', activation });
    dependencies.inspectReadiness.mockResolvedValue(continuouslyReady);

    const results = await Promise.all(Array.from({ length: 5 }, () => gate.inspect(stabilizedAt)));

    expect(results.every(result => result.status === 'active')).toBe(true);
    expect(dependencies.inspectReadiness).toHaveBeenCalledTimes(5);
    expect(dependencies.observeReadiness).not.toHaveBeenCalled();
    expect(dependencies.activatePolicy).not.toHaveBeenCalled();
  });
});
