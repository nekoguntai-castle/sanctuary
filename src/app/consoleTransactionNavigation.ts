import type { ConsoleTurnResult } from "../api/console";
import type { NaturalQueryResult } from "../api/ai";
import {
  PERSISTED_TRANSACTION_TYPES,
  type TransactionFilterType,
} from "@sanctuary/shared/constants/transactions";

export type ConsoleTransactionType = TransactionFilterType;

export interface ConsoleTransactionFilterState {
  walletId: string;
  dateFrom?: string;
  dateTo?: string;
  type?: ConsoleTransactionType;
  limit?: number;
  /** Absolute sats, inclusive, as query_transactions applies them. */
  minAmount?: number;
  maxAmount?: number;
}

export interface ConsoleTransactionQueryState {
  walletFilters: ConsoleTransactionFilterState[];
  prompt?: string;
}

export interface AppliedConsoleTransactionFilter {
  walletId: string;
  dateFrom: number | null;
  dateTo: number | null;
  type: ConsoleTransactionType | null;
  limit: number | null;
  minAmount: number | null;
  maxAmount: number | null;
}

export interface AppliedConsoleTransactionQuery {
  walletFilters: AppliedConsoleTransactionFilter[];
  prompt?: string;
}

/** The most rows a Console transaction query may ask for. */
export const CONSOLE_TRANSACTION_LIMIT_CAP = 500;

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TX_TYPES = new Set<ConsoleTransactionType>(PERSISTED_TRANSACTION_TYPES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseTransactionType(value: unknown): ConsoleTransactionType | null {
  const type = getString(value);
  return type && TX_TYPES.has(type as ConsoleTransactionType)
    ? (type as ConsoleTransactionType)
    : null;
}

function parseLimit(value: unknown): number | null {
  const parsed =
    typeof value === "number" ? value : Number(getString(value) ?? Number.NaN);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;

  return Math.min(parsed, CONSOLE_TRANSACTION_LIMIT_CAP);
}

/** Whole non-negative sats, the only amount form query_transactions accepts. */
function parseSatsAmount(value: unknown): number | null {
  const text =
    typeof value === "number" ? String(value) : getString(value);
  if (!text || !/^\d+$/.test(text)) return null;

  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function plannedToolCalls(
  result: ConsoleTurnResult,
): Record<string, unknown>[] {
  const plannedTools = result.turn.plannedTools;
  if (!isRecord(plannedTools) || !Array.isArray(plannedTools.toolCalls)) {
    return [];
  }

  return plannedTools.toolCalls.filter(isRecord);
}

function transactionFilterKey(filter: ConsoleTransactionFilterState): string {
  return [
    filter.walletId,
    filter.dateFrom ?? "",
    filter.dateTo ?? "",
    filter.type ?? "",
    filter.limit ?? "",
    filter.minAmount ?? "",
    filter.maxAmount ?? "",
  ].join("\u0000");
}

function collectConsoleTransactionFilters(
  result: ConsoleTurnResult,
  allowedWalletIds: ReadonlySet<string>,
): ConsoleTransactionFilterState[] {
  const filters: ConsoleTransactionFilterState[] = [];
  const seen = new Set<string>();

  for (const call of plannedToolCalls(result)) {
    if (call.name !== "query_transactions" || !isRecord(call.input)) {
      continue;
    }

    const walletId = getString(call.input.walletId);
    if (!walletId || !allowedWalletIds.has(walletId)) {
      continue;
    }

    const dateFrom = getString(call.input.dateFrom);
    const dateTo = getString(call.input.dateTo);
    const type = parseTransactionType(call.input.type);
    const limit = parseLimit(call.input.limit);
    const minAmount = parseSatsAmount(call.input.minAmount);
    const maxAmount = parseSatsAmount(call.input.maxAmount);
    const filter = {
      walletId,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(type ? { type } : {}),
      ...(limit ? { limit } : {}),
      ...(minAmount !== null ? { minAmount } : {}),
      ...(maxAmount !== null ? { maxAmount } : {}),
    };
    const key = transactionFilterKey(filter);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    filters.push(filter);
  }

  return filters;
}

export function parseTransactionDateMillis(
  value: unknown,
  endOfDay: boolean,
): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const text = getString(value);
  if (!text) return null;

  const dateOnly = DATE_ONLY_PATTERN.exec(text);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]) - 1;
    const day = Number(dateOnly[3]);
    return endOfDay
      ? Date.UTC(year, month, day, 23, 59, 59, 999)
      : Date.UTC(year, month, day, 0, 0, 0, 0);
  }

  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function extractConsoleTransactionFilter(
  result: ConsoleTurnResult,
  allowedWalletIds: ReadonlySet<string>,
): ConsoleTransactionFilterState | null {
  const filters = collectConsoleTransactionFilters(result, allowedWalletIds);

  return filters.length === 1 ? filters[0] : null;
}

