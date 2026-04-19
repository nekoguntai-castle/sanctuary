import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSupportStats, collectorMap } = vi.hoisted(() => ({
  mockGetSupportStats: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  mcpApiKeyRepository: {
    getSupportStats: mockGetSupportStats,
  },
}));

vi.mock('../../../../src/config', () => ({
  default: {
    mcp: {
      enabled: true,
      host: '127.0.0.1',
      port: 3003,
      rateLimitPerMinute: 120,
    },
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

import '../../../../src/services/supportPackage/collectors/mcp';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('mcp collector', () => {
  beforeEach(() => {
    mockGetSupportStats.mockReset();
  });

  const getCollector = () => {
    const c = collectorMap.get('mcp');
    if (!c) throw new Error('mcp collector not registered');
    return c;
  };

  it('registers itself as mcp', () => {
    expect(collectorMap.has('mcp')).toBe(true);
  });

  it('returns config and key bucket stats', async () => {
    mockGetSupportStats.mockResolvedValue({
      total: 3,
      active: 2,
      revoked: 1,
      expired: 0,
      lastUsedBuckets: { within24h: 1, within7d: 1, older: 0, never: 1 },
    });

    const result = await getCollector()(makeContext());
    expect(result.enabled).toBe(true);
    expect(result.port).toBe(3003);
    const keys = result.keys as Record<string, unknown>;
    expect(keys.total).toBe(3);
    expect(keys.active).toBe(2);
    expect(keys.lastUsedBuckets).toEqual({ within24h: 1, within7d: 1, older: 0, never: 1 });
  });

  it('never exposes key hashes or prefixes', async () => {
    mockGetSupportStats.mockResolvedValue({
      total: 1,
      active: 1,
      revoked: 0,
      expired: 0,
      lastUsedBuckets: { within24h: 0, within7d: 0, older: 0, never: 1 },
    });

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain('keyHash');
    expect(json).not.toContain('keyPrefix');
  });

  it('returns error on repository failure', async () => {
    mockGetSupportStats.mockRejectedValue(new Error('pg connection refused'));
    const result = await getCollector()(makeContext());
    expect(result.error).toBe('pg connection refused');
    expect(result.enabled).toBe(true);
  });
});
