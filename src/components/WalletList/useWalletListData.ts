import { useMemo } from 'react';
import type { TabNetwork } from '../NetworkTabs';
import { useWallets, usePendingTransactions, useWalletSparklines } from '../../hooks/queries/useWallets';
import type { Timeframe } from '../../api/transactions/types';
import type { WalletSortField, WalletSortOrder } from './types';
import {
  attachPendingData,
  buildPendingByWallet,
  filterWalletsByNetwork,
  sortWallets,
  totalWalletBalance,
  walletIds as getWalletIds,
} from './walletListData';

const EMPTY_WALLETS: NonNullable<ReturnType<typeof useWallets>['data']> = [];

export function useWalletListData({
  selectedNetwork,
  sortBy,
  sortOrder,
  timeframe,
}: {
  selectedNetwork: TabNetwork;
  sortBy: WalletSortField;
  sortOrder: WalletSortOrder;
  timeframe: Timeframe;
}) {
  const { data, isLoading: loading, isError, refetch } = useWallets();
  const wallets = data ?? EMPTY_WALLETS;
  // A failed background refetch must not hide a list that is already populated.
  const loadFailed = isError && !data;
  const filteredWallets = useMemo(
    () => filterWalletsByNetwork(wallets, selectedNetwork),
    [wallets, selectedNetwork]
  );
  const sortedWallets = useMemo(
    () => sortWallets(filteredWallets, sortBy, sortOrder),
    [filteredWallets, sortBy, sortOrder]
  );
  const totalBalance = useMemo(() => totalWalletBalance(filteredWallets), [filteredWallets]);
  const walletIds = useMemo(() => getWalletIds(filteredWallets), [filteredWallets]);
  const { data: pendingTransactions } = usePendingTransactions(walletIds);
  const sparklineData = useWalletSparklines(filteredWallets, timeframe);
  const pendingByWallet = useMemo(
    () => buildPendingByWallet(pendingTransactions),
    [pendingTransactions]
  );
  const walletsWithPending = useMemo(
    () => attachPendingData(sortedWallets, pendingByWallet),
    [sortedWallets, pendingByWallet]
  );

  return {
    wallets,
    loading,
    loadFailed,
    refetch,
    filteredWallets,
    sortedWallets,
    totalBalance,
    walletIds,
    pendingByWallet,
    walletsWithPending,
    sparklineData,
  };
}
