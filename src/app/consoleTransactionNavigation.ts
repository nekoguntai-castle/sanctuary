import type { ConsoleTurnResult } from "../api/console";

export type ConsoleTransactionType = "sent" | "received" | "consolidation";

export interface ConsoleTransactionFilterState {
  walletId: string;
  dateFrom?: string;
  dateTo?: string;
  type?: ConsoleTransactionType;
}

export interface AppliedConsoleTransactionFilter {
  walletId: string;
  dateFrom: number | null;
  dateTo: number | null;
  type: ConsoleTransactionType | null;
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TX_TYPES = new Set<ConsoleTransactionType>([
  "sent",
  "received",
  "consolidation",
]);

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

function plannedToolCalls(
  result: ConsoleTurnResult,
): Record<string, unknown>[] {
  const plannedTools = result.turn.plannedTools;
  if (!isRecord(plannedTools) || !Array.isArray(plannedTools.toolCalls)) {
    return [];
  }

  return plannedTools.toolCalls.filter(isRecord);
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
  const filters: ConsoleTransactionFilterState[] = [];

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

    filters.push({
      walletId,
      ...(dateFrom ? { dateFrom } : {}),
      ...(dateTo ? { dateTo } : {}),
      ...(type ? { type } : {}),
    });
  }

  return filters.length === 1 ? filters[0] : null;
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
