import {
  WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS,
  WALLET_SYNC_MUTATION_FENCE_FLOOR,
} from '../../constants/walletSyncActivation';
import {
  walletSyncActivationPolicyRepository,
  type WalletSyncActivation,
  type WalletSyncActivationPolicy,
} from '../../repositories/walletSyncActivationPolicyRepository';
import {
  walletSyncActivationStabilizationRepository,
  type InspectWalletSyncActivationReadinessInput,
  type ObserveWalletSyncActivationReadinessInput,
  type WalletSyncActivationStabilizationResult,
} from '../../repositories/walletSyncActivationStabilizationRepository';
import {
  WorkerHeartbeatReader,
  type WorkerMutationFenceReadiness,
} from '../workerHeartbeatRegistry';
import { getRedisClient } from '../../infrastructure/redis';

export type WalletSyncActivationState =
  | {
      status: 'stabilizing';
      requiredFloor: typeof WALLET_SYNC_MUTATION_FENCE_FLOOR;
      candidateReadySince: string;
    }
  | {
      status: 'active';
      requiredFloor: typeof WALLET_SYNC_MUTATION_FENCE_FLOOR;
      activatedAt: string;
    }
  | {
      status: 'dormant';
      requiredFloor: typeof WALLET_SYNC_MUTATION_FENCE_FLOOR;
    }
  | {
      status: 'fleet_blocked';
      requiredFloor: typeof WALLET_SYNC_MUTATION_FENCE_FLOOR;
      reason: Extract<WorkerMutationFenceReadiness, { ready: false }>['reason'];
    }
  | {
      status: 'unavailable';
      requiredFloor: typeof WALLET_SYNC_MUTATION_FENCE_FLOOR;
      reason:
        | 'policy_unavailable'
        | 'fleet_unavailable'
        | 'stabilization_unavailable'
        | 'recovery_unavailable';
    };

// Runtime activation refreshes every 10 seconds. Two minutes tolerates brief
// scheduling/Redis delays while remaining well below the 15-minute registry
// retention bound; a larger gap restarts the complete drain horizon.
export const WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS = 2 * 60_000;

interface WalletSyncActivationGateDependencies {
  activatePolicy: (activatedAt: Date) => Promise<WalletSyncActivation>;
  drainHorizonMs: () => number;
  observeReadiness: (
    input: ObserveWalletSyncActivationReadinessInput,
  ) => Promise<WalletSyncActivationStabilizationResult>;
  inspectReadiness: (
    input: InspectWalletSyncActivationReadinessInput,
  ) => Promise<WalletSyncActivationStabilizationResult>;
  readFleet: (nowMs: number) => Promise<WorkerMutationFenceReadiness>;
  readPolicy: () => Promise<WalletSyncActivationPolicy>;
}

const dormantState = (): WalletSyncActivationState => ({
  status: 'dormant',
  requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
});

const unavailableState = (
  reason: Exclude<
    Extract<WalletSyncActivationState, { status: 'unavailable' }>['reason'],
    'recovery_unavailable'
  >,
): WalletSyncActivationState => ({
  status: 'unavailable',
  requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  reason,
});

function activeState(activation: WalletSyncActivation): WalletSyncActivationState {
  return {
    status: 'active',
    requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    activatedAt: activation.activatedAt,
  };
}

function fleetState(
  readiness: Extract<WorkerMutationFenceReadiness, { ready: false }>,
): WalletSyncActivationState {
  return {
    status: 'fleet_blocked',
    requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    reason: readiness.reason,
  };
}

function stabilizingState(
  result: WalletSyncActivationStabilizationResult,
): WalletSyncActivationState {
  const candidateReadySince = result.state.candidateReadySince;
  if (candidateReadySince === null) {
    return unavailableState('stabilization_unavailable');
  }
  return {
    status: 'stabilizing',
    requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
    candidateReadySince,
  };
}

