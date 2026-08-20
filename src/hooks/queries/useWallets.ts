import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as walletsApi from '../../api/wallets';
import * as transactionsApi from '../../api/transactions';
import { createQueryKeys, createListQuery, createMutation, createInvalidateAll } from './factory';

// Stable empty arrays to prevent re-renders when data is loading
const EMPTY_TRANSACTIONS: Awaited<ReturnType<typeof transactionsApi.getTransactions>> = [];
const EMPTY_PENDING: Awaited<ReturnType<typeof transactionsApi.getPendingTransactions>> = [];

// Base keys from factory, extended with wallet-specific sub-resources
const baseKeys = createQueryKeys('wallets');

// Query key factory for wallet-related queries
// Note: Params are spread into the key array to ensure stable references
export const walletKeys = {
  ...baseKeys,
  utxos: (id: string) => [...baseKeys.all, 'utxos', id] as const,
  addresses: (id: string) => [...baseKeys.all, 'addresses', id] as const,
  transactions: (id: string, params?: { page?: number; limit?: number; offset?: number }) =>
    [...baseKeys.all, 'transactions', id, params?.page, params?.limit, params?.offset] as const,
  balance: (id: string) => [...baseKeys.all, 'balance', id] as const,
};

/**
 * Hook to fetch all wallets for the current user
 */
export const useWallets = createListQuery(walletKeys, walletsApi.getWallets);

/**
 * Hook to create a new wallet
 */
export const useCreateWallet = createMutation(walletsApi.createWallet, {
  invalidateKeys: [walletKeys.lists()],
});

/**
 * Hook to import a wallet
 */
export const useImportWallet = createMutation(walletsApi.importWallet, {
  invalidateKeys: [walletKeys.lists()],
});

/**
 * Hook to fetch recent transactions across all wallets
 * Uses single API call to /transactions/recent endpoint for efficiency
 */
