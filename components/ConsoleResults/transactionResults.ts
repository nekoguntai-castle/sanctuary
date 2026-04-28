import type { Transaction } from "../../types";
import type { GetTransactionsParams } from "../../src/api/transactions";
import type { AppliedConsoleTransactionFilter } from "../../src/app/consoleTransactionNavigation";

export const CONSOLE_TRANSACTION_RESULT_LIMIT = 100;

export function getConsoleTransactionParams(
  filter: AppliedConsoleTransactionFilter,
): GetTransactionsParams {
  return {
    limit: filter.limit ?? CONSOLE_TRANSACTION_RESULT_LIMIT,
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
): string[] {
  const summary = [
    `${filters.length} wallet${filters.length === 1 ? "" : "s"}`,
  ];
  const dateSummary = summarizeDateRange(filters);
  const typeSummary = summarizeTypes(filters);

  if (dateSummary) summary.push(dateSummary);
  if (typeSummary) summary.push(typeSummary);

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
