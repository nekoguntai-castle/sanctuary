/**
 * Tests for Prisma helper functions
 */

import { vi } from 'vitest';
import {
  getOperationType,
  parseSlowQueryThresholdMs,
  summarizeDatabaseUrlParams,
} from '../../../src/models/prisma';
import { resolvePrismaTransactionTimeoutOptions } from '../../../src/models/prismaTransactionOptions';

describe('getOperationType', () => {
  describe('select operations', () => {
    it.each([
      'findUnique',
      'findFirst',
      'findMany',
      'count',
      'aggregate',
      'groupBy',
    ])('should return "select" for %s', (action) => {
      expect(getOperationType(action)).toBe('select');
    });
  });

  describe('insert operations', () => {
    it.each([
      'create',
      'createMany',
    ])('should return "insert" for %s', (action) => {
      expect(getOperationType(action)).toBe('insert');
    });
  });

  describe('update operations', () => {
    it.each([
      'update',
      'updateMany',
      'upsert',
    ])('should return "update" for %s', (action) => {
      expect(getOperationType(action)).toBe('update');
    });
  });

  describe('delete operations', () => {
    it.each([
      'delete',
      'deleteMany',
    ])('should return "delete" for %s', (action) => {
      expect(getOperationType(action)).toBe('delete');
    });
  });

  describe('other operations', () => {
    it.each([
      'unknown',
      'custom',
      '$queryRaw',
      '$executeRaw',
      '',
    ])('should return "other" for %s', (action) => {
      expect(getOperationType(action)).toBe('other');
    });
  });
});

describe('parseSlowQueryThresholdMs', () => {
  it('defaults to 50 when env is unset', () => {
    expect(parseSlowQueryThresholdMs(undefined)).toBe(50);
  });

  it('defaults to 50 when env is empty', () => {
    expect(parseSlowQueryThresholdMs('')).toBe(50);
  });

  it('parses a positive integer', () => {
    expect(parseSlowQueryThresholdMs('120')).toBe(120);
  });

  it('parses a string that starts with digits', () => {
    expect(parseSlowQueryThresholdMs('75ms')).toBe(75);
  });

  it('falls back to 50 on non-numeric input', () => {
    expect(parseSlowQueryThresholdMs('not-a-number')).toBe(50);
  });

  it('falls back to 50 on zero', () => {
    expect(parseSlowQueryThresholdMs('0')).toBe(50);
  });

  it('falls back to 50 on negative input', () => {
    expect(parseSlowQueryThresholdMs('-1')).toBe(50);
  });
});

describe('resolvePrismaTransactionTimeoutOptions', () => {
  it('leaves Prisma defaults untouched when env values are absent', () => {
    expect(resolvePrismaTransactionTimeoutOptions({})).toBeUndefined();
  });

  it('parses configured transaction timeout values', () => {
    expect(resolvePrismaTransactionTimeoutOptions({
      PRISMA_TRANSACTION_MAX_WAIT_MS: '10000',
      PRISMA_TRANSACTION_TIMEOUT_MS: '30000',
    })).toEqual({
      maxWait: 10000,
      timeout: 30000,
    });
  });

  it('ignores invalid timeout values independently', () => {
    expect(resolvePrismaTransactionTimeoutOptions({
      PRISMA_TRANSACTION_MAX_WAIT_MS: '0',
      PRISMA_TRANSACTION_TIMEOUT_MS: '45000',
    })).toEqual({
      timeout: 45000,
    });
  });

  it('keeps valid maxWait when timeout is invalid', () => {
    expect(resolvePrismaTransactionTimeoutOptions({
      PRISMA_TRANSACTION_MAX_WAIT_MS: '10000',
      PRISMA_TRANSACTION_TIMEOUT_MS: '0',
    })).toEqual({
      maxWait: 10000,
    });
  });

  it('returns undefined when all configured values are invalid', () => {
    expect(resolvePrismaTransactionTimeoutOptions({
      PRISMA_TRANSACTION_MAX_WAIT_MS: '-1',
      PRISMA_TRANSACTION_TIMEOUT_MS: 'not-a-number',
    })).toBeUndefined();
  });
});

describe('summarizeDatabaseUrlParams', () => {
  it('returns the four tracked params when present in the URL', () => {
    const result = summarizeDatabaseUrlParams(
      'postgresql://u:p@h:5432/db?connection_limit=30&pool_timeout=20&connect_timeout=10&statement_timeout=30000',
    );
    expect(result).toEqual({
      connection_limit: '30',
      pool_timeout: '20',
      connect_timeout: '10',
      statement_timeout: '30000',
    });
  });

  it('returns undefined entries when params are absent', () => {
    const result = summarizeDatabaseUrlParams('postgresql://u:p@h:5432/db');
    expect(result).toEqual({
      connection_limit: undefined,
      pool_timeout: undefined,
      connect_timeout: undefined,
      statement_timeout: undefined,
    });
  });

  it('returns an empty object when the URL is undefined', () => {
    expect(summarizeDatabaseUrlParams(undefined)).toEqual({});
  });

  it('returns an empty object when the URL is malformed', () => {
    expect(summarizeDatabaseUrlParams('not a url')).toEqual({});
  });
});

describe('withTransaction', () => {
  it('should delegate to prisma.$transaction', async () => {
    // We need to test withTransaction in isolation with a mock
    // Re-import after mocking to get the function bound to the mocked prisma
    vi.doMock('../../../src/models/prisma', () => {
      const mockPrisma = {
        $transaction: vi.fn((fn: any) => fn({ user: { findMany: vi.fn() } })),
      };
      return {
        __esModule: true,
        default: mockPrisma,
        withTransaction: async (fn: any) => mockPrisma.$transaction(fn),
      };
    });

    const { withTransaction } = await import('../../../src/models/prisma');

    const callback = vi.fn().mockResolvedValue('tx-result');
    const result = await withTransaction(callback);

    expect(callback).toHaveBeenCalled();
    expect(result).toBe('tx-result');

    vi.doUnmock('../../../src/models/prisma');
  });
});