export function useRecentTransactions(
  walletIds: string[],
  pageSize: number = 10,
  page: number = 0
) {
  // Create stable key from wallet IDs
  const walletIdsKey = walletIds.join(',');

  // One row beyond the page is all it takes to know whether a next page exists,
  // and it costs one row instead of a second COUNT query over every wallet.
  const requestLimit = pageSize + 1;
  const offset = page * pageSize;

  const query = useQuery({
    queryKey: ['recentTransactions', walletIdsKey, pageSize, page],
    queryFn: async () => {
      if (walletIds.length === 0) return [];
      // Single API call - server handles aggregation and sorting
      return transactionsApi.getRecentTransactions(requestLimit, walletIds, offset);
    },
    enabled: walletIds.length > 0,
    // Hold the previous page's rows while the next one loads, so the table does
    // not collapse and reflow between clicks. Deliberately scoped to the same
    // wallet set: switching network must show that network's activity or
    // nothing, never the previous network's rows.
    placeholderData: (previousData, previousQuery) => {
      const previousWalletsKey = (previousQuery?.queryKey as unknown[] | undefined)?.[1];
      return previousWalletsKey === walletIdsKey ? previousData : undefined;
    },
  });

  const rows = walletIds.length === 0 ? EMPTY_TRANSACTIONS : (query.data ?? EMPTY_TRANSACTIONS);
  const hasNextPage = rows.length > pageSize;

  return {
    // When no wallets selected (empty array), always return empty - don't show stale data
    data: hasNextPage ? rows.slice(0, pageSize) : rows,
    page,
    pageSize,
    hasPreviousPage: page > 0,
    hasNextPage,
    // Distinguishes "first ever load" from "loading the next page": the latter
    // still has rows on screen, so the controls disable rather than the table
    // disappearing.
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Hook to fetch pending (unconfirmed) transactions across all wallets
 * Used for block queue visualization showing user's transactions in mempool
 * Refreshes every 30 seconds to match mempool data updates
 *
 * Uses single useQuery with Promise.all to avoid render loop from useQueries
 */
export function usePendingTransactions(walletIds: string[]) {
  // Create stable key from wallet IDs
  const walletIdsKey = walletIds.join(',');

  const query = useQuery({
    queryKey: ['pendingTransactions', walletIdsKey],
    queryFn: async () => {
      if (walletIds.length === 0) return [];
      // Fetch all wallets in parallel, single state update when all complete
      const results = await Promise.all(
        walletIds.map((walletId) => transactionsApi.getPendingTransactions(walletId))
      );
      // Aggregate and sort by fee rate (higher first)
      return results.flat().sort((a, b) => b.feeRate - a.feeRate);
    },
    enabled: walletIds.length > 0,
    refetchInterval: 30000, // 30 seconds
    staleTime: 15000, // Consider data stale after 15 seconds
    // Don't keep previous data when wallet IDs change - show empty for new networks
  });

  return {
    // When no wallets selected (empty array), always return empty - don't show stale data
    data: walletIds.length === 0 ? EMPTY_PENDING : (query.data ?? EMPTY_PENDING),
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/**
 * Helper to invalidate all wallets data
 * Returns a stable function reference to prevent re-renders
 */
export const useInvalidateAllWallets = createInvalidateAll(walletKeys, [
  ['recentTransactions'],
  ['pendingTransactions'],
  ['balanceHistory'],
]);

/**
 * Helper to directly update wallet sync status in cache
 * This provides immediate UI update without waiting for refetch
 */
export function useUpdateWalletSyncStatus() {
  const queryClient = useQueryClient();

  return useCallback((walletId: string, syncInProgress: boolean, lastSyncStatus?: string) => {
    // Only a success moves the clock. Stamping "now" on every terminal event —
    // a failure included — made the list claim a wallet had just synced while
    // the detail page showed the failure that ended it.
    const syncedAtPatch = !syncInProgress && lastSyncStatus === 'success'
      ? { lastSyncedAt: new Date().toISOString() }
      : {};

    // Update the wallet list cache
    queryClient.setQueryData(walletKeys.lists(), (oldData: walletsApi.Wallet[] | undefined) => {
      if (!oldData) return oldData;
      return oldData.map(wallet =>
        wallet.id === walletId
          ? {
              ...wallet,
              syncInProgress,
              ...(lastSyncStatus && { lastSyncStatus }),
              ...syncedAtPatch,
            }
          : wallet
      );
    });

    // Also update the individual wallet cache if it exists
    queryClient.setQueryData(walletKeys.detail(walletId), (oldData: walletsApi.Wallet | undefined) => {
      if (!oldData) return oldData;
      return {
        ...oldData,
        syncInProgress,
        ...(lastSyncStatus && { lastSyncStatus }),
        ...syncedAtPatch,
      };
    });
  }, [queryClient]);
}

type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

/**
 * Hook to fetch all transactions from all wallets for balance history chart
 * Matches the Dashboard chart behavior with timeframe filtering
 *
 * Uses single useQuery with Promise.all to avoid render loop from useQueries
 */
export function useBalanceHistory(
  walletIds: string[],
  totalBalance: number,
  timeframe: Timeframe
) {
  // Create stable key from wallet IDs
  const walletIdsKey = walletIds.join(',');

  const query = useQuery({
    queryKey: ['balanceHistory', walletIdsKey, timeframe, totalBalance],
    queryFn: async () => {
      if (walletIds.length === 0) return [];
      return transactionsApi.getBalanceHistory(timeframe, totalBalance, walletIds);
    },
    enabled: walletIds.length > 0,
    staleTime: 60000, // Consider stale after 1 minute
    // Don't keep previous data when wallet IDs change - show fresh for new networks
  });

  // Memoize default data to prevent re-renders when query.data is undefined
  const defaultData = useMemo(() => [
    { name: 'Start', value: totalBalance },
    { name: 'Now', value: totalBalance },
  ], [totalBalance]);

  return {
    // When no wallets selected (empty array), always return default - don't show stale data
    data: walletIds.length === 0 ? defaultData : (query.data ?? defaultData),
    isLoading: query.isLoading,
    isError: query.isError,
    // `defaultData` is a flat line from `totalBalance` to `totalBalance`. With
    // no wallets that is honest — there is no history to draw. Substituted for
    // a *failed* request it asserts the balance did not move over the period,
    // which is a claim about the user's money that nobody made. Say when the
    // series is that placeholder rather than real history.
    //
    // React Query keeps the last good `data` through a failed refetch, so only
    // the absence of any series means we never got one.
    isUnavailable: walletIds.length > 0 && query.isError && query.data === undefined,
  };
}

/**
 * Hook to fetch confirmed activity totals for the selected dashboard period.
 *
 * Deliberately not derived from useRecentTransactions: that returns a page and
 * never counts the whole set, so any total taken from it would be invented.
 *
 * Resolves to `undefined` until the query settles rather than to a zeroed
 * placeholder — a summary bar reading "0 txns" while loading states something
 * false about the user's money.
 */
export function useActivitySummary(walletIds: string[], timeframe: Timeframe) {
  const walletIdsKey = walletIds.join(',');

  const query = useQuery({
    queryKey: ['activitySummary', walletIdsKey, timeframe],
    queryFn: async () => transactionsApi.getActivitySummary(timeframe, walletIds),
    enabled: walletIds.length > 0,
    // Matches the endpoint's own 30s cache; refetching faster than that would
    // only re-read the same cached aggregate.
    staleTime: 30000,
  });

  return {
    // Never show one wallet set's figures under another's heading.
    data: walletIds.length === 0 ? undefined : query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}

export type WalletSparklineResult =
  | { status: 'ready'; values: [number, number, ...number[]] }
  | { status: 'unavailable' }
  | { status: 'error' };

type WalletSparklineInput = readonly [id: string, balance: number];

function sortedSparklineInputs(
  wallets: Array<{ id: string; balance: number }>
): WalletSparklineInput[] {
  return wallets
    .map(({ id, balance }) => [id, balance] as const)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId));
}

function unavailableSparklines(inputs: WalletSparklineInput[]) {
  return Object.fromEntries(
    inputs.map(([id]) => [id, { status: 'unavailable' } as const])
  ) as Record<string, WalletSparklineResult>;
}

async function fetchSparkline(
  [id, balance]: WalletSparklineInput
): Promise<[string, WalletSparklineResult]> {
  try {
    const history = await transactionsApi.getBalanceHistory('1W', balance, [id]);
    if (history.length < 2) return [id, { status: 'unavailable' }];
    const values = history.map(({ value }) => value) as [number, number, ...number[]];
    return [id, { status: 'ready', values }];
  } catch {
    return [id, { status: 'error' }];
  }
}

/**
 * Hook to fetch per-wallet balance sparkline data for grid cards
 * Uses a single useQuery with Promise.all to batch all per-wallet requests
 */
export function useWalletSparklines(
  wallets: Array<{ id: string; balance: number }>
) {
  const inputs = sortedSparklineInputs(wallets);

  const query = useQuery({
    queryKey: ['walletSparklines', inputs],
    queryFn: async () => {
      const results = await Promise.all(inputs.map(fetchSparkline));
      return Object.fromEntries(results) as Record<string, WalletSparklineResult>;
    },
    enabled: inputs.length > 0,
    staleTime: 120000,
  });

  return query.data ?? unavailableSparklines(inputs);
}

/**
 * Hook to update a wallet
 * Uses manual mutation because it needs dynamic detail key invalidation based on walletId
 */
export function useUpdateWallet() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ walletId, data }: { walletId: string; data: walletsApi.UpdateWalletRequest }) =>
      walletsApi.updateWallet(walletId, data),
    onSuccess: (_data, { walletId }) => {
      queryClient.invalidateQueries({ queryKey: walletKeys.detail(walletId) });
      queryClient.invalidateQueries({ queryKey: walletKeys.lists() });
    },
  });
}
