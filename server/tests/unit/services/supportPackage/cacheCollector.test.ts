import { describe, it, expect, vi } from 'vitest';

const { collectorMap } = vi.hoisted(() => ({
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

const mockStats = { hits: 100, misses: 20, sets: 50, deletes: 5, size: 30 };

vi.mock('../../../../src/services/cache', () => ({
  cache: { getStats: () => ({ ...mockStats }) },
  walletCache: { getStats: () => ({ ...mockStats, hits: 200 }) },
  priceCache: { getStats: () => ({ ...mockStats, hits: 50 }) },
  feeCache: { getStats: () => ({ ...mockStats, hits: 10 }) },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/cache';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('cache collector', () => {
  const getCollector = () => {
    const c = collectorMap.get('cache');
    if (!c) throw new Error('cache collector not registered');
    return c;
  };

  it('registers itself as cache', () => {
    expect(collectorMap.has('cache')).toBe(true);
  });

  it('returns stats for all cache namespaces', async () => {
    const result = await getCollector()(makeContext());
    const caches = result.caches as Record<string, any>;
    expect(caches.default.hits).toBe(100);
    expect(caches.wallet.hits).toBe(200);
    expect(caches.price.hits).toBe(50);
    expect(caches.fee.hits).toBe(10);
  });
});
