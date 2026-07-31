import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useWallets } from "../../hooks/queries/useWallets";
import { getTransactions } from "../../src/api/transactions";
import {
  parseConsoleTransactionQueryState,
  type AppliedConsoleTransactionFilter,
  type AppliedConsoleTransactionQuery,
} from "../../src/app/consoleTransactionNavigation";
import { formatApiTransaction } from "../WalletDetail/mappers";
import type { Transaction, Wallet } from "../../types";
import {
  dedupeConsoleTransactions,
  getConsoleTransactionParams,
  sortConsoleTransactions,
  summarizeConsoleTransactionFilters,
} from "./transactionResults";

export interface ConsoleResultsRouteState {
  consoleTransactionQuery?: unknown;
}

export interface LoadedConsoleTransactions {
  transactions: Transaction[];
  failedWalletIds: string[];
}

export interface ConsoleResultsViewModel {
  rawConsoleQuery: unknown;
  parsedQuery: AppliedConsoleTransactionQuery | null;
  walletsLoading: boolean;
  loadingResults: boolean;
  isError: boolean;
  result?: LoadedConsoleTransactions;
  transactions: Transaction[];
  summary: string[];
  wallets: Wallet[];
  onWalletClick: (walletId: string) => void;
  onTransactionClick: (transaction: Transaction) => void;
}

const EMPTY_TRANSACTIONS: Transaction[] = [];

export function useConsoleResultsViewModel(): ConsoleResultsViewModel {
  const location = useLocation();
  const navigate = useNavigate();
  const { data: wallets = [], isLoading: walletsLoading } = useWallets();
  const routeState = location.state as ConsoleResultsRouteState | null;
  const rawConsoleQuery = routeState?.consoleTransactionQuery;

  const walletIds = useMemo(
    () => new Set(wallets.map((wallet) => wallet.id)),
    [wallets],
  );
  const parsedQuery = useMemo(
    () =>
      walletsLoading
        ? parseConsoleTransactionQueryState(rawConsoleQuery)
        : parseConsoleTransactionQueryState(rawConsoleQuery, walletIds),
    [rawConsoleQuery, walletIds, walletsLoading],
  );

  const transactionQuery = useQuery({
    queryKey: ["console-results", "transactions", parsedQuery?.walletFilters],
    queryFn: () => loadConsoleTransactions(parsedQuery!),
    enabled: Boolean(parsedQuery && !walletsLoading),
  });
  const result = transactionQuery.data;
  const transactions = result?.transactions ?? EMPTY_TRANSACTIONS;
  const loadingResults = walletsLoading || transactionQuery.isLoading;
  const summary = parsedQuery
    ? summarizeConsoleTransactionFilters(parsedQuery.walletFilters)
    : [];
  const onWalletClick = useCallback(
    (walletId: string) => navigate(`/wallets/${walletId}`),
    [navigate],
  );
  const onTransactionClick = useCallback(
    (transaction: Transaction) =>
      navigate(`/wallets/${transaction.walletId}?tx=${encodeURIComponent(transaction.txid)}`, {
        state: { activeTab: "tx" },
      }),
    [navigate],
  );

  return {
    rawConsoleQuery,
    parsedQuery,
    walletsLoading,
    loadingResults,
    isError: transactionQuery.isError,
    result,
    transactions,
    summary,
    wallets,
    onWalletClick,
    onTransactionClick,
  };
}

async function loadConsoleTransactions(
  query: AppliedConsoleTransactionQuery,
): Promise<LoadedConsoleTransactions> {
  const settled = await Promise.allSettled(
    query.walletFilters.map(loadWalletTransactions),
  );
  const transactions = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value.transactions : [],
  );
  const failedWalletIds = settled.flatMap((result, index) =>
    result.status === "rejected" ? [query.walletFilters[index]!.walletId] : [],
  );

  if (transactions.length === 0 && failedWalletIds.length === settled.length) {
    throw new Error("Failed to load transaction results");
  }

  return {
    transactions: sortConsoleTransactions(
      dedupeConsoleTransactions(transactions),
    ),
    failedWalletIds,
  };
}

async function loadWalletTransactions(
  filter: AppliedConsoleTransactionFilter,
): Promise<{ walletId: string; transactions: Transaction[] }> {
  const transactions = await getTransactions(
    filter.walletId,
    getConsoleTransactionParams(filter),
  );

  return {
    walletId: filter.walletId,
    transactions: transactions.map((transaction) =>
      formatApiTransaction(transaction, filter.walletId),
    ),
  };
}
