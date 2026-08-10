import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetStats, mockGetAll, collectorMap } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
  mockGetAll: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/walletLogBuffer', () => ({
  walletLogBuffer: {
    getStats: () => mockGetStats(),
    getAll: () => mockGetAll(),
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/walletLogs';
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

describe('walletLogs collector', () => {
  beforeEach(() => {
    mockGetStats.mockReturnValue({ walletCount: 0, totalEntries: 0 });
    mockGetAll.mockReturnValue(new Map());
  });

  const getCollector = () => {
    const collector = collectorMap.get('walletLogs');
    if (!collector) throw new Error('walletLogs collector not registered');
    return collector;
  };

  it('registers itself as walletLogs', () => {
    expect(collectorMap.has('walletLogs')).toBe(true);
  });

  it('returns stats and empty wallets when buffer is empty', async () => {
    const result = await getCollector()(makeContext());
    expect(result.stats).toEqual({ walletCount: 0, totalEntries: 0 });
    expect(result.wallets).toEqual({});
  });

  it('anonymizes wallet IDs in keys and log messages', async () => {
    const realWalletId = 'real-wallet-uuid-123';
    const entries = [
      {
        id: 'log-1',
        timestamp: '2026-04-04T10:00:00Z',
        level: 'info',
        module: 'TELEGRAM',
        message: `Sent notification for wallet ${realWalletId}`,
        details: { txid: 'abc123' },
      },
    ];

    mockGetStats.mockReturnValue({ walletCount: 1, totalEntries: 1 });
    mockGetAll.mockReturnValue(new Map([[realWalletId, entries]]));

    const ctx = makeContext();
    const result = await getCollector()(ctx);
    const wallets = result.wallets as Record<string, any[]>;

    // Key should be anonymized
    const keys = Object.keys(wallets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(keys[0]).not.toContain(realWalletId);

    // Message should have real ID replaced with anonymized ID
    const logEntry = wallets[keys[0]][0];
    expect(logEntry.message).not.toContain(realWalletId);
    expect(logEntry.message).toContain(keys[0]);
  });

  it('handles entries with non-string message field', async () => {
    const realWalletId = 'wallet-uuid-no-msg';
    const entries = [
      {
        id: 'log-2',
        timestamp: '2026-04-04T11:00:00Z',
        level: 'warn',
        module: 'SYNC',
        details: { code: 'ERR_TIMEOUT' },
        // no message field at all
      },
      {
        id: 'log-3',
        timestamp: '2026-04-04T11:01:00Z',
        level: 'error',
        module: 'SYNC',
        message: 42, // non-string message
        details: {},
      },
    ];

    mockGetStats.mockReturnValue({ walletCount: 1, totalEntries: 2 });
    mockGetAll.mockReturnValue(new Map([[realWalletId, entries]]));

    const ctx = makeContext();
    const result = await getCollector()(ctx);
    const wallets = result.wallets as Record<string, any[]>;

    const keys = Object.keys(wallets);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^wallet-[a-f0-9]{8}$/);

    // Entry without message field should still be present
    expect(wallets[keys[0]]).toHaveLength(2);
    expect(wallets[keys[0]][0].message).toBeUndefined();
    // Entry with non-string message should preserve the value as-is
    expect(wallets[keys[0]][1].message).toBe(42);
  });
});
