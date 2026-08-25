import {
  schedulerRetirementCutoverRepository,
  type SchedulerRetirementCutoverResult,
} from '../../repositories/schedulerRetirementCutoverRepository';
import {
  readStaleWalletSchedulePolicy,
  type StaleWalletSchedulePolicy,
} from '../../repositories/walletSyncSchedulePolicyRepository';
import {
  walletSyncActivationGate,
  type WalletSyncActivationState,
} from './walletSyncActivationGate';
import {
  WorkerHeartbeatReader,
  type WorkerSchedulerRetirementReadiness,
} from '../workerHeartbeatRegistry';

interface SchedulerRetirementCutoverDependencies {
  establish: () => Promise<SchedulerRetirementCutoverResult>;
  inspectActivation: () => Promise<WalletSyncActivationState>;
  inspectRetirementFleet: () => Promise<WorkerSchedulerRetirementReadiness>;
  readPolicy: () => Promise<StaleWalletSchedulePolicy>;
}

export type SchedulerRetirementAttemptResult = SchedulerRetirementCutoverResult
  | {
      status: 'legacy_enabled';
      reason: 'activation_blocked';
      activation: WalletSyncActivationState;
    }
  | {
      status: 'legacy_enabled';
      reason: 'retirement_fleet_blocked';
      retirementFleet: WorkerSchedulerRetirementReadiness;
    };

export function createSchedulerRetirementCutover(
  dependencies: SchedulerRetirementCutoverDependencies,
) {
  async function attempt(): Promise<SchedulerRetirementAttemptResult> {
    const policy = await dependencies.readPolicy();
    if (policy.mode === 'forbidden') {
      return {
        status: 'forbidden',
        newlyForbidden: false,
        tombstone: policy.tombstone,
      };
    }
    const activation = await dependencies.inspectActivation();
    if (activation.status !== 'active') {
      return { status: 'legacy_enabled', reason: 'activation_blocked', activation };
    }
    const retirementFleet = await dependencies.inspectRetirementFleet();
    if (!retirementFleet.ready) {
      return {
        status: 'legacy_enabled',
        reason: 'retirement_fleet_blocked',
        retirementFleet,
      };
    }
    return dependencies.establish();
  }

  return { attempt };
}

const schedulerRetirementHeartbeatReader = new WorkerHeartbeatReader();

export const schedulerRetirementCutover = createSchedulerRetirementCutover({
  establish: schedulerRetirementCutoverRepository.establish,
  inspectActivation: () => walletSyncActivationGate.inspect(),
  inspectRetirementFleet: () => (
    schedulerRetirementHeartbeatReader.readSchedulerRetirementReadiness()
  ),
  readPolicy: readStaleWalletSchedulePolicy,
});
