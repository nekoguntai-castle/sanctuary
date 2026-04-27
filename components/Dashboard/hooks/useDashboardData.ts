import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { WebSocketTransactionData, WebSocketBalanceData, WebSocketConfirmationData, WebSocketSyncData } from '../../../types';
import { TabNetwork } from '../../NetworkTabs';
import * as adminApi from '../../../src/api/admin';
import { useWebSocket, useWebSocketEvent } from '../../../hooks/websocket';
import { useNotifications } from '../../../contexts/NotificationContext';
import { useNotificationSound } from '../../../hooks/useNotificationSound';
import { createLogger } from '../../../utils/logger';
import { useWallets, useRecentTransactions, useInvalidateAllWallets, useUpdateWalletSyncStatus, useBalanceHistory, usePendingTransactions } from '../../../hooks/queries/useWallets';
import { useFeeEstimates, useBitcoinStatus, useMempoolData } from '../../../hooks/queries/useBitcoin';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { useDelayedRender } from '../../../hooks/useDelayedRender';
import {
  applyNetworkSearchParam,
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
  resolveInitialNetwork,
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');

  // Network tab state - persist in URL
  const networkFromUrl = searchParams.get('network');
  const [selectedNetwork, setSelectedNetwork] = useState<TabNetwork>(() => (
    resolveInitialNetwork(networkFromUrl)
  ));

  // Update URL when network changes
  const handleNetworkChange = (network: TabNetwork) => {
    setSelectedNetwork(network);
    setSearchParams(applyNetworkSearchParam(searchParams, network), { replace: true });
  };

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
  const { data: feeEstimates } = useFeeEstimates();
  const { data: bitcoinStatus, isLoading: statusLoading } = useBitcoinStatus();
  const { data: mempoolData, refetch: refetchMempool, isFetching: mempoolRefreshing } = useMempoolData();

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

  // Fetch recent transactions for selected network only
  const { data: recentTxRawData } = useRecentTransactions(filteredWalletIds, 10);
  const recentTxRaw = recentTxRawData ?? EMPTY_TRANSACTIONS;

  // Fetch pending transactions for selected network only
  const { data: pendingTxsData } = usePendingTransactions(filteredWalletIds);
  const pendingTxs = pendingTxsData ?? EMPTY_PENDING;

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

  // Subscribe to all wallet events (single batch message for efficiency)
  useEffect(() => {
    if (wallets.length > 0) {
      const walletIds = wallets.map(wallet => wallet.id);
      subscribeWallets(walletIds);
    }
    // Cleanup: unsubscribe from all wallets when effect re-runs or component unmounts
    return () => {
      if (wallets.length > 0) {
        const walletIds = wallets.map(wallet => wallet.id);
        unsubscribeWallets(walletIds);
      }
    };
  }, [wallets, subscribeWallets, unsubscribeWallets]);

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
    handleNetworkChange,

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
    pendingTxs,
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