export function extractConsoleTransactionQuery(
  result: ConsoleTurnResult,
  allowedWalletIds: ReadonlySet<string>,
): ConsoleTransactionQueryState | null {
  const walletFilters = collectConsoleTransactionFilters(
    result,
    allowedWalletIds,
  );
  if (walletFilters.length === 0) return null;

  const prompt = getString(result.turn.prompt);
  return {
    walletFilters,
    ...(prompt ? { prompt } : {}),
  };
}

export function parseConsoleTransactionFilterState(
  value: unknown,
): AppliedConsoleTransactionFilter | null {
  if (!isRecord(value)) return null;

  const walletId = getString(value.walletId);
  if (!walletId) return null;

  return {
    walletId,
    dateFrom: parseTransactionDateMillis(value.dateFrom, false),
    dateTo: parseTransactionDateMillis(value.dateTo, true),
    type: parseTransactionType(value.type),
    limit: parseLimit(value.limit),
    minAmount: parseSatsAmount(value.minAmount),
    maxAmount: parseSatsAmount(value.maxAmount),
  };
}

export function hasAmountFilter(filter: AppliedConsoleTransactionFilter): boolean {
  return filter.minAmount !== null || filter.maxAmount !== null;
}

/**
 * The wallet transactions table has no amount or row-limit controls, so the
 * Console's amount bounds and limit ride on the AI filter, which applies both
 * (absolute sats, inclusive) and shows a clearable summary over the list.
 */
export function consoleFilterAsAiQuery(
  filter: AppliedConsoleTransactionFilter,
): NaturalQueryResult | null {
  const hasAmount = hasAmountFilter(filter);
  if (!hasAmount && filter.limit === null) return null;

  return {
    type: "transactions",
    ...(hasAmount
      ? {
          filter: {
            ...(filter.minAmount !== null ? { minAmount: filter.minAmount } : {}),
            ...(filter.maxAmount !== null ? { maxAmount: filter.maxAmount } : {}),
          },
        }
      : {}),
    ...(filter.limit !== null ? { limit: filter.limit } : {}),
  };
}

export function parseConsoleTransactionQueryState(
  value: unknown,
  allowedWalletIds?: ReadonlySet<string>,
): AppliedConsoleTransactionQuery | null {
  if (!isRecord(value) || !Array.isArray(value.walletFilters)) return null;

  const walletFilters = value.walletFilters
    .map(parseConsoleTransactionFilterState)
    .filter((filter): filter is AppliedConsoleTransactionFilter => {
      return Boolean(
        filter && (!allowedWalletIds || allowedWalletIds.has(filter.walletId)),
      );
    });

  if (walletFilters.length === 0) return null;

  const prompt = getString(value.prompt);
  return {
    walletFilters,
    ...(prompt ? { prompt } : {}),
  };
}

export function walletIdFromWalletRoute(
  pathname: string,
  allowedWalletIds: ReadonlySet<string>,
): string | null {
  const match = /^\/wallets\/([^/?#]+)/.exec(pathname);
  if (!match) return null;

  const walletId = decodeURIComponent(match[1]!);
  return allowedWalletIds.has(walletId) ? walletId : null;
}
