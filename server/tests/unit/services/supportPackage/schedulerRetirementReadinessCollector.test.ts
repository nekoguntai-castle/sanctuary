import { beforeEach, describe, expect, it, vi } from 'vitest';

const { collectorMap, mockReadiness } = vi.hoisted(() => ({
  collectorMap: new Map<string, () => Promise<unknown>>(),
  mockReadiness: vi.fn(),
}));

vi.mock('../../../../src/services/sync/schedulerRetirementReadiness', () => ({
  readSchedulerRetirementReadiness: (...args: unknown[]) => mockReadiness(...args),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerShareableCollector: (
    name: string,
    definition: { collect: () => Promise<unknown> },
  ) => collectorMap.set(name, definition.collect),
}));

import '../../../../src/services/supportPackage/collectors/schedulerRetirementReadiness';
import { schedulerRetirementReadinessSchema } from '../../../../src/services/supportPackage/collectors/schedulerRetirementReadinessSchema';

const EVALUATED_AT = new Date('2026-08-24T12:00:00.000Z');

async function collect(): Promise<unknown> {
  const collector = collectorMap.get('schedulerRetirementReadiness');
  if (!collector) throw new Error('scheduler retirement collector not registered');
  return collector();
}

describe('scheduler retirement readiness collector', () => {
  beforeEach(() => mockReadiness.mockReset());

  it('bounds exact database counts before admitting the shareable artifact', async () => {
    mockReadiness.mockResolvedValue({
      status: 'blocked',
      evaluatedAt: EVALUATED_AT,
      maxAllowedOpenGapAgeMs: 0,
      networks: [{
        network: 'mainnet',
        persisted: 2_147_483_647,
        subscribed: 2_147_483_646,
        pending: 1,
        unknown: 0,
        unresolvedComparisonFailures: 2_147_483_647,
        historicalComparisonFailureCount: 2_147_483_647,
        oldestOpenGapAgeMs: 1,
        headerCheckpointKnown: true,
        headerReconciliationPending: true,
        ready: false,
        reason: 'header_gap',
      }],
    });

    const result = await collect();

    expect(result).toMatchObject({
      status: 'blocked',
      evaluatedAt: EVALUATED_AT.toISOString(),
      networks: [{
        persisted: 1_000_000,
        subscribed: 1_000_000,
        pending: 1,
        unresolvedComparisonFailures: 1_000_000,
        historicalComparisonFailureCount: 1_000_000,
      }],
    });
    expect(schedulerRetirementReadinessSchema.safeParse(result).success).toBe(true);
  });

  it('preserves fail-closed unavailability without inventing network counts', async () => {
    mockReadiness.mockResolvedValue({
      status: 'unavailable',
      evaluatedAt: EVALUATED_AT,
      reason: 'storage_unavailable',
    });

    await expect(collect()).resolves.toEqual({
      status: 'unavailable',
      evaluatedAt: EVALUATED_AT.toISOString(),
      reason: 'storage_unavailable',
    });
  });
});
