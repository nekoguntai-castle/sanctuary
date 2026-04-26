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

export function enforceDateRange(startDate?: Date, endDate?: Date): void {
  if (!startDate || !endDate) {
    return;
  }
  if (endDate.getTime() < startDate.getTime()) {
    throw new AssistantToolError(400, 'Date range end must be on or after start');
  }
  const maxMs = config.mcp.maxDateRangeDays * 24 * 60 * 60 * 1000;
  if (endDate.getTime() - startDate.getTime() > maxMs) {
    throw new AssistantToolError(400, `Date range exceeds ${config.mcp.maxDateRangeDays} days`);
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

export function amountWhere(
  minAmount?: string | number,
  maxAmount?: string | number
): Prisma.BigIntFilter | undefined {
  const min = parseSats(minAmount);
  const max = parseSats(maxAmount);

  if (min === undefined && max === undefined) {
    return undefined;
  }
  if (min !== undefined && max !== undefined && max < min) {
    throw new AssistantToolError(400, 'Maximum amount must be greater than or equal to minimum amount');
  }

  return {
    ...(min !== undefined ? { gte: min } : {}),
    ...(max !== undefined ? { lte: max } : {}),
  };
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
