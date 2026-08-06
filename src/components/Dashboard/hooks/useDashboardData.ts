import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebSocketTransactionData, WebSocketBalanceData, WebSocketConfirmationData, WebSocketSyncData } from '../../../types';
import * as adminApi from '../../../api/admin';
import { useWebSocket, useWebSocketEvent } from '../../../hooks/websocket';
import { useNotifications } from '../../../contexts/NotificationContext';
import { useNotificationSound } from '../../../hooks/useNotificationSound';
import { useActiveNetwork } from '../../../contexts/ActiveNetworkContext';
import { createLogger } from '../../../utils/logger';
import { useWallets, useRecentTransactions, useInvalidateAllWallets, useUpdateWalletSyncStatus, useBalanceHistory, usePendingTransactions, useActivitySummary } from '../../../hooks/queries/useWallets';
import { useFeeEstimates, useBitcoinStatus, useMempoolData } from '../../../hooks/queries/useBitcoin';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { useDelayedRender } from '../../../hooks/useDelayedRender';
import { useUserPreference } from '../../../hooks/useUserPreference';
import {
  buildBalanceNotification,
  buildBlockNotification,
  buildConfirmationNotification,
  buildMempoolSnapshot,
  buildTransactionNotification,
  countWalletsByNetwork,
  formatFeeRate,
  getFilteredWallets,
  getNodeStatus,
  getSyncWalletId,
  mapApiWalletToDashboardWallet,
  mapRecentTransaction,
  toDashboardFeeEstimate,
} from './dashboardDataModel';

const log = createLogger('Dashboard');

// Stable empty arrays to prevent re-renders when hook data is undefined
const EMPTY_WALLETS: never[] = [];
const EMPTY_TRANSACTIONS: never[] = [];
const EMPTY_PENDING: never[] = [];

export type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

