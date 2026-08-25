import {
  readSubscriptionCoverage,
} from '../../repositories/subscriptionCoverageRepository';
import {
  projectSchedulerRetirementReadiness,
  type SchedulerRetirementReadiness,
} from '../../repositories/schedulerRetirementReadinessProjection';

export {
  projectSchedulerRetirementReadiness,
  SCHEDULER_RETIREMENT_MAX_OPEN_GAP_AGE_MS,
} from '../../repositories/schedulerRetirementReadinessProjection';
export type {
  SchedulerRetirementNetworkReadiness,
  SchedulerRetirementReadiness,
} from '../../repositories/schedulerRetirementReadinessProjection';

export async function readSchedulerRetirementReadiness(): Promise<
  SchedulerRetirementReadiness
> {
  return projectSchedulerRetirementReadiness(await readSubscriptionCoverage());
}
