import { readSchedulerRetirementReadiness } from '../../sync/schedulerRetirementReadiness';
import { registerShareableCollector } from './registry';
import { schedulerRetirementReadinessSchema } from './schedulerRetirementReadinessSchema';

const MAX_SHAREABLE_COUNT = 1_000_000;

function boundedCount(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 0), MAX_SHAREABLE_COUNT);
}

export function projectShareableSchedulerRetirementReadiness(
  readiness: Awaited<ReturnType<typeof readSchedulerRetirementReadiness>>,
): unknown {
  if (readiness.status === 'unavailable') {
    return { ...readiness, evaluatedAt: readiness.evaluatedAt.toISOString() };
  }
  return {
    ...readiness,
    evaluatedAt: readiness.evaluatedAt.toISOString(),
    networks: readiness.networks.map((network) => ({
      ...network,
      persisted: boundedCount(network.persisted),
      subscribed: boundedCount(network.subscribed),
      pending: boundedCount(network.pending),
      unknown: boundedCount(network.unknown),
      unresolvedComparisonFailures: boundedCount(network.unresolvedComparisonFailures),
      historicalComparisonFailureCount: boundedCount(network.historicalComparisonFailureCount),
    })),
  };
}

registerShareableCollector('schedulerRetirementReadiness', {
  collect: async () => {
    const readiness = await readSchedulerRetirementReadiness();
    return schedulerRetirementReadinessSchema.parse(
      projectShareableSchedulerRetirementReadiness(readiness),
    );
  },
  schema: schedulerRetirementReadinessSchema,
  sourceProcess: 'database_shared',
  sourceKind: 'aggregate_query',
  authoritativeFor: ['scheduler_retirement_readiness'],
  notAuthoritativeFor: ['wallet_sync_execution'],
});
