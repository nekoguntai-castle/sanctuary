import type { Prisma } from '../../generated/prisma/client';
import config from '../../config';
import { AssistantToolError, type AssistantToolBudget, type AssistantToolTruncation } from './types';

export function parseToolLimit(
  value: string | number | null | undefined,
  budget: AssistantToolBudget,
  fallback = config.mcp.defaultPageSize
): number {
  const maxRows = budget.maxRows ?? config.mcp.maxPageSize;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    return Math.min(fallback, maxRows, config.mcp.maxPageSize);
  }
  return Math.min(parsed, maxRows, config.mcp.maxPageSize);
}

export function parseDateInput(value: string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** Counts the 29 Februaries whose UTC day intersects [start, end]. */
function leapDaysWithin(start: Date, end: Date): number {
  let count = 0;
  for (let year = start.getUTCFullYear(); year <= end.getUTCFullYear(); year++) {
    if (!isLeapYear(year)) {
      continue;
    }
    // setUTCFullYear, unlike Date.UTC, does not map years 0-99 to 1900-1999.
    const leapDay = new Date(0);
    leapDay.setUTCFullYear(year, 1, 29);
    if (leapDay.getTime() <= end.getTime() && leapDay.getTime() + DAY_MS > start.getTime()) {
      count++;
    }
  }
  return count;
}

/**
 * The cap counts days excluding 29 February, so a cap of 365 accepts any whole
 * calendar year while still rejecting a 366-day range with no leap day.
 */
export function enforceDateRange(startDate?: Date, endDate?: Date): void {
  if (!startDate || !endDate) {
    return;
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new AssistantToolError(400, 'Date range end must be on or after start');
  }
  const maxDays = config.mcp.maxDateRangeDays;
  const span = endDate.getTime() - startDate.getTime();
  if (span <= maxDays * DAY_MS) {
    return;
  }
  const exceeded = `Date range exceeds ${maxDays} days`;
  // Fast reject before the leap-day loop: bounds it to the years one cap can span.
  if (span > (maxDays + Math.floor(maxDays / 365) + 1) * DAY_MS) {
    throw new AssistantToolError(400, exceeded);
  }
  if (span > (maxDays + leapDaysWithin(startDate, endDate)) * DAY_MS) {
    throw new AssistantToolError(400, exceeded);
  }
}

export function parseSats(value: null | undefined): undefined;
export function parseSats(value: string | number | bigint): bigint;
export function parseSats(value: string | number | bigint | null | undefined): bigint | undefined;
export function parseSats(value: string | number | bigint | null | undefined): bigint | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'bigint') {
    return value;
  }
  const text = String(value).trim();
  if (!/^-?\d+$/.test(text)) {
    throw new AssistantToolError(400, 'Satoshi amount must be an integer string');
  }
  return BigInt(text);
}

export function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function dateRangeWhere(dateFrom?: string, dateTo?: string): Prisma.DateTimeNullableFilter | undefined {
  const startDate = parseDateInput(dateFrom);
  const endDate = parseDateInput(dateTo);
  enforceDateRange(startDate, endDate);

  if (!startDate && !endDate) {
    return undefined;
  }

  return {
    ...(startDate ? { gte: startDate } : {}),
    ...(endDate ? { lte: endDate } : {}),
  };
}

function parseAmountBounds(
  minAmount?: string | number,
  maxAmount?: string | number
): { min?: bigint; max?: bigint } | undefined {
  const min = parseSats(minAmount);
  const max = parseSats(maxAmount);

  if (min === undefined && max === undefined) {
    return undefined;
  }
  if (min !== undefined && max !== undefined && max < min) {
    throw new AssistantToolError(400, 'Maximum amount must be greater than or equal to minimum amount');
  }
  return { min, max };
}

export function amountWhere(
  minAmount?: string | number,
  maxAmount?: string | number
): Prisma.BigIntFilter | undefined {
  const bounds = parseAmountBounds(minAmount, maxAmount);
  if (!bounds) {
    return undefined;
  }
  const { min, max } = bounds;

  return {
    ...(min !== undefined ? { gte: min } : {}),
    ...(max !== undefined ? { lte: max } : {}),
  };
}

/**
 * Amount filter on the magnitude of Transaction.amount (sent/consolidation rows are stored negative).
 * Always returns the single `{ AND: [{ OR: [...] }] }` shape so it cannot collide with other where keys.
 */
export function transactionMagnitudeWhere(
  minAmount?: string | number,
  maxAmount?: string | number
): { AND: Prisma.TransactionWhereInput[] } | undefined {
  const bounds = parseAmountBounds(minAmount, maxAmount);
  if (!bounds) {
    return undefined;
  }
  const { min, max } = bounds;
  if ((min ?? 0n) < 0n || (max ?? 0n) < 0n) {
    throw new AssistantToolError(400, 'Amount filters are absolute sats');
  }
  if (min === undefined) {
    return { AND: [{ OR: [{ amount: { gte: -(max as bigint), lte: max } }] }] };
  }
  if (max === undefined) {
    return { AND: [{ OR: [{ amount: { gte: min } }, { amount: { lte: -min } }] }] };
  }
  return { AND: [{ OR: [{ amount: { gte: min, lte: max } }, { amount: { gte: -max, lte: -min } }] }] };
}

export function truncateRows<T>(
  rows: T[],
  rowLimit: number
): { rows: T[]; truncation: AssistantToolTruncation } {
  const truncated = rows.length > rowLimit;
  const visibleRows = truncated ? rows.slice(0, rowLimit) : rows;
  return {
    rows: visibleRows,
    truncation: {
      truncated,
      ...(truncated ? { reason: 'row_limit', rowLimit, returnedRows: visibleRows.length } : {}),
    },
  };
}
