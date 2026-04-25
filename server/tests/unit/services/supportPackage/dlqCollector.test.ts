import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetStats, mockGetAll, collectorMap } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
  mockGetAll: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/services/deadLetterQueue', () => ({
  deadLetterQueue: {
    getStats: () => mockGetStats(),
    getAll: (limit?: number) => mockGetAll(limit),
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/deadLetterQueue';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('deadLetterQueue collector', () => {
  beforeEach(() => {
    mockGetStats.mockReturnValue({ total: 0, byCategory: {} });
    mockGetAll.mockReturnValue([]);
  });

  const getCollector = () => {
    const c = collectorMap.get('deadLetterQueue');
    if (!c) throw new Error('deadLetterQueue collector not registered');
    return c;
  };

  it('registers itself as deadLetterQueue', () => {
    expect(collectorMap.has('deadLetterQueue')).toBe(true);
  });

  it('anonymizes walletId and userId in entry payloads', async () => {
    const realWalletId = 'real-wallet-id-abc';
    const realUserId = 'real-user-id-xyz';

    mockGetAll.mockReturnValue([{
      id: 'dlq-1',
      category: 'telegram',
      operation: 'send_notification',
      payload: { walletId: realWalletId, userId: realUserId, txid: 'abc123' },
      error: 'Timeout',
      attempts: 3,
      firstFailedAt: new Date('2026-04-01'),
      lastFailedAt: new Date('2026-04-02'),
    }]);

    const result = await getCollector()(makeContext());
    const entries = result.recentEntries as any[];
    expect(entries).toHaveLength(1);

    // walletId and userId must be anonymized
    expect(entries[0].payload.walletId).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(entries[0].payload.walletId).not.toBe(realWalletId);
    expect(entries[0].payload.userId).toMatch(/^user-[a-f0-9]{8}$/);
    expect(entries[0].payload.userId).not.toBe(realUserId);

    // txid preserved (public blockchain data)
    expect(entries[0].payload.txid).toBe('abc123');
  });

  it('does not leak raw IDs anywhere in output', async () => {
    const realWalletId = 'uuid-wallet-leak-check';
    const realUserId = 'uuid-user-leak-check';

    mockGetAll.mockReturnValue([{
      id: 'dlq-2',
      category: 'sync',
      operation: 'wallet_sync',
      payload: { walletId: realWalletId, userId: realUserId },
      error: 'Connection refused',
      attempts: 5,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
    }]);

    const result = await getCollector()(makeContext());
    const json = JSON.stringify(result);
    expect(json).not.toContain(realWalletId);
    expect(json).not.toContain(realUserId);
  });

  it('passes limit to getAll', async () => {
    await getCollector()(makeContext());
    expect(mockGetAll).toHaveBeenCalledWith(50);
  });

  it('skips anonymization when walletId/userId are not strings', async () => {
    mockGetAll.mockReturnValue([{
      id: 'dlq-3',
      category: 'sync',
      operation: 'wallet_sync',
      payload: { walletId: 12345, userId: null, extra: 'data' },
      error: 'Timeout',
      attempts: 1,
      firstFailedAt: new Date('2026-04-01'),
      lastFailedAt: new Date('2026-04-02'),
    }]);

    const result = await getCollector()(makeContext());
    const entries = result.recentEntries as any[];
    expect(entries).toHaveLength(1);

    // Non-string walletId/userId should pass through without anonymization
    expect(entries[0].payload.walletId).toBe(12345);
    expect(entries[0].payload.userId).toBeNull();
    expect(entries[0].payload.extra).toBe('data');
  });

  it('skips anonymization when walletId/userId are missing from payload', async () => {
    mockGetAll.mockReturnValue([{
      id: 'dlq-4',
      category: 'push',
      operation: 'send_push',
      payload: { message: 'hello' },
      error: 'Failed',
      attempts: 2,
      firstFailedAt: new Date('2026-04-01'),
      lastFailedAt: new Date('2026-04-02'),
    }]);

    const result = await getCollector()(makeContext());
    const entries = result.recentEntries as any[];
    expect(entries).toHaveLength(1);

    // Missing walletId/userId should not appear in output
    expect(entries[0].payload.walletId).toBeUndefined();
    expect(entries[0].payload.userId).toBeUndefined();
    expect(entries[0].payload.message).toBe('hello');
  });

  it('anonymizes nested BullMQ job data IDs', async () => {
    const realWalletId = 'nested-wallet-id';

    mockGetAll.mockReturnValue([{
      id: 'dlq-5',
      category: 'notification',
      operation: 'notifications:transaction-notify',
      payload: {
        jobId: 'job-1',
        jobName: 'transaction-notify',
        data: { walletId: realWalletId, txid: 'abc123' },
      },
      error: 'No transaction notification channels registered',
      attempts: 5,
      firstFailedAt: new Date('2026-04-01'),
      lastFailedAt: new Date('2026-04-02'),
    }]);

    const result = await getCollector()(makeContext());
    const entries = result.recentEntries as any[];

    expect(entries[0].payload.data.walletId).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(JSON.stringify(result)).not.toContain(realWalletId);
    expect(entries[0].payload.data.txid).toBe('abc123');
  });

  it('anonymizes IDs inside nested arrays in DLQ payloads', async () => {
    const realWalletId = 'array-wallet-id';
    const realUserId = 'array-user-id';

    mockGetAll.mockReturnValue([{
      id: 'dlq-6',
      category: 'notification',
      operation: 'notifications:transaction-notify',
      payload: {
        attempts: [
          { walletId: realWalletId, userId: realUserId },
        ],
      },
      error: 'delivery failed',
      attempts: 1,
      firstFailedAt: new Date('2026-04-01'),
      lastFailedAt: new Date('2026-04-02'),
    }]);

    const result = await getCollector()(makeContext());
    const entries = result.recentEntries as any[];

    expect(entries[0].payload.attempts[0].walletId).toMatch(/^wallet-[a-f0-9]{8}$/);
    expect(entries[0].payload.attempts[0].userId).toMatch(/^user-[a-f0-9]{8}$/);
    expect(JSON.stringify(result)).not.toContain(realWalletId);
    expect(JSON.stringify(result)).not.toContain(realUserId);
  });
});
