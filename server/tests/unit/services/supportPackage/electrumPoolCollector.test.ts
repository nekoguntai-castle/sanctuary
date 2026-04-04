import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetPoolStats, collectorMap } = vi.hoisted(() => ({
  mockGetPoolStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/bitcoin/electrumPool', () => ({
  getElectrumPool: () => ({
    getPoolStats: () => mockGetPoolStats(),
  }),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/electrumPool';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt: new Date(),
  };
}

describe('electrumPool collector', () => {
  beforeEach(() => {
    mockGetPoolStats.mockReturnValue({
      totalConnections: 3,
      activeConnections: 1,
      idleConnections: 2,
      waitingRequests: 0,
      totalAcquisitions: 150,
      averageAcquisitionTimeMs: 12,
      healthCheckFailures: 0,
      serverCount: 2,
      servers: [],
    });
  });

  const getCollector = () => {
    const collector = collectorMap.get('electrumPool');
    if (!collector) throw new Error('electrumPool collector not registered');
    return collector;
  };

  it('registers itself as electrumPool', () => {
    expect(collectorMap.has('electrumPool')).toBe(true);
  });

  it('returns pool stats', async () => {
    const result = await getCollector()(makeContext());
    expect(result.totalConnections).toBe(3);
    expect(result.activeConnections).toBe(1);
    expect(result.serverCount).toBe(2);
  });

  it('returns error when pool is unavailable', async () => {
    mockGetPoolStats.mockImplementation(() => { throw new Error('pool not ready'); });
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('pool not ready');
  });
});
