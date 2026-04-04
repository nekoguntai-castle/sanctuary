import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockFindMany, collectorMap } = vi.hoisted(() => ({
  mockFindMany: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories/db', () => ({
  db: {
    wallet: { findMany: (...args: unknown[]) => mockFindMany(...args) },
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/wallets';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('wallets collector', () => {
  beforeEach(() => {
    mockFindMany.mockResolvedValue([]);
  });

  const getCollector = () => {
    const c = collectorMap.get('wallets');
    if (!c) throw new Error('wallets collector not registered');
    return c;
  };

  it('registers itself as wallets', () => {
    expect(collectorMap.has('wallets')).toBe(true);
  });

  it('anonymizes wallet IDs', async () => {
    mockFindMany.mockResolvedValue([{
      id: 'real-wallet-uuid-123',
      type: 'multi_sig',
      network: 'mainnet',
      lastSyncStatus: 'success',
      lastSyncedAt: new Date('2026-04-01'),
      lastSyncError: null,
      syncInProgress: false,
      _count: { addresses: 10, transactions: 50 },
    }]);

    const result = await getCollector()(makeContext());
    const wallets = result.wallets as any[];
    expect(wallets).toHaveLength(1);

    // ID must be anonymized
    expect(wallets[0].id).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(wallets[0].id).not.toContain('real-wallet-uuid-123');

    // Non-sensitive data preserved
    expect(wallets[0].type).toBe('multi_sig');
    expect(wallets[0].network).toBe('mainnet');
    expect(wallets[0].addressCount).toBe(10);
    expect(wallets[0].transactionCount).toBe(50);
  });

  it('does not leak raw wallet IDs anywhere in output', async () => {
    const realId = 'uuid-that-should-not-appear';
    mockFindMany.mockResolvedValue([{
      id: realId,
      type: 'single_sig',
      network: 'testnet',
      lastSyncStatus: null,
      lastSyncedAt: null,
      lastSyncError: null,
      syncInProgress: false,
      _count: { addresses: 0, transactions: 0 },
    }]);

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain(realId);
  });
});
