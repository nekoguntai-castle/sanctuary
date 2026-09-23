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
  const { data: wallets = [], isLoading: loading } = useWallets();
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
    filteredWallets,
    sortedWallets,
    totalBalance,
    walletIds,
    pendingByWallet,
    walletsWithPending,
    sparklineData,
  };
}
