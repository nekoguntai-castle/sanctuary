import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSupportStats, collectorMap } = vi.hoisted(() => ({
  mockGetSupportStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  deviceRepository: {
    getSupportStats: mockGetSupportStats,
  },
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/devices';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('devices collector', () => {
  beforeEach(() => {
    mockGetSupportStats.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('devices');
    if (!c) throw new Error('devices collector not registered');
    return c;
  };

  it('registers itself as devices', () => {
    expect(collectorMap.has('devices')).toBe(true);
  });

  it('returns device stats on success', async () => {
    mockGetSupportStats.mockResolvedValue({
      total: 4,
      shared: 1,
      byType: { coldcard: 2, ledger: 1, sparrow: 1 },
      byModelSlug: { coldcard_mk4: 2, ledger_nano_s_plus: 1, unknown: 1 },
      totalAccounts: 12,
      walletAssociations: 6,
    });

    const result = await getCollector()(makeContext());
    expect(result.total).toBe(4);
    expect(result.byType).toEqual({ coldcard: 2, ledger: 1, sparrow: 1 });
    expect(result.totalAccounts).toBe(12);
  });

  it('never includes fingerprints, xpubs, or labels', async () => {
    mockGetSupportStats.mockResolvedValue({
      total: 1,
      shared: 0,
      byType: { coldcard: 1 },
      byModelSlug: { coldcard_mk4: 1 },
      totalAccounts: 3,
      walletAssociations: 1,
    });

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain('fingerprint');
    expect(json).not.toContain('xpub');
    expect(json).not.toContain('label');
  });

  it('returns error on repository failure', async () => {
    mockGetSupportStats.mockRejectedValue(new Error('db error'));
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('db error');
  });
});
