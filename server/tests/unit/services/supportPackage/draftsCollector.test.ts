import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDraftStats, mockLockStats, collectorMap } = vi.hoisted(() => ({
  mockDraftStats: vi.fn(),
  mockLockStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  draftRepository: {
    getSupportStats: mockDraftStats,
  },
  draftLockRepository: {
    getSupportStats: mockLockStats,
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

import '../../../../src/services/supportPackage/collectors/drafts';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('drafts collector', () => {
  beforeEach(() => {
    mockDraftStats.mockReset();
    mockLockStats.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('drafts');
    if (!c) throw new Error('drafts collector not registered');
    return c;
  };

  it('registers itself as drafts', () => {
    expect(collectorMap.has('drafts')).toBe(true);
  });

  it('returns draft and lock stats', async () => {
    mockDraftStats.mockResolvedValue({
      total: 8,
      byStatus: { unsigned: 3, partial: 2, signed: 3 },
      byApprovalStatus: { not_required: 6, pending: 2 },
      expired: 1,
      agentLinked: 2,
      rbf: 1,
    });
    mockLockStats.mockResolvedValue({
      total: 10,
      oldestLockAgeMs: 3_600_000,
      distinctDrafts: 5,
    });

    const result = await getCollector()(makeContext());
    expect((result.drafts as any).total).toBe(8);
    expect((result.drafts as any).expired).toBe(1);
    expect((result.locks as any).oldestLockAgeMs).toBe(3_600_000);
    expect((result.locks as any).distinctDrafts).toBe(5);
  });

  it('returns error when either repository fails', async () => {
    mockDraftStats.mockRejectedValue(new Error('draft query failed'));
    mockLockStats.mockResolvedValue({ total: 0, oldestLockAgeMs: null, distinctDrafts: 0 });

    const result = await getCollector()(makeContext());
    expect(result.error).toBe('draft query failed');
  });

  it('never includes recipient addresses, labels, or PSBTs', async () => {
    mockDraftStats.mockResolvedValue({
      total: 1,
      byStatus: { signed: 1 },
      byApprovalStatus: { not_required: 1 },
      expired: 0,
      agentLinked: 0,
      rbf: 0,
    });
    mockLockStats.mockResolvedValue({ total: 1, oldestLockAgeMs: 1000, distinctDrafts: 1 });

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain('recipient');
    expect(json).not.toContain('psbt');
    expect(json).not.toContain('label');
  });
});
