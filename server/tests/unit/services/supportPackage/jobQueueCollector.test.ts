import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockIsAvailable, mockGetHealth, mockGetRegisteredJobs, collectorMap } = vi.hoisted(() => ({
  mockIsAvailable: vi.fn(),
  mockGetHealth: vi.fn(),
  mockGetRegisteredJobs: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/jobs', () => ({
  jobQueue: {
    isAvailable: () => mockIsAvailable(),
    getHealth: () => mockGetHealth(),
    getRegisteredJobs: () => mockGetRegisteredJobs(),
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/jobQueue';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return {
    anonymize: createAnonymizer('test-salt'),
    generatedAt: new Date(),
  };
}

describe('jobQueue collector', () => {
  beforeEach(() => {
    mockIsAvailable.mockReturnValue(false);
    mockGetRegisteredJobs.mockReturnValue(['syncWallet', 'maintenance']);
    mockGetHealth.mockResolvedValue({
      healthy: true,
      queueName: 'main',
      waiting: 0,
      active: 1,
      completed: 50,
      failed: 2,
      delayed: 0,
      paused: false,
    });
  });

  const getCollector = () => {
    const collector = collectorMap.get('jobQueue');
    if (!collector) throw new Error('jobQueue collector not registered');
    return collector;
  };

  it('registers itself as jobQueue', () => {
    expect(collectorMap.has('jobQueue')).toBe(true);
  });

  it('reports unavailable when queue is not initialized', async () => {
    const result = await getCollector()(makeContext());
    expect(result.available).toBe(false);
    expect(result.registeredJobs).toEqual(['syncWallet', 'maintenance']);
  });

  it('returns health when queue is available', async () => {
    mockIsAvailable.mockReturnValue(true);
    const result = await getCollector()(makeContext());
    expect(result.available).toBe(true);
    expect((result.health as any).healthy).toBe(true);
    expect((result.health as any).failed).toBe(2);
  });

  it('returns error on failure', async () => {
    mockIsAvailable.mockImplementation(() => { throw new Error('redis down'); });
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('redis down');
  });
});
