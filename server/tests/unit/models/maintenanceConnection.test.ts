/**
 * Unit coverage for the dedicated-connection maintenance helper. The
 * behavioural proof against real PostgreSQL lives in
 * tests/integration/repositories/maintenanceStatementTimeout.test.ts; this
 * file exercises the pure `resolveDefaultStatementTimeout` parsing and the
 * `runDedicatedMaintenance` control flow with a mocked `pg` client.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockConnect, mockQuery, mockEnd, mockClientCtor, mockLogWarn } = vi.hoisted(() => ({
  mockConnect: vi.fn(),
  mockQuery: vi.fn(),
  mockEnd: vi.fn(),
  mockClientCtor: vi.fn(),
  mockLogWarn: vi.fn(),
}));

vi.mock('pg', () => ({
  Client: mockClientCtor,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: mockLogWarn,
    error: vi.fn(),
  }),
}));

import {
  resolveDefaultStatementTimeout,
  runDedicatedMaintenance,
} from '../../../src/models/maintenanceConnection';

describe('resolveDefaultStatementTimeout', () => {
  it('returns 0 when the URL is missing', () => {
    expect(resolveDefaultStatementTimeout(undefined)).toBe('0');
  });

  it('returns 0 when the URL cannot be parsed', () => {
    expect(resolveDefaultStatementTimeout('not a url')).toBe('0');
  });

  it('returns 0 when statement_timeout is not set', () => {
    expect(
      resolveDefaultStatementTimeout('postgresql://user:pass@host:5432/db?connection_limit=30'),
    ).toBe('0');
  });

  it('returns 0 when statement_timeout is not a plain integer', () => {
    expect(
      resolveDefaultStatementTimeout('postgresql://user:pass@host:5432/db?statement_timeout=abc'),
    ).toBe('0');
  });

  it('returns the configured value when statement_timeout is a plain integer', () => {
    expect(
      resolveDefaultStatementTimeout(
        'postgresql://user:pass@host:5432/db?statement_timeout=30000',
      ),
    ).toBe('30000');
  });
});

describe('runDedicatedMaintenance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClientCtor.mockImplementation(function (this: Record<string, unknown>) {
      this.connect = mockConnect;
      this.query = mockQuery;
      this.end = mockEnd;
    });
    mockConnect.mockResolvedValue(undefined);
    mockQuery.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);
  });

  it('opens a dedicated client, binds the timeout, runs fn, and restores the default', async () => {
    const fn = vi.fn().mockResolvedValue('done');

    const result = await runDedicatedMaintenance(12345, fn, {
      databaseUrl: 'postgresql://user:pass@host:5432/db?statement_timeout=30000',
    });

    expect(result).toBe('done');
    expect(mockClientCtor).toHaveBeenCalledWith({
      connectionString: 'postgresql://user:pass@host:5432/db?statement_timeout=30000',
    });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ query: mockQuery }));
    expect(mockQuery.mock.calls[0]).toEqual([
      'SELECT set_config($1, $2, false)',
      ['statement_timeout', '12345'],
    ]);
    expect(mockQuery.mock.calls.at(-1)).toEqual([
      'SELECT set_config($1, $2, false)',
      ['statement_timeout', '30000'],
    ]);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('falls back to process.env.DATABASE_URL when no override is given', async () => {
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';
    try {
      await runDedicatedMaintenance(1000, vi.fn().mockResolvedValue(undefined));
      expect(mockClientCtor).toHaveBeenCalledWith({
        connectionString: 'postgresql://user:pass@host:5432/db',
      });
    } finally {
      process.env.DATABASE_URL = original;
    }
  });

  it('restores the default and closes the connection even when fn throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('maintenance failed'));

    await expect(
      runDedicatedMaintenance(1000, fn, { databaseUrl: 'postgresql://h/db' }),
    ).rejects.toThrow('maintenance failed');

    expect(mockQuery.mock.calls.at(-1)).toEqual([
      'SELECT set_config($1, $2, false)',
      ['statement_timeout', '0'],
    ]);
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('calls afterRestore on the same connection before closing it', async () => {
    const afterRestore = vi.fn().mockResolvedValue(undefined);

    await runDedicatedMaintenance(1000, vi.fn().mockResolvedValue(undefined), {
      databaseUrl: 'postgresql://h/db',
      afterRestore,
    });

    expect(afterRestore).toHaveBeenCalledWith(expect.objectContaining({ query: mockQuery }));
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows a restore failure without masking the original result', async () => {
    mockQuery.mockImplementation(async (sql: string, args?: unknown[]) => {
      if (sql === 'SELECT set_config($1, $2, false)' && Array.isArray(args) && args[1] === '0') {
        throw new Error('restore failed');
      }
      return { rows: [] };
    });

    const result = await runDedicatedMaintenance(1000, vi.fn().mockResolvedValue('ok'), {
      databaseUrl: 'postgresql://h/db',
    });

    expect(result).toBe('ok');
    expect(mockLogWarn).toHaveBeenCalledWith(
      'Failed to restore statement_timeout after maintenance',
      expect.objectContaining({ error: 'restore failed' }),
    );
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });

  it('logs and swallows an afterRestore failure without masking the original error', async () => {
    const afterRestore = vi.fn().mockRejectedValue(new Error('after-restore failed'));

    await expect(
      runDedicatedMaintenance(1000, vi.fn().mockRejectedValue(new Error('fn failed')), {
        databaseUrl: 'postgresql://h/db',
        afterRestore,
      }),
    ).rejects.toThrow('fn failed');

    expect(mockLogWarn).toHaveBeenCalledWith(
      'Failed to restore statement_timeout after maintenance',
      expect.objectContaining({ error: 'after-restore failed' }),
    );
    expect(mockEnd).toHaveBeenCalledTimes(1);
  });
});
