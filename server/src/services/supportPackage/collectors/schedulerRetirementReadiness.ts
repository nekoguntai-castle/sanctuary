import { readSchedulerRetirementReadiness } from '../../sync/schedulerRetirementReadiness';
import { registerShareableCollector } from './registry';
import { schedulerRetirementReadinessSchema } from './schedulerRetirementReadinessSchema';

const MAX_SHAREABLE_COUNT = 1_000_000;

/**
 * Like the sibling database collectors (supportWalletSyncDiagnosticsRepository,
 * supportNotificationDiagnosticsRepository), every statement is cancelled
 * server-side well inside the runner's collector deadline, so a slow read
 * settles as an `unavailable` section instead of outliving the deadline and
 * fencing all later package generation (runner.ts collectSection).
 */
export const SUPPORT_COVERAGE_STATEMENT_TIMEOUT_MS = 2_000;

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
    const readiness = await readSchedulerRetirementReadiness({
      statementTimeoutMs: SUPPORT_COVERAGE_STATEMENT_TIMEOUT_MS,
    });
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
