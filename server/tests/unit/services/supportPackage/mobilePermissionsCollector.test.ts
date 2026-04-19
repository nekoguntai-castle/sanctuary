import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSupportStats, collectorMap } = vi.hoisted(() => ({
  mockGetSupportStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  mobilePermissionRepository: {
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

import '../../../../src/services/supportPackage/collectors/mobilePermissions';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('mobilePermissions collector', () => {
  beforeEach(() => {
    mockGetSupportStats.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('mobilePermissions');
    if (!c) throw new Error('mobilePermissions collector not registered');
    return c;
  };

  it('registers itself as mobilePermissions', () => {
    expect(collectorMap.has('mobilePermissions')).toBe(true);
  });

  it('returns capability counts on success', async () => {
    mockGetSupportStats.mockResolvedValue({
      totalRows: 10,
      distinctWallets: 4,
      distinctUsers: 6,
      capabilityEnabledCounts: {
        canViewBalance: 10,
        canBroadcast: 3,
        canApproveTransaction: 2,
      },
    });

    const result = await getCollector()(makeContext());
    expect(result.totalRows).toBe(10);
    expect(result.distinctWallets).toBe(4);
    const counts = result.capabilityEnabledCounts as Record<string, number>;
    expect(counts.canViewBalance).toBe(10);
    expect(counts.canBroadcast).toBe(3);
  });

  it('returns error on repository failure', async () => {
    mockGetSupportStats.mockRejectedValue(new Error('db down'));
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('db down');
  });
});
