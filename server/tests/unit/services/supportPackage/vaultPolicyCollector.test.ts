import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSupportStats, collectorMap } = vi.hoisted(() => ({
  mockGetSupportStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  policyRepository: {
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

import '../../../../src/services/supportPackage/collectors/vaultPolicy';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('vaultPolicy collector', () => {
  beforeEach(() => {
    mockGetSupportStats.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('vaultPolicy');
    if (!c) throw new Error('vaultPolicy collector not registered');
    return c;
  };

  it('registers itself as vaultPolicy', () => {
    expect(collectorMap.has('vaultPolicy')).toBe(true);
  });

  it('returns policy stats on success', async () => {
    mockGetSupportStats.mockResolvedValue({
      totalPolicies: 5,
      enabledPolicies: 4,
      policiesByType: { spending_limit: 2, approval_required: 3 },
      policiesBySourceType: { wallet: 4, system: 1 },
      approvalsByStatus: { pending: 1, approved: 10 },
      eventsByTypeLast7d: { triggered: 3 },
      activeUsageWindows: 2,
    });

    const result = await getCollector()(makeContext());
    expect(result.totalPolicies).toBe(5);
    expect(result.enabledPolicies).toBe(4);
    expect(result.policiesByType).toEqual({ spending_limit: 2, approval_required: 3 });
    expect(result.approvalsByStatus).toEqual({ pending: 1, approved: 10 });
  });

  it('returns error on repository failure', async () => {
    mockGetSupportStats.mockRejectedValue(new Error('db timeout'));

    const result = await getCollector()(makeContext());
    expect(result.error).toBe('db timeout');
  });

  it('does not leak allowlist addresses or policy config', async () => {
    mockGetSupportStats.mockResolvedValue({
      totalPolicies: 1,
      enabledPolicies: 1,
      policiesByType: { address_control: 1 },
      policiesBySourceType: { wallet: 1 },
      approvalsByStatus: {},
      eventsByTypeLast7d: {},
      activeUsageWindows: 0,
    });

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain('bc1q');
    expect(json).not.toContain('allowlist');
    expect(json).not.toContain('config');
  });
});
