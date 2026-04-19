import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockQueryRaw, mockGetMigrationHead, collectorMap } = vi.hoisted(() => ({
  mockQueryRaw: vi.fn(),
  mockGetMigrationHead: vi.fn(),
  collectorMap: new Map<string, (ctx: any) => Promise<Record<string, unknown>>>(),
}));

vi.mock('../../../../src/repositories', () => ({
  maintenanceRepository: {
    getTableStats: mockQueryRaw,
    getMigrationHead: mockGetMigrationHead,
  },
}));

vi.mock('../../../../src/utils/errors', () => ({
  getErrorMessage: (e: unknown) => e instanceof Error ? e.message : String(e),
  bigIntToNumberOrZero: (v: bigint | number | null | undefined) => {
    if (v === null || v === undefined) return 0;
    return Number(v);
  },
}));

vi.mock('../../../../src/services/supportPackage/collectors/registry', () => ({
  registerCollector: (name: string, fn: (ctx: any) => Promise<Record<string, unknown>>) => {
    collectorMap.set(name, fn);
  },
}));

import '../../../../src/services/supportPackage/collectors/database';
import { createAnonymizer } from '../../../../src/services/supportPackage/anonymizer';
import type { CollectorContext } from '../../../../src/services/supportPackage/types';

function makeContext(): CollectorContext {
  return { anonymize: createAnonymizer('test-salt'), generatedAt: new Date() };
}

describe('database collector', () => {
  beforeEach(() => {
    mockQueryRaw.mockReset();
    mockGetMigrationHead.mockReset();
    mockGetMigrationHead.mockResolvedValue(null);
  });

  const getCollector = () => {
    const c = collectorMap.get('database');
    if (!c) throw new Error('database collector not registered');
    return c;
  };

  it('registers itself as database', () => {
    expect(collectorMap.has('database')).toBe(true);
  });

  it('returns table row counts on success', async () => {
    mockQueryRaw.mockResolvedValue([
      { relname: 'wallets', n_live_tup: BigInt(150) },
      { relname: 'transactions', n_live_tup: BigInt(5000) },
      { relname: 'users', n_live_tup: BigInt(3) },
    ]);

    const result = await getCollector()(makeContext());
    const tables = result.tables as Record<string, number>;
    expect(tables.wallets).toBe(150);
    expect(tables.transactions).toBe(5000);
    expect(tables.users).toBe(3);
    expect(result).not.toHaveProperty('error');
  });

  it('returns error and empty tables on failure', async () => {
    mockQueryRaw.mockRejectedValue(new Error('connection refused'));

    const result = await getCollector()(makeContext());
    expect(result.error).toBe('connection refused');
    expect(result.tables).toEqual({});
  });

  it('includes migration head when available', async () => {
    mockQueryRaw.mockResolvedValue([]);
    mockGetMigrationHead.mockResolvedValue({
      migrationName: '20260419_add_agent_wallets',
      finishedAt: new Date('2026-04-19T10:00:00.000Z'),
    });

    const result = await getCollector()(makeContext());
    expect(result.migrationHead).toEqual({
      migrationName: '20260419_add_agent_wallets',
      finishedAt: '2026-04-19T10:00:00.000Z',
    });
  });

  it('isolates migration head failure from table stats success', async () => {
    mockQueryRaw.mockResolvedValue([{ relname: 'users', n_live_tup: BigInt(1) }]);
    mockGetMigrationHead.mockRejectedValue(new Error('migrations table missing'));

    const result = await getCollector()(makeContext());
    expect(result.tables).toEqual({ users: 1 });
    expect(result.migrationHead).toEqual({ error: 'migrations table missing' });
  });
});
