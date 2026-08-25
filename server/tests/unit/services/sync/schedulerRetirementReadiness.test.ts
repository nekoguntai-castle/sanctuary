import { describe, expect, it } from 'vitest';
import {
  projectSchedulerRetirementReadiness,
  SCHEDULER_RETIREMENT_MAX_OPEN_GAP_AGE_MS,
} from '../../../../src/services/sync/schedulerRetirementReadiness';
import type { NetworkSubscriptionCoverageSnapshot } from '../../../../src/repositories/subscriptionCoverageTypes';

const EVALUATED_AT = new Date('2026-08-24T12:00:00.000Z');

function network(
  overrides: Partial<NetworkSubscriptionCoverageSnapshot> = {},
): NetworkSubscriptionCoverageSnapshot {
  return {
    network: 'mainnet',
    evaluatedAt: EVALUATED_AT,
    persisted: 2,
    subscribed: 2,
    pending: 0,
    unknown: 0,
    unresolvedComparisonFailures: 0,
    historicalComparisonFailureCount: 0,
    firstComparisonFailureAt: null,
    lastComparisonFailureAt: null,
    oldestOpenGapStartedAt: null,
    oldestOpenGapAgeMs: null,
    headerCheckpointKnown: true,
    headerReconciliationPending: false,
    headerHeight: 900_000,
    headerObservedAt: EVALUATED_AT,
    ready: true,
    reason: 'ready',
    ...overrides,
  };
}

describe('schedulerRetirementReadiness', () => {
  it('accepts only an exact exhaustive, gap-free represented-network partition', () => {
    expect(projectSchedulerRetirementReadiness({
      status: 'available',
      evaluatedAt: EVALUATED_AT,
      ready: true,
      networks: [network(), network({ network: 'signet', persisted: 0, subscribed: 0 })],
    })).toEqual({
      status: 'ready',
      evaluatedAt: EVALUATED_AT,
      maxAllowedOpenGapAgeMs: SCHEDULER_RETIREMENT_MAX_OPEN_GAP_AGE_MS,
      networks: [
        expect.objectContaining({ network: 'mainnet', ready: true }),
        expect.objectContaining({ network: 'signet', ready: true }),
      ],
    });
  });

  it.each([
    ['pending subscription', { pending: 1, subscribed: 1, ready: false, reason: 'subscription_pending' as const }],
    ['unknown subscription', { unknown: 1, subscribed: 1, ready: false, reason: 'subscription_unknown' as const }],
    ['comparison failure', { unresolvedComparisonFailures: 1, ready: false, reason: 'comparison_failure' as const }],
    ['missing header', { headerCheckpointKnown: false, ready: false, reason: 'header_unknown' as const }],
    ['active reconciliation', {
      headerReconciliationPending: true,
      oldestOpenGapAgeMs: 1,
      ready: false,
      reason: 'header_gap' as const,
    }],
  ])('blocks retirement for %s', (_label, overrides) => {
    const result = projectSchedulerRetirementReadiness({
      status: 'available',
      evaluatedAt: EVALUATED_AT,
      ready: false,
      networks: [network(overrides)],
    });

    expect(result).toMatchObject({ status: 'blocked', networks: [{ ready: false }] });
  });

  it('fails closed when the authoritative coverage read is unavailable', () => {
    expect(projectSchedulerRetirementReadiness({
      status: 'unavailable',
      evaluatedAt: EVALUATED_AT,
      ready: false,
      reason: 'storage_unavailable',
    })).toEqual({
      status: 'unavailable',
      evaluatedAt: EVALUATED_AT,
      reason: 'storage_unavailable',
    });
  });
});
