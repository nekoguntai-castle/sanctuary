import { describe, it, expect, vi } from 'vitest';

const { mockGetAllHealth, mockGetOverallStatus, collectorMap } = vi.hoisted(() => ({
  mockGetAllHealth: vi.fn(),
  mockGetOverallStatus: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/circuitBreaker', () => ({
  API_PROCESS_BREAKER_SCOPE: 'api-process',
  circuitBreakerRegistry: {
    getAllHealth: mockGetAllHealth,
    getOverallStatus: mockGetOverallStatus,
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/circuitBreakers';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  const generatedAt = new Date();
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt,
    signal: new AbortController().signal,
    deadlineMs: Date.now() + 30_000,
  } satisfies CollectorContext;
}

describe('circuitBreakers collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('circuitBreakers');
    if (!c) throw new Error('circuitBreakers collector not registered');
    return c;
  };

  it('registers itself as circuitBreakers', () => {
    expect(collectorMap.has('circuitBreakers')).toBe(true);
  });

  it('returns breakers and overallStatus', async () => {
    const healthData = [
      { name: 'electrum', state: 'closed', failureCount: 0 },
      { name: 'redis', state: 'closed', failureCount: 0 },
    ];
    mockGetAllHealth.mockReturnValue(healthData);
    mockGetOverallStatus.mockReturnValue('healthy');

    const result = await getCollector()(makeContext());
    expect(result.breakers).toEqual(healthData);
    expect(result.overallStatus).toBe('healthy');
  });

  it('labels the breakers as this process only', async () => {
    // Breakers are per process. Sync and notification sending run in the
    // worker, so closed breakers here say nothing about the worker's.
    mockGetAllHealth.mockReturnValue([]);
    mockGetOverallStatus.mockReturnValue('healthy');

    const result = await getCollector()(makeContext());

    expect(result.scope).toBe('api-process');
  });

  it('reflects degraded status when a breaker is open', async () => {
    const healthData = [
      { name: 'electrum', state: 'open', failureCount: 5 },
      { name: 'redis', state: 'closed', failureCount: 0 },
    ];
    mockGetAllHealth.mockReturnValue(healthData);
    mockGetOverallStatus.mockReturnValue('degraded');

    const result = await getCollector()(makeContext());
    expect(result.breakers).toEqual(healthData);
    expect(result.overallStatus).toBe('degraded');
  });
});
