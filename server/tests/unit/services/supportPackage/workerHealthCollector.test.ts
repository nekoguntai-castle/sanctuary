import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetWorkerHealthStatus, collectorMap } = vi.hoisted(() => ({
  mockGetWorkerHealthStatus: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/workerHealth', () => ({
  getWorkerHealthStatus: () => mockGetWorkerHealthStatus(),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/workerHealth';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('workerHealth collector', () => {
  beforeEach(() => {
    mockGetWorkerHealthStatus.mockReturnValue({
      healthy: true,
      running: true,
      status: 'healthy',
      failures: 0,
      lastCheckedAt: '2026-04-25T00:00:00.000Z',
      lastHealthyAt: '2026-04-25T00:00:00.000Z',
      responseTimeMs: 10,
    });
  });

  const getCollector = () => {
    const collector = collectorMap.get('workerHealth');
    if (!collector) throw new Error('workerHealth collector not registered');
    return collector;
  };

  it('registers itself as workerHealth', () => {
    expect(collectorMap.has('workerHealth')).toBe(true);
  });

  it('returns healthy worker status without issues', async () => {
    const result = await getCollector()(makeContext());

    expect(result.status).toEqual(expect.objectContaining({ healthy: true, running: true }));
    expect((result.diagnostics as any).commonIssues).toEqual([]);
  });

  it('reports when worker health monitoring is not running or unhealthy', async () => {
    mockGetWorkerHealthStatus.mockReturnValueOnce({
      healthy: false,
      running: false,
      status: 'unreachable',
      failures: 3,
      lastCheckedAt: '2026-04-25T00:00:00.000Z',
      lastHealthyAt: null,
      responseTimeMs: null,
      error: 'connect ECONNREFUSED',
    });

    const result = await getCollector()(makeContext());

    expect((result.diagnostics as any).commonIssues).toEqual([
      'Worker health monitor is not running',
      'Worker is unreachable',
    ]);
  });
});
