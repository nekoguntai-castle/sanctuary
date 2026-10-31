import type { Transaction } from "../../types";
import type { GetTransactionsParams } from "../../api/transactions";
import type { usePriceFreeFormatter } from "../../contexts/CurrencyContext";
import {
  hasAmountFilter,
  type AppliedConsoleTransactionFilter,
} from "../../app/consoleTransactionNavigation";

export const CONSOLE_TRANSACTION_RESULT_LIMIT = 100;
/**
 * The wallet transactions endpoint has no amount filter, so an amount-bounded
 * query scans this many of the wallet's newest rows in range and filters here.
 * It is a per-wallet fetch size, independent of CONSOLE_TRANSACTION_LIMIT_CAP
 * (the cap on a query's requested row limit) even though both are 500.
 */
export const CONSOLE_AMOUNT_SCAN_LIMIT = 500;

function displayLimit(filter: AppliedConsoleTransactionFilter): number {
  return filter.limit ?? CONSOLE_TRANSACTION_RESULT_LIMIT;
}

function fetchLimit(filter: AppliedConsoleTransactionFilter): number {
  return hasAmountFilter(filter) ? CONSOLE_AMOUNT_SCAN_LIMIT : displayLimit(filter);
}

/** Absolute sats, inclusive, matching the Console's query_transactions. */
function matchesAmountFilter(
  transaction: Transaction,
  filter: AppliedConsoleTransactionFilter,
): boolean {
  const magnitude = Math.abs(transaction.amount);
  if (filter.minAmount !== null && magnitude < filter.minAmount) return false;
  return filter.maxAmount === null || magnitude <= filter.maxAmount;
}

/**
 * Applies the amount filter and row limit to one wallet's fetched page.
 * `truncated` means the wallet may hold more matches than are shown: the
 * fetched page was full (or the default cap cut matches off) and the
 * Console's own explicit limit was not what stopped the list.
 */
export function selectConsoleWalletTransactions(
  filter: AppliedConsoleTransactionFilter,
  fetched: Transaction[],
): { transactions: Transaction[]; truncated: boolean } {
  const matched = fetched.filter((tx) => matchesAmountFilter(tx, filter));
  const limit = displayLimit(filter);
  const satisfiedExplicitLimit =
    filter.limit !== null && matched.length >= filter.limit;
  const truncated =
    !satisfiedExplicitLimit &&
    (fetched.length >= fetchLimit(filter) || matched.length > limit);

  return { transactions: matched.slice(0, limit), truncated };
}

export function getConsoleTransactionParams(
  filter: AppliedConsoleTransactionFilter,
): GetTransactionsParams {
  return {
    limit: fetchLimit(filter),
    offset: 0,
    ...(filter.dateFrom !== null
      ? { dateFrom: new Date(filter.dateFrom).toISOString() }
      : {}),
    ...(filter.dateTo !== null
      ? { dateTo: new Date(filter.dateTo).toISOString() }
      : {}),
    ...(filter.type ? { type: filter.type } : {}),
  };
}

export function sortConsoleTransactions(
  transactions: Transaction[],
): Transaction[] {
  return [...transactions].sort(
    (left, right) => getTransactionMillis(right) - getTransactionMillis(left),
  );
}

function summarizeDateRange(
  filters: AppliedConsoleTransactionFilter[],
): string | null {
  const fromValues = uniqueNumbers(filters.map((filter) => filter.dateFrom));
  const toValues = uniqueNumbers(filters.map((filter) => filter.dateTo));

  if (fromValues.length > 1 || toValues.length > 1) return "Mixed dates";
  if (fromValues.length === 0 && toValues.length === 0) return null;

  const from = fromValues[0];
  const to = toValues[0];
  if (from !== undefined && to !== undefined) {
    return `${formatDate(from)} - ${formatDate(to)}`;
  }
  if (from !== undefined) return `From ${formatDate(from)}`;

  return `Through ${formatDate(to!)}`;
}

function summarizeTypes(
  filters: AppliedConsoleTransactionFilter[],
): string | null {
  const types = Array.from(
    new Set(filters.map((filter) => filter.type).filter(Boolean)),
  );
  if (types.length === 0) return null;
  if (types.length > 1) return "Mixed types";

  return types[0]!;
}

export type ConsoleAmountFormatter = ReturnType<typeof usePriceFreeFormatter>["format"];

function summarizeAmounts(
  filters: AppliedConsoleTransactionFilter[],
  format: ConsoleAmountFormatter,
): string | null {
  const keys = new Set(
    filters.map((filter) => `${filter.minAmount ?? ""}:${filter.maxAmount ?? ""}`),
  );
  if (keys.size > 1) return "Mixed amounts";

  const { minAmount, maxAmount } = filters[0]!;
  if (minAmount !== null && maxAmount !== null) {
    return `${format(minAmount)} - ${format(maxAmount)}`;
  }
  if (minAmount !== null) return `\u2265 ${format(minAmount)}`;
  if (maxAmount !== null) return `\u2264 ${format(maxAmount)}`;

  return null;
}

function uniqueNumbers(values: Array<number | null>): number[] {
  return Array.from(
    new Set(values.filter((value): value is number => value !== null)),
  );
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function getTransactionMillis(transaction: Transaction): number {
  if (typeof transaction.timestamp === "number") return transaction.timestamp;
  if (transaction.blockTime) {
    const parsed = Date.parse(transaction.blockTime);
    if (Number.isFinite(parsed)) return parsed;
  }

  return 0;
}

export function summarizeConsoleTransactionFilters(
  filters: AppliedConsoleTransactionFilter[],
  format: ConsoleAmountFormatter,
): string[] {
  const summary = [
    `${filters.length} wallet${filters.length === 1 ? "" : "s"}`,
  ];
  const dateSummary = summarizeDateRange(filters);
  const typeSummary = summarizeTypes(filters);
  const amountSummary = summarizeAmounts(filters, format);

  if (dateSummary) summary.push(dateSummary);
  if (typeSummary) summary.push(typeSummary);
  if (amountSummary) summary.push(amountSummary);

  return summary;
}

export function dedupeConsoleTransactions(
  transactions: Transaction[],
): Transaction[] {
  const seen = new Set<string>();
  const unique: Transaction[] = [];

  for (const transaction of transactions) {
    const key = `${transaction.walletId}:${transaction.txid || transaction.id}`;
    if (seen.has(key)) continue;

    seen.add(key);
    unique.push(transaction);
  }

  return unique;
}
