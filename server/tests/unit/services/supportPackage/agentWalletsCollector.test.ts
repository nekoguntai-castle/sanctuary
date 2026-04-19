import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSupportStats, collectorMap } = vi.hoisted(() => ({
  mockGetSupportStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  agentRepository: {
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

import '../../../../src/services/supportPackage/collectors/agentWallets';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('agentWallets collector', () => {
  beforeEach(() => {
    mockGetSupportStats.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('agentWallets');
    if (!c) throw new Error('agentWallets collector not registered');
    return c;
  };

  it('registers itself as agentWallets', () => {
    expect(collectorMap.has('agentWallets')).toBe(true);
  });

  it('anonymizes agent and wallet ids', async () => {
    mockGetSupportStats.mockResolvedValue({
      agents: [{
        id: 'real-agent-uuid',
        status: 'active',
        fundingWalletId: 'real-funding-wallet',
        operationalWalletId: 'real-ops-wallet',
        lastFundingDraftAt: new Date('2026-04-01'),
        createdAt: new Date('2026-03-01'),
        revokedAt: null,
        requireHumanApproval: true,
        pauseOnUnexpectedSpend: false,
      }],
      alertsByStatusSeverity: [{ status: 'open', severity: 'critical', count: 2 }],
      apiKeyCounts: { total: 3, active: 2 },
      overridesByStatus: { active: 1, used: 4 },
      fundingAttemptsByStatusLast7d: { accepted: 12, rejected: 1 },
    });

    const result = await getCollector()(makeContext());
    const agents = result.agents as any[];
    expect(agents[0].id).toMatch(/^agent-[a-f0-9]{8}$/);
    expect(agents[0].fundingWalletId).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(agents[0].operationalWalletId).toMatch(/^wallet-[a-f0-9]{8}$/);

    const json = JSON.stringify(result);
    expect(json).not.toContain('real-agent-uuid');
    expect(json).not.toContain('real-funding-wallet');
    expect(json).not.toContain('real-ops-wallet');

    expect(result.total).toBe(1);
    expect(result.apiKeys).toEqual({ total: 3, active: 2 });
    expect(result.overridesByStatus).toEqual({ active: 1, used: 4 });
  });

  it('returns error on repository failure', async () => {
    mockGetSupportStats.mockRejectedValue(new Error('db unreachable'));
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('db unreachable');
  });

  it('handles empty agent inventory', async () => {
    mockGetSupportStats.mockResolvedValue({
      agents: [],
      alertsByStatusSeverity: [],
      apiKeyCounts: { total: 0, active: 0 },
      overridesByStatus: {},
      fundingAttemptsByStatusLast7d: {},
    });

    const result = await getCollector()(makeContext());
    expect(result.total).toBe(0);
    expect(result.agents).toEqual([]);
  });

  it('serialises null lastFundingDraftAt and revokedAt as null', async () => {
    mockGetSupportStats.mockResolvedValue({
      agents: [{
        id: 'a1',
        status: 'active',
        fundingWalletId: 'fw',
        operationalWalletId: 'ow',
        lastFundingDraftAt: null,
        createdAt: new Date('2026-03-01'),
        revokedAt: null,
        requireHumanApproval: true,
        pauseOnUnexpectedSpend: false,
      }],
      alertsByStatusSeverity: [],
      apiKeyCounts: { total: 0, active: 0 },
      overridesByStatus: {},
      fundingAttemptsByStatusLast7d: {},
    });

    const result = await getCollector()(makeContext());
    const agents = result.agents as any[];
    expect(agents[0].lastFundingDraftAt).toBeNull();
    expect(agents[0].revokedAt).toBeNull();
  });
});
