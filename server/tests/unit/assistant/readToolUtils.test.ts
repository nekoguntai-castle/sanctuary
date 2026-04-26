import { describe, expect, it } from 'vitest';
import config from '../../../src/config';
import { AssistantToolError } from '../../../src/assistant/tools';
import {
  amountWhere,
  dateRangeWhere,
  enforceDateRange,
  parseDateInput,
  parseSats,
  parseToolLimit,
  truncateRows,
  uniqueStrings,
} from '../../../src/assistant/tools/utils';

describe('assistant read-tool utilities', () => {
  it('parses row limits within tool and global budgets', () => {
    expect(parseToolLimit(undefined, { maxRows: 10 }, 7)).toBe(7);
    expect(parseToolLimit('abc', { maxRows: 10 }, 7)).toBe(7);
    expect(parseToolLimit(25, { maxRows: 10 }, 7)).toBe(10);
    expect(parseToolLimit(config.mcp.maxPageSize + 1, {}, 7)).toBe(config.mcp.maxPageSize);
  });

  it('parses, validates, and bounds date ranges', () => {
    expect(parseDateInput(undefined)).toBeUndefined();
    expect(parseDateInput('not-a-date')).toBeUndefined();
    expect(parseDateInput('2026-04-26T00:00:00.000Z')?.toISOString()).toBe('2026-04-26T00:00:00.000Z');

    expect(() => enforceDateRange()).not.toThrow();
    expect(() => enforceDateRange(new Date('2026-04-27T00:00:00.000Z'), new Date('2026-04-26T00:00:00.000Z'))).toThrow(
      AssistantToolError
    );
    expect(() => enforceDateRange(new Date('2020-01-01T00:00:00.000Z'), new Date('2026-04-26T00:00:00.000Z'))).toThrow(
      AssistantToolError
    );

    expect(dateRangeWhere()).toBeUndefined();
    expect(dateRangeWhere('2026-04-25T00:00:00.000Z')).toEqual({
      gte: new Date('2026-04-25T00:00:00.000Z'),
    });
    expect(dateRangeWhere(undefined, '2026-04-26T00:00:00.000Z')).toEqual({
      lte: new Date('2026-04-26T00:00:00.000Z'),
    });
  });

  it('parses satoshi filters and rejects invalid amount ranges', () => {
    expect(parseSats(undefined)).toBeUndefined();
    expect(parseSats(null as unknown as undefined)).toBeUndefined();
    expect(parseSats(12n)).toBe(12n);
    expect(parseSats(' 12 ')).toBe(12n);
    expect(() => parseSats('1.5')).toThrow(AssistantToolError);

    expect(amountWhere()).toBeUndefined();
    expect(amountWhere('10')).toEqual({ gte: 10n });
    expect(amountWhere(undefined, 20)).toEqual({ lte: 20n });
    expect(amountWhere('10', 20)).toEqual({ gte: 10n, lte: 20n });
    expect(() => amountWhere('20', 10)).toThrow(AssistantToolError);
  });

  it('deduplicates wallet ids and reports row truncation metadata', () => {
    expect(uniqueStrings(['wallet-1', '', 'wallet-1', 'wallet-2'])).toEqual(['wallet-1', 'wallet-2']);
    expect(truncateRows([1, 2], 3)).toEqual({
      rows: [1, 2],
      truncation: { truncated: false },
    });
    expect(truncateRows([1, 2, 3], 2)).toEqual({
      rows: [1, 2],
      truncation: { truncated: true, reason: 'row_limit', rowLimit: 2, returnedRows: 2 },
    });
  });
});
