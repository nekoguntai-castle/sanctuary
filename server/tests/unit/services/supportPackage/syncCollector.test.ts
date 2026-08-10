import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetHealthMetrics, collectorMap } = vi.hoisted(() => ({
  mockGetHealthMetrics: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/syncService', () => ({
  getSyncService: () => ({
    getHealthMetrics: mockGetHealthMetrics,
  }),
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/sync';
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

describe('sync collector', () => {
  beforeEach(() => {
    mockGetHealthMetrics.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('sync');
    if (!c) throw new Error('sync collector not registered');
    return c;
  };

  it('registers itself as sync', () => {
    expect(collectorMap.has('sync')).toBe(true);
  });

  it('returns metrics on success', async () => {
    const metrics = { blockHeight: 800000, synced: true, peers: 8 };
    mockGetHealthMetrics.mockReturnValue(metrics);

    const result = await getCollector()(makeContext());
    expect(result.metrics).toEqual(metrics);
    expect(result).not.toHaveProperty('error');
  });

  it('returns error and null metrics on failure', async () => {
    mockGetHealthMetrics.mockImplementation(() => {
      throw new Error('sync service not initialized');
    });

    const result = await getCollector()(makeContext());
    expect(result.error).toBe('sync service not initialized');
    expect(result.metrics).toBeNull();
  });
});
