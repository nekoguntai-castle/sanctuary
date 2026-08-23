import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from '../../constants/walletSyncActivation';
import {
  walletSyncActivationPolicyRepository,
  type WalletSyncActivation,
  type WalletSyncActivationPolicy,
} from '../../repositories/walletSyncActivationPolicyRepository';
import {
  WorkerHeartbeatReader,
  type WorkerMutationFenceReadiness,
} from '../workerHeartbeatRegistry';

export type WalletSyncActivationState =
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
      reason: 'policy_unavailable' | 'fleet_unavailable';
    };

interface WalletSyncActivationGateDependencies {
  activatePolicy: (activatedAt: Date) => Promise<WalletSyncActivation>;
  readFleet: (nowMs: number) => Promise<WorkerMutationFenceReadiness>;
  readPolicy: () => Promise<WalletSyncActivationPolicy>;
}

const dormantState = (): WalletSyncActivationState => ({
  status: 'dormant',
  requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
});

const unavailableState = (
  reason: Extract<WalletSyncActivationState, { status: 'unavailable' }>['reason'],
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
  readiness: WorkerMutationFenceReadiness,
  activation?: WalletSyncActivation,
): WalletSyncActivationState {
  if (!readiness.ready) {
    return {
      status: 'fleet_blocked',
      requiredFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
      reason: readiness.reason,
    };
  }
  return activation ? activeState(activation) : dormantState();
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

  async function inspect(now = new Date()): Promise<WalletSyncActivationState> {
    const policy = await readPolicy();
    if (policy === null) return unavailableState('policy_unavailable');
    if (policy.mode === 'dormant') return dormantState();
    const readiness = await readFleet(now);
    return readiness === null
      ? unavailableState('fleet_unavailable')
      : fleetState(readiness, policy.activation);
  }

  async function activate(now = new Date()): Promise<WalletSyncActivationState> {
    const policy = await readPolicy();
    if (policy === null) return unavailableState('policy_unavailable');
    const readiness = await readFleet(now);
    if (readiness === null) return unavailableState('fleet_unavailable');
    const observed = fleetState(
      readiness,
      policy.mode === 'active' ? policy.activation : undefined,
    );
    if (observed.status !== 'dormant') return observed;
    try {
      return activeState(await dependencies.activatePolicy(now));
    } catch {
      return unavailableState('policy_unavailable');
    }
  }

  return { activate, inspect };
}

export type WalletSyncActivationGate = ReturnType<typeof createWalletSyncActivationGate>;

const workerHeartbeatReader = new WorkerHeartbeatReader();

/** Dormant process-wide adapter; production boundaries do not call it yet. */
export const walletSyncActivationGate = createWalletSyncActivationGate({
  activatePolicy: walletSyncActivationPolicyRepository.activate,
  /* v8 ignore next -- process adapter delegates to the exhaustively tested reader */
  readFleet: (nowMs) => workerHeartbeatReader.readMutationFenceReadiness(nowMs),
  readPolicy: walletSyncActivationPolicyRepository.read,
});
