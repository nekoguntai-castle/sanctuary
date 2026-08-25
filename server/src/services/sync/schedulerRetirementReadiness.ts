import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import {
  readSubscriptionCoverage,
  type NetworkSubscriptionCoverageSnapshot,
  type SubscriptionCoverageReason,
  type SubscriptionCoverageReadResult,
} from '../../repositories/subscriptionCoverageRepository';

/** Retirement accepts no unexplained gap, including a newly opened one. */
export const SCHEDULER_RETIREMENT_MAX_OPEN_GAP_AGE_MS = 0;

export interface SchedulerRetirementNetworkReadiness {
  network: NetworkType;
  persisted: number;
  subscribed: number;
  pending: number;
  unknown: number;
  unresolvedComparisonFailures: number;
  historicalComparisonFailureCount: number;
  oldestOpenGapAgeMs: number | null;
  headerCheckpointKnown: boolean;
  headerReconciliationPending: boolean;
  ready: boolean;
  reason: SubscriptionCoverageReason;
}

export type SchedulerRetirementReadiness =
  | {
      status: 'ready' | 'blocked';
      evaluatedAt: Date;
      maxAllowedOpenGapAgeMs: typeof SCHEDULER_RETIREMENT_MAX_OPEN_GAP_AGE_MS;
      networks: SchedulerRetirementNetworkReadiness[];
    }
  | {
      status: 'unavailable';
      evaluatedAt: Date;
      reason: Extract<SubscriptionCoverageReadResult, { status: 'unavailable' }>['reason'];
    };

function exactNetworkReady(network: NetworkSubscriptionCoverageSnapshot): boolean {
  return network.ready
    && network.persisted === network.subscribed + network.pending + network.unknown
    && network.pending === 0
    && network.unknown === 0
    && network.unresolvedComparisonFailures === 0
    && network.oldestOpenGapAgeMs === null
    && network.headerCheckpointKnown
    && !network.headerReconciliationPending;
}

function projectNetwork(
  network: NetworkSubscriptionCoverageSnapshot,
): SchedulerRetirementNetworkReadiness {
  return {
    network: network.network,
    persisted: network.persisted,
    subscribed: network.subscribed,
    pending: network.pending,
    unknown: network.unknown,
    unresolvedComparisonFailures: network.unresolvedComparisonFailures,
    historicalComparisonFailureCount: network.historicalComparisonFailureCount,
    oldestOpenGapAgeMs: network.oldestOpenGapAgeMs,
    headerCheckpointKnown: network.headerCheckpointKnown,
    headerReconciliationPending: network.headerReconciliationPending,
    ready: exactNetworkReady(network),
    reason: network.reason,
  };
}

export function projectSchedulerRetirementReadiness(
  coverage: SubscriptionCoverageReadResult,
): SchedulerRetirementReadiness {
  if (coverage.status === 'unavailable') {
    return {
      status: 'unavailable',
      evaluatedAt: coverage.evaluatedAt,
      reason: coverage.reason,
    };
  }
  const networks = coverage.networks.map(projectNetwork);
  return {
    status: networks.every(network => network.ready) ? 'ready' : 'blocked',
    evaluatedAt: coverage.evaluatedAt,
    maxAllowedOpenGapAgeMs: SCHEDULER_RETIREMENT_MAX_OPEN_GAP_AGE_MS,
    networks,
  };
}

export async function readSchedulerRetirementReadiness(): Promise<
  SchedulerRetirementReadiness
> {
  return projectSchedulerRetirementReadiness(await readSubscriptionCoverage());
}