export function useDashboardData() {
  const { btcPrice, priceChange24h, currencySymbol, lastPriceUpdate } = useCurrency();
  const { selectedNetwork } = useActiveNetwork();
  const navigate = useNavigate();
  // Persisted, like the activity page size and unlike the activity page. The
  // reasoning is the same: a *lens* on the data is worth restoring, a
  // *position* within it is not. Now that this period scopes both the balance
  // chart and the activity summary, losing it on every visit is worse still.
  const [timeframe, setTimeframe] = useUserPreference<Timeframe>(
    'viewSettings.dashboard.timeframe',
    '1W'
  );

  // Version check state
  const [versionInfo, setVersionInfo] = useState<adminApi.VersionInfo | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  // Delay chart render to avoid Recharts dimension warning during initial layout
  const chartReady = useDelayedRender();

  // Check for updates on mount
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const info = await adminApi.checkVersion();
        setVersionInfo(info);
      } catch (err) {
        log.warn('Failed to check for updates', { error: err });
      }
    };
    checkForUpdates();
  }, []);

  // WebSocket integration
  const { connected: wsConnected, state: wsState, subscribeWallets, unsubscribeWallets, subscribe, unsubscribe } = useWebSocket();
  const { addNotification } = useNotifications();
  const { playEventSound } = useNotificationSound();
  const invalidateAllWallets = useInvalidateAllWallets();
  const updateWalletSyncStatus = useUpdateWalletSyncStatus();

  // React Query hooks for data fetching
  const { data: apiWallets, isLoading: walletsLoading } = useWallets();
  const { data: feeEstimates } = useFeeEstimates(selectedNetwork);
  const { data: bitcoinStatus, isLoading: statusLoading } = useBitcoinStatus(selectedNetwork);
  const { data: mempoolData, refetch: refetchMempool, isFetching: mempoolRefreshing } = useMempoolData(selectedNetwork);

  // Use stable empty arrays when data is undefined to prevent re-renders
  const safeApiWallets = apiWallets ?? EMPTY_WALLETS;

  // Convert API wallets to component format (with network)
  const wallets = useMemo(() => (
    safeApiWallets.map(mapApiWalletToDashboardWallet)
  ), [safeApiWallets]);

  // Filter wallets by selected network and sort by balance (highest first)
  const filteredWallets = useMemo(() => (
    getFilteredWallets(wallets, selectedNetwork)
  ), [wallets, selectedNetwork]);

  // Count wallets per network for tabs
  const walletCounts = useMemo(() => countWalletsByNetwork(wallets), [wallets]);

  // Filtered wallet IDs for network-specific data
  const filteredWalletIds = useMemo(() => filteredWallets.map(w => w.id), [filteredWallets]);

  // Fetch recent transactions for selected network only.
  //
  // Page size persists, the current page does not: returning to the dashboard
  // on page 4 of an activity list you have not looked at in a week is
  // disorienting, and the rows underneath will have moved anyway.
  const [activityPageSize, setActivityPageSize] = useUserPreference(
    'viewSettings.dashboard.activityPageSize',
    10
  );
  const [activityPage, setActivityPage] = useState(0);

  // Page 1 is the only page guaranteed to exist for a different network or a
  // different page size, so both reset rather than landing on an empty page.
  useEffect(() => {
    setActivityPage(0);
  }, [selectedNetwork, activityPageSize]);

  const recentActivity = useRecentTransactions(filteredWalletIds, activityPageSize, activityPage);
  const recentTxRaw = recentActivity.data ?? EMPTY_TRANSACTIONS;

  // If invalidation shrinks the result set while the reader is past the first
  // page, step back rather than stranding them on an empty page with a
  // previous-page button as the only way out.
  useEffect(() => {
    if (
      !recentActivity.isFetching &&
      activityPage > 0 &&
      recentTxRaw.length === 0
    ) {
      setActivityPage(current => Math.max(0, current - 1));
    }
  }, [recentActivity.isFetching, activityPage, recentTxRaw.length]);

  // Headline figures for the collapsed Recent Activity bar. Scoped to the same
  // period the balance chart uses, and to the same wallets.
  const { data: activitySummary, isError: activitySummaryError } = useActivitySummary(
    filteredWalletIds,
    timeframe
  );

  // Fetch pending transactions for selected network only
  const { data: pendingTxsData } = usePendingTransactions(filteredWalletIds);
  const pendingTxs = pendingTxsData ?? EMPTY_PENDING;

  // Unconfirmed sats, tracked per direction rather than netted. A single signed
  // total would render +100k in / -100k out as "nothing pending", and
  // +100k / -99k as "1,000 incoming" — both hide real mempool exposure.
  // `amount` is already negative for sends
  // (server/src/api/transactions/walletTransactions/pending.ts). Fees are a
  // sibling field and are NOT included here; this is an indicator, not an
  // accounting figure.
  const pendingTotals = useMemo(() => {
    let incoming = 0;
    let outgoing = 0;
    for (const tx of pendingTxs) {
      if (tx.amount >= 0) {
        incoming += tx.amount;
      } else {
        outgoing += -tx.amount;
      }
    }
    return { incoming, outgoing };
  }, [pendingTxs]);

  const isMainnet = selectedNetwork === 'mainnet';

  // Convert API transactions to component format
  const recentTx = useMemo(() => recentTxRaw.map(mapRecentTransaction), [recentTxRaw]);

  // Derive fees from React Query data
  const fees = toDashboardFeeEstimate(feeEstimates);

  // Derive node status from Bitcoin status
  const nodeStatus = getNodeStatus(statusLoading, bitcoinStatus);

  // Derive mempool blocks from React Query data
  const { mempoolBlocks, queuedBlocksSummary, lastMempoolUpdate } = buildMempoolSnapshot(mempoolData);

  // Overall loading state
  const loading = walletsLoading && wallets.length === 0;

  // 24h price change from CoinGecko (via CurrencyContext)
  const priceChangePositive = priceChange24h !== null && priceChange24h >= 0;

  // Function to refresh mempool/block data
  const refreshMempoolData = () => {
    refetchMempool();
  };

  // Subscribe to active-network wallet events (single batch message for efficiency)
  useEffect(() => {
    if (filteredWallets.length > 0) {
      const walletIds = filteredWallets.map(wallet => wallet.id);
      subscribeWallets(walletIds);
    }
    // Cleanup: unsubscribe from all wallets when effect re-runs or component unmounts
    return () => {
      if (filteredWallets.length > 0) {
        const walletIds = filteredWallets.map(wallet => wallet.id);
        unsubscribeWallets(walletIds);
      }
    };
  }, [filteredWallets, subscribeWallets, unsubscribeWallets]);

  // Refetch wallet data when window becomes visible (handles missed WS events)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Refetch wallet data to get current sync status
        invalidateAllWallets();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [invalidateAllWallets]);

  // Refetch wallet data when WebSocket reconnects (handles missed events during disconnection)
  useEffect(() => {
    if (wsConnected) {
      // Small delay to ensure subscriptions are complete
      const timer = setTimeout(() => {
        invalidateAllWallets();
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [wsConnected, invalidateAllWallets]);

  // Subscribe to global block/mempool channel for real-time updates
  useEffect(() => {
    subscribe('blocks');
    subscribe('mempool');
    return () => {
      unsubscribe('blocks');
      unsubscribe('mempool');
    };
  }, [subscribe, unsubscribe]);

  // Note: Periodic mempool refresh is handled by React Query's refetchInterval

  // Handle transaction notifications
  useWebSocketEvent('transaction', (event) => {
    const data = event.data as WebSocketTransactionData;
    const { notification, sound } = buildTransactionNotification(data);

    addNotification(notification);
    if (sound) {
      playEventSound(sound);
    }

    // Invalidate wallet queries to refresh data
    invalidateAllWallets();
  }, [addNotification, invalidateAllWallets, playEventSound]);

  // Handle balance updates
  useWebSocketEvent('balance', (event) => {
    const data = event.data as WebSocketBalanceData;
    const notification = buildBalanceNotification(data);

    if (notification) {
      addNotification(notification);
    }

    // Invalidate wallet queries to refresh data
    invalidateAllWallets();
  }, [addNotification, invalidateAllWallets]);

  // Handle new block notifications
  useWebSocketEvent('block', (event) => {
    const data = event.data as { height: number; transactionCount?: number };

    addNotification(buildBlockNotification(data));

    // Refresh mempool data when a new block is mined
    refreshMempoolData();
  }, [addNotification, refreshMempoolData]);

  // Handle confirmation updates
  useWebSocketEvent('confirmation', (event) => {
    const data = event.data as WebSocketConfirmationData & { previousConfirmations?: number };
    const notificationResult = buildConfirmationNotification(data);

    if (notificationResult) {
      addNotification(notificationResult.notification);
      if (notificationResult.sound) {
        playEventSound(notificationResult.sound);
      }
    }

    // Refresh wallet data to update confirmation counts in the UI
    invalidateAllWallets();
  }, [addNotification, playEventSound, invalidateAllWallets]);

  // Handle sync status changes - update syncInProgress in real-time
  useWebSocketEvent('sync', (event) => {
    const data = event.data as WebSocketSyncData;
    const walletId = getSyncWalletId(data);

    // Directly update the cache for immediate UI response
    // This is more reliable than invalidating + refetching
    if (walletId) {
      updateWalletSyncStatus(walletId, data.inProgress ?? false, data.status);
    }
  }, [updateWalletSyncStatus]);

  // Calculate total balance for filtered wallets (network-specific)
  const totalBalance = filteredWallets.reduce((acc, w) => acc + w.balance, 0);

  // Use the balance history hook for accurate chart data (filtered by network)
  const { data: balanceHistoryData } = useBalanceHistory(filteredWalletIds, totalBalance, timeframe);

  // Convert to chart format (value -> sats for tooltip compatibility)
  const chartData = useMemo(() =>
    balanceHistoryData.map(d => ({ name: d.name, sats: d.value })),
    [balanceHistoryData]
  );

  return {
    // Currency
    btcPrice,
    priceChange24h,
    currencySymbol,
    lastPriceUpdate,
    priceChangePositive,

    // Navigation
    navigate,
    selectedNetwork,

    // Version
    versionInfo,
    updateDismissed,
    setUpdateDismissed,

    // Chart
    chartReady,
    timeframe,
    setTimeframe,
    chartData,

    // WebSocket
    wsConnected,
    wsState,

    // Data
    wallets,
    filteredWallets,
    walletCounts,
    recentTx,
    activityPage: recentActivity.page,
    activityPageSize,
    activityHasNextPage: recentActivity.hasNextPage,
    activityHasPreviousPage: recentActivity.hasPreviousPage,
    activityFetching: recentActivity.isFetching,
    activitySummary,
    activitySummaryError,
    setActivityPage,
    setActivityPageSize,
    pendingTxs,
    pendingTotals,
    fees,
    formatFeeRate,
    nodeStatus,
    bitcoinStatus,
    mempoolBlocks,
    queuedBlocksSummary,
    lastMempoolUpdate,
    mempoolRefreshing,
    totalBalance,

    // State
    loading,
    isMainnet,

    // Actions
    refreshMempoolData,
  };
}