export function createWalletSyncActivationGate(dependencies: WalletSyncActivationGateDependencies) {
  async function readFleet(now: Date): Promise<WorkerMutationFenceReadiness | null> {
    try {
      return await dependencies.readFleet(now.getTime());
    } catch {
      return null;
    }
  }

  async function readPolicy(): Promise<WalletSyncActivationPolicy | null> {
    try {
      return await dependencies.readPolicy();
    } catch {
      return null;
    }
  }

  async function observeReadiness(
    input: ObserveWalletSyncActivationReadinessInput,
  ): Promise<WalletSyncActivationStabilizationResult | null> {
    try {
      return await dependencies.observeReadiness(input);
    } catch {
      return null;
    }
  }

  async function inspectReadiness(): Promise<WalletSyncActivationStabilizationResult | null> {
    try {
      return await dependencies.inspectReadiness({
        readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
        drainHorizonMs: dependencies.drainHorizonMs(),
      });
    } catch {
      return null;
    }
  }

  async function resetReadiness(
    now: Date,
    status: 'blocked' | 'unavailable',
  ): Promise<boolean> {
    try {
      return (await observeReadiness({
        observation: { status },
        evaluatedAt: now,
        readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
        drainHorizonMs: dependencies.drainHorizonMs(),
      })) !== null;
    } catch {
      return false;
    }
  }

  async function evaluate(
    now: Date,
    activate: boolean,
  ): Promise<WalletSyncActivationState> {
    // `activate` is reserved for the worker runtime: it may extend continuous
    // readiness and persist the immutable policy. Admission uses inspect mode,
    // which is read-only while healthy. Every unsafe observation resets proof.
    const policy = await readPolicy();
    if (policy === null) {
      if (!await resetReadiness(now, 'unavailable')) {
        return unavailableState('stabilization_unavailable');
      }
      return unavailableState('policy_unavailable');
    }
    const readiness = await readFleet(now);
    if (readiness === null) {
      if (!await resetReadiness(now, 'unavailable')) {
        return unavailableState('stabilization_unavailable');
      }
      return unavailableState('fleet_unavailable');
    }
    if (!readiness.ready) {
      if (!await resetReadiness(now, 'blocked')) {
        return unavailableState('stabilization_unavailable');
      }
      return fleetState(readiness);
    }
    const stabilization = activate
      ? await observeReadiness({
        observation: { status: 'ready', observedAt: now },
        evaluatedAt: now,
        readyObservationMaxAgeMs: WALLET_SYNC_ACTIVATION_READY_OBSERVATION_MAX_AGE_MS,
        drainHorizonMs: dependencies.drainHorizonMs(),
      })
      : await inspectReadiness();
    if (stabilization === null || !stabilization.readyObservationAccepted) {
      await resetReadiness(now, 'unavailable');
      return unavailableState('stabilization_unavailable');
    }
    if (!stabilization.drainHorizonSatisfied) return stabilizingState(stabilization);
    if (policy.mode === 'active') return activeState(policy.activation);
    if (!activate) return dormantState();
    try {
      return activeState(await dependencies.activatePolicy(now));
    } catch {
      if (!await resetReadiness(now, 'unavailable')) {
        return unavailableState('stabilization_unavailable');
      }
      return unavailableState('policy_unavailable');
    }
  }

  async function inspect(now = new Date()): Promise<WalletSyncActivationState> {
    return evaluate(now, false);
  }

  async function activate(now = new Date()): Promise<WalletSyncActivationState> {
    return evaluate(now, true);
  }

  return { activate, inspect };
}

export type WalletSyncActivationGate = ReturnType<typeof createWalletSyncActivationGate>;

// Admission rechecks the fleet per mutation boundary. Reuse the process-owned
// Redis connection so bounded 100-row recovery pages do not create hundreds of
// short-lived TCP connections; shared Redis shutdown remains the sole owner.
/* v8 ignore next 5 -- static process adapter; shared-client ownership is tested on the reader */
const workerHeartbeatReader = new WorkerHeartbeatReader(() => {
  const redis = getRedisClient();
  if (!redis) throw new Error('Wallet-sync activation requires Redis');
  return redis;
}, false);

/** Sole process-wide durable/live activation authority for recovery and admission. */
export const walletSyncActivationGate = createWalletSyncActivationGate({
  activatePolicy: walletSyncActivationPolicyRepository.activate,
  /* v8 ignore next -- static process adapter returns the declared rollout invariant */
  drainHorizonMs: () => WALLET_SYNC_ACTIVATION_DRAIN_HORIZON_MS,
  inspectReadiness: walletSyncActivationStabilizationRepository.inspect,
  observeReadiness: walletSyncActivationStabilizationRepository.observe,
  /* v8 ignore next -- process adapter delegates to the exhaustively tested reader */
  readFleet: (nowMs) => workerHeartbeatReader.readMutationFenceReadiness(nowMs),
  readPolicy: walletSyncActivationPolicyRepository.read,
});
