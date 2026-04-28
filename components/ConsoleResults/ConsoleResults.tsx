import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Brain, AlertTriangle } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWallets } from "../../hooks/queries/useWallets";
import { getTransactions } from "../../src/api/transactions";
import {
  parseConsoleTransactionQueryState,
  type AppliedConsoleTransactionFilter,
  type AppliedConsoleTransactionQuery,
} from "../../src/app/consoleTransactionNavigation";
import { formatApiTransaction } from "../WalletDetail/mappers";
import { TransactionList } from "../TransactionList";
import type { Transaction, Wallet } from "../../types";
import {
  dedupeConsoleTransactions,
  getConsoleTransactionParams,
  sortConsoleTransactions,
  summarizeConsoleTransactionFilters,
} from "./transactionResults";

interface ConsoleResultsRouteState {
  consoleTransactionQuery?: unknown;
}

interface LoadedConsoleTransactions {
  transactions: Transaction[];
  failedWalletIds: string[];
}

interface ConsoleResultsViewModel {
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

export function ConsoleResults() {
  return <ConsoleResultsPage {...useConsoleResultsViewModel()} />;
}

function useConsoleResultsViewModel(): ConsoleResultsViewModel {
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
      navigate(`/wallets/${transaction.walletId}`, {
        state: { activeTab: "tx", highlightTxId: transaction.id },
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

function ConsoleResultsPage(viewModel: ConsoleResultsViewModel) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
      <ConsoleResultsHeader prompt={viewModel.parsedQuery?.prompt} />
      <ConsoleResultsBody {...viewModel} />
    </main>
  );
}

function ConsoleResultsHeader({ prompt }: { prompt?: string }) {
  return (
    <header className="flex flex-col gap-4 border-b border-sanctuary-200 pb-4 dark:border-sanctuary-800 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg surface-secondary text-primary-600 dark:text-primary-400">
          <Brain className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-sanctuary-900 dark:text-sanctuary-100">
            AI Results
          </h1>
          <p className="mt-1 text-sm text-sanctuary-500 dark:text-sanctuary-400">
            Console transaction results
          </p>
        </div>
      </div>
      {prompt ? (
        <p className="max-w-xl rounded-md border border-sanctuary-200 px-3 py-2 text-sm text-sanctuary-700 dark:border-sanctuary-800 dark:text-sanctuary-200">
          {prompt}
        </p>
      ) : null}
    </header>
  );
}

function ConsoleResultsBody(viewModel: ConsoleResultsViewModel) {
  if (!viewModel.rawConsoleQuery) {
    return <EmptyState title="No Console result selected" />;
  }

  if (!viewModel.parsedQuery && !viewModel.walletsLoading) {
    return <EmptyState title="No accessible transaction result" />;
  }

  return <TransactionResultsPanel {...viewModel} />;
}

function TransactionResultsPanel({
  loadingResults,
  isError,
  result,
  transactions,
  summary,
  wallets,
  onWalletClick,
  onTransactionClick,
}: ConsoleResultsViewModel) {
  return (
    <section className="surface-elevated rounded-xl border border-sanctuary-200 p-5 shadow-sm dark:border-sanctuary-800">
      <TransactionResultsPanelHeader
        loadingResults={loadingResults}
        resultCount={transactions.length}
        summary={summary}
      />
      <PartialFailureNotice result={result} />
      <TransactionResultsContent
        loadingResults={loadingResults}
        isError={isError}
        transactions={transactions}
        wallets={wallets}
        onWalletClick={onWalletClick}
        onTransactionClick={onTransactionClick}
      />
    </section>
  );
}

function TransactionResultsPanelHeader({
  loadingResults,
  resultCount,
  summary,
}: {
  loadingResults: boolean;
  resultCount: number;
  summary: string[];
}) {
  return (
    <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <div>
        <h2 className="text-base font-semibold text-sanctuary-900 dark:text-sanctuary-100">
          Transactions
        </h2>
        <SummaryBadges summary={summary} />
      </div>
      <div className="text-sm text-sanctuary-500 dark:text-sanctuary-400">
        <ResultCount loading={loadingResults} count={resultCount} />
      </div>
    </div>
  );
}

function SummaryBadges({ summary }: { summary: string[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {summary.map((item) => (
        <span
          key={item}
          className="rounded-md bg-sanctuary-100 px-2 py-1 text-xs font-medium text-sanctuary-700 dark:bg-sanctuary-800 dark:text-sanctuary-200"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function ResultCount({ loading, count }: { loading: boolean; count: number }) {
  if (loading) return "Loading...";
  return `${count} result${count === 1 ? "" : "s"}`;
}

function PartialFailureNotice({
  result,
}: {
  result?: LoadedConsoleTransactions;
}) {
  if (!result || result.failedWalletIds.length === 0) return null;

  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-warning-200 bg-warning-50 px-3 py-2 text-sm text-warning-800 dark:border-warning-900 dark:bg-warning-950 dark:text-warning-200">
      <AlertTriangle className="h-4 w-4 flex-shrink-0" />
      Some wallet results could not be loaded.
    </div>
  );
}

function TransactionResultsContent({
  loadingResults,
  isError,
  transactions,
  wallets,
  onWalletClick,
  onTransactionClick,
}: {
  loadingResults: boolean;
  isError: boolean;
  transactions: Transaction[];
  wallets: Wallet[];
  onWalletClick: (walletId: string) => void;
  onTransactionClick: (transaction: Transaction) => void;
}) {
  if (loadingResults)
    return <EmptyState title="Loading transaction results..." />;
  if (isError) return <EmptyState title="Failed to load transaction results" />;

  return (
    <TransactionList
      transactions={transactions}
      showWalletBadge
      wallets={wallets}
      canEdit={false}
      onWalletClick={onWalletClick}
      onTransactionClick={onTransactionClick}
    />
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <section className="surface-elevated rounded-xl border border-sanctuary-200 px-5 py-12 text-center text-sm text-sanctuary-500 shadow-sm dark:border-sanctuary-800 dark:text-sanctuary-400">
      {title}
    </section>
  );
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
