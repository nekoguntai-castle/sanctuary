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
  transactionMagnitudeWhere,
  truncateRows,
  uniqueStrings,
} from '../../../src/assistant/tools/utils';

function expectRangeAccepted(start: string, end: string): void {
  expect(() => enforceDateRange(new Date(start), new Date(end))).not.toThrow();
}

function expectRangeRejected(start: string, end: string): void {
  expect(() => enforceDateRange(new Date(start), new Date(end))).toThrow('Date range exceeds 365 days');
}

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

  describe('date-range cap and leap days', () => {
    it('runs with the default 365-day cap', () => {
      expect(config.mcp.maxDateRangeDays).toBe(365);
    });

    it('accepts a full leap year, including through dateRangeWhere', () => {
      for (const year of ['2024', '2028', '2000']) {
        const start = `${year}-01-01T00:00:00.000Z`;
        const end = `${year}-12-31T23:59:59.999Z`;
        expectRangeAccepted(start, end);
        expect(dateRangeWhere(start, end)).toStrictEqual({ gte: new Date(start), lte: new Date(end) });
      }
    });

    it('does not count a 29 February inside the range against the cap', () => {
      expectRangeAccepted('2027-03-01T00:00:00.000Z', '2028-02-29T23:59:59.999Z');
      expectRangeAccepted('2023-02-28T00:00:00.000Z', '2024-02-29T00:00:00.000Z');
      expectRangeAccepted('2024-02-29T12:00:00.000Z', '2025-03-01T11:59:59.999Z');
      expectRangeAccepted('0048-01-01T00:00:00.000Z', '0048-12-31T23:59:59.999Z');
    });

    it('still rejects ranges longer than the cap plus the leap days they contain', () => {
      expectRangeAccepted('2025-01-01T00:00:00.000Z', '2025-12-31T23:59:59.999Z');
      expectRangeRejected('2025-03-01T00:00:00.000Z', '2026-03-01T23:59:59.999Z');
      expectRangeAccepted('1900-01-01T00:00:00.000Z', '1900-12-31T23:59:59.999Z');
      expectRangeRejected('1900-01-01T00:00:00.000Z', '1901-01-01T23:59:59.999Z');
      expectRangeRejected('2024-01-01T00:00:00.000Z', '2025-01-01T00:00:00.001Z');
      expectRangeRejected('2024-03-01T00:00:00.000Z', '2025-03-01T23:59:59.999Z');
      expectRangeRejected('2023-02-28T00:00:00.000Z', '2024-02-28T23:59:59.999Z');
      expectRangeRejected('2004-01-01T00:00:00.000Z', '2024-01-01T00:00:00.000Z');
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

  describe('transactionMagnitudeWhere', () => {
    type Clause = { amount: { gte?: bigint; lte?: bigint } };
    const matches = (
      where: ReturnType<typeof transactionMagnitudeWhere>,
      amount: bigint
    ): boolean =>
      ((where?.AND as { OR: Clause[] }[])[0].OR).some(
        ({ amount: b }) => (b.gte === undefined || amount >= b.gte) && (b.lte === undefined || amount <= b.lte)
      );
    const amounts = [-200000n, -500n, 0n, 500n, 200000n];

    it('returns undefined without bounds and rejects invalid ranges', () => {
      expect(transactionMagnitudeWhere()).toBeUndefined();
      expect(() => transactionMagnitudeWhere('20', 10)).toThrow(AssistantToolError);
      expect(() => transactionMagnitudeWhere('-5')).toThrow('Amount filters are absolute sats');
      expect(() => transactionMagnitudeWhere(undefined, '-5')).toThrow('Amount filters are absolute sats');
    });

    it('builds one AND/OR shape for every bound combination', () => {
      expect(transactionMagnitudeWhere('10')).toEqual({ AND: [{ OR: [{ amount: { gte: 10n } }, { amount: { lte: -10n } }] }] });
      expect(transactionMagnitudeWhere(undefined, 20)).toEqual({ AND: [{ OR: [{ amount: { gte: -20n, lte: 20n } }] }] });
      expect(transactionMagnitudeWhere('10', 20)).toEqual({
        AND: [{ OR: [{ amount: { gte: 10n, lte: 20n } }, { amount: { gte: -20n, lte: -10n } }] }],
      });
    });

    it('matches on absolute amount regardless of direction', () => {
      expect(amounts.filter((a) => matches(transactionMagnitudeWhere(100000), a))).toEqual([-200000n, 200000n]);
      expect(amounts.filter((a) => matches(transactionMagnitudeWhere(undefined, 1000), a))).toEqual([-500n, 0n, 500n]);
      expect(amounts.filter((a) => matches(transactionMagnitudeWhere(0), a))).toEqual(amounts);
    });
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
