import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetStats, collectorMap } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/auditService', () => ({
  auditService: {
    getStats: (days: number) => mockGetStats(days),
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/auditLog';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('auditLog collector', () => {
  beforeEach(() => {
    mockGetStats.mockResolvedValue({
      totalEvents: 120,
      byCategory: { auth: 80, admin: 30, wallet: 10 },
      byAction: { 'auth.login': 60, 'auth.login_failed': 20 },
      failedEvents: 25,
    });
  });

  const getCollector = () => {
    const c = collectorMap.get('auditLog');
    if (!c) throw new Error('auditLog collector not registered');
    return c;
  };

  it('registers itself as auditLog', () => {
    expect(collectorMap.has('auditLog')).toBe(true);
  });

  it('returns audit stats for 7 days', async () => {
    const result = await getCollector()(makeContext());
    expect(mockGetStats).toHaveBeenCalledWith(7);
    expect(result.periodDays).toBe(7);
    expect(result.totalEvents).toBe(120);
    expect(result.failedEvents).toBe(25);
  });

  it('returns error on failure', async () => {
    mockGetStats.mockRejectedValue(new Error('db down'));
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('db down');
  });
});
