import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { WebSocketTransactionData, WebSocketBalanceData, WebSocketConfirmationData } from '../../../types';
import * as adminApi from '../../../api/admin';
import { useWebSocket, useWebSocketEvent } from '../../../hooks/websocket';
import { useNotifications } from '../../../contexts/NotificationContext';
import { useNotificationSound } from '../../../hooks/useNotificationSound';
import { useActiveNetwork } from '../../../contexts/ActiveNetworkContext';
import { createLogger } from '../../../utils/logger';
import { useWallets, useRecentTransactions, useInvalidateAllWallets, useBalanceHistory, usePendingTransactions, useActivitySummary } from '../../../hooks/queries/useWallets';
import { useFeeEstimates, useBitcoinStatus, useMempoolData } from '../../../hooks/queries/useBitcoin';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { useDelayedRender } from '../../../hooks/useDelayedRender';
import { useUserPreference } from '../../../hooks/useUserPreference';
import {
  buildBalanceNotification,
  buildBlockNotification,
  buildConfirmationNotification,
  buildMempoolSnapshot,
  buildNodeStatusQueryData,
  buildTransactionNotification,
  countWalletsByNetwork,
  formatFeeRate,
  getFilteredWallets,
  getNodeStatus,
  mapApiWalletToDashboardWallet,
  mapRecentTransaction,
  toDashboardFeeEstimate,
  neverAnswered,
} from './dashboardDataModel';
import { useNodeStatusFreshness } from './useNodeStatusFreshness';

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

  // React Query hooks for data fetching
  const { data: apiWallets, isLoading: walletsLoading, isError: walletsFetchFailed } = useWallets();
  const { data: feeEstimates, isError: feesError } = useFeeEstimates(selectedNetwork);
  const bitcoinStatusQuery = useBitcoinStatus(selectedNetwork);
  const { data: bitcoinStatus, isLoading: statusLoading } = bitcoinStatusQuery;
  const { data: mempoolData, refetch: refetchMempool, isFetching: mempoolRefreshing, isError: mempoolFetchFailed } = useMempoolData(selectedNetwork);

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
  const { data: pendingTxsData, isError: pendingFetchFailed } = usePendingTransactions(filteredWalletIds);
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

  // Normalized data → presenter boundary for the node status card (PR B
  // interface contract). Query-derived fields first; the freshness verdict
  // (isLastKnown) is layered on separately because it needs a scheduled
  // re-evaluation React Query itself does not provide.
  const nodeStatusQueryData = buildNodeStatusQueryData(selectedNetwork, bitcoinStatusQuery);
  const { isLastKnown } = useNodeStatusFreshness({
    dataUpdatedAt: nodeStatusQueryData.dataUpdatedAt,
    error: nodeStatusQueryData.error,
    network: selectedNetwork,
  });
  // Memoized so the object identity is stable when nothing has actually
  // changed — buildNodeStatusQueryData returns a fresh object every render.
  const nodeStatusQuery = useMemo(
    () => ({ ...nodeStatusQueryData, isLastKnown }),
    [
      nodeStatusQueryData.network,
      nodeStatusQueryData.data,
      nodeStatusQueryData.isPlaceholderData,
      nodeStatusQueryData.isLoading,
      nodeStatusQueryData.error,
      nodeStatusQueryData.dataUpdatedAt,
      isLastKnown,
    ],
  );

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

  // Calculate total balance for filtered wallets (network-specific)
  const walletsUnavailable = neverAnswered(walletsFetchFailed, apiWallets);
  const mempoolUnavailable = neverAnswered(mempoolFetchFailed, mempoolData);
  // Pending totals render nothing when both are zero, so a failed request is
  // indistinguishable from "nothing pending" — and an unconfirmed send the
  // reader cannot see is the one they most need to know about.
  const pendingUnavailable = neverAnswered(pendingFetchFailed, pendingTxsData);
  // The collapsed summary already says "Activity unavailable" on failure; the
  // expanded table underneath was still asserting "No transactions found".
  const recentTxUnavailable = neverAnswered(recentActivity.isError, recentActivity.data);

  const totalBalance = filteredWallets.reduce((acc, w) => acc + w.balance, 0);

  // Use the balance history hook for accurate chart data (filtered by network)
  const { data: balanceHistoryData, isUnavailable: balanceHistoryUnavailable } = useBalanceHistory(filteredWalletIds, totalBalance, timeframe);

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
    balanceHistoryUnavailable,

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
    pendingUnavailable,
    recentTxUnavailable,
    fees,
    feesError,
    formatFeeRate,
    nodeStatus,
    bitcoinStatus,
    nodeStatusQuery,
    mempoolBlocks,
    queuedBlocksSummary,
    lastMempoolUpdate,
    mempoolRefreshing,
    mempoolUnavailable,
    totalBalance,

    // State
    loading,
    // `apiWallets ?? EMPTY_WALLETS` cannot tell "you have none" from "we could
    // not ask", and the two must not render the same.
    //
    // `isError` alone is the wrong signal: React Query keeps the last good
    // `data` through a failed refetch, and this list is invalidated constantly
    // (visibility change, socket reconnect, every balance event). A user who
    // genuinely has no wallets would flip to an error state on the first
    // transient failure and lose the onboarding call to action. Only the
    // absence of any list at all means we never got an answer.
    walletsUnavailable,
    isMainnet,

    // Actions
    refreshMempoolData,
  };
}
