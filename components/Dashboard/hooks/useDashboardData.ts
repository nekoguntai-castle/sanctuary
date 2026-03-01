import { useEffect, useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Wallet, Transaction, WalletType, WalletNetwork, isMultisigType, WebSocketTransactionData, WebSocketBalanceData, WebSocketConfirmationData, WebSocketSyncData } from '../../../types';
import { TabNetwork } from '../../NetworkTabs';
import { satsToBTC, formatBTC } from '@shared/utils/bitcoin';
import * as adminApi from '../../../src/api/admin';
import { useWebSocket, useWebSocketEvent } from '../../../hooks/useWebSocket';
import { useNotifications } from '../../../contexts/NotificationContext';
import { useNotificationSound } from '../../../hooks/useNotificationSound';
import { createLogger } from '../../../utils/logger';
import { useWallets, useRecentTransactions, useInvalidateAllWallets, useUpdateWalletSyncStatus, useBalanceHistory, usePendingTransactions } from '../../../hooks/queries/useWallets';
import { useFeeEstimates, useBitcoinStatus, useMempoolData } from '../../../hooks/queries/useBitcoin';
import { useCurrency } from '../../../contexts/CurrencyContext';
import { useUser } from '../../../contexts/UserContext';
import { useDelayedRender } from '../../../hooks/useDelayedRender';

const log = createLogger('Dashboard');

// Stable empty arrays to prevent re-renders when hook data is undefined
const EMPTY_WALLETS: never[] = [];
const EMPTY_TRANSACTIONS: never[] = [];
const EMPTY_PENDING: never[] = [];

// Local fee estimate type for dashboard display
interface DashboardFeeEstimate {
  fast: number;
  medium: number;
  slow: number;
}

export type Timeframe = '1D' | '1W' | '1M' | '1Y' | 'ALL';

export function useDashboardData() {
  const { format, btcPrice, priceChange24h, currencySymbol, priceLoading, lastPriceUpdate, showFiat } = useCurrency();
  const { user } = useUser();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [timeframe, setTimeframe] = useState<Timeframe>('1W');

  // Network tab state - persist in URL
  const networkFromUrl = searchParams.get('network') as TabNetwork | null;
  const [selectedNetwork, setSelectedNetwork] = useState<TabNetwork>(
    networkFromUrl && ['mainnet', 'testnet', 'signet'].includes(networkFromUrl) ? networkFromUrl : 'mainnet'
  );

  // Update URL when network changes
  const handleNetworkChange = (network: TabNetwork) => {
    setSelectedNetwork(network);
    if (network === 'mainnet') {
      searchParams.delete('network');
    } else {
      searchParams.set('network', network);
    }
    setSearchParams(searchParams, { replace: true });
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
  const { data: feeEstimates, isLoading: feesLoading } = useFeeEstimates();
  const { data: bitcoinStatus, isLoading: statusLoading } = useBitcoinStatus();
  const { data: mempoolData, isLoading: mempoolLoading, refetch: refetchMempool, isFetching: mempoolRefreshing } = useMempoolData();

  // Use stable empty arrays when data is undefined to prevent re-renders
  const safeApiWallets = apiWallets ?? EMPTY_WALLETS;

  // Convert API wallets to component format (with network)
  const wallets: Wallet[] = useMemo(() => safeApiWallets.map(w => ({
    id: w.id,
    name: w.name,
    type: w.type as WalletType,
    balance: w.balance,
    scriptType: w.scriptType,
    network: (w.network as WalletNetwork) || 'mainnet',
    derivationPath: w.descriptor || '',
    fingerprint: w.fingerprint || '',
    label: w.name,
    xpub: '',
    lastSyncedAt: w.lastSyncedAt,
    lastSyncStatus: w.lastSyncStatus as 'success' | 'failed' | 'partial' | null,
    syncInProgress: w.syncInProgress,
  })), [safeApiWallets]);

  // Filter wallets by selected network and sort by balance (highest first)
  const filteredWallets = useMemo(() =>
    wallets
      .filter(w => w.network === selectedNetwork)
      .sort((a, b) => b.balance - a.balance),
    [wallets, selectedNetwork]
  );

  // Count wallets per network for tabs
  const walletCounts = useMemo(() => ({
    mainnet: wallets.filter(w => w.network === 'mainnet').length,
    testnet: wallets.filter(w => w.network === 'testnet').length,
    signet: wallets.filter(w => w.network === 'signet').length,
  }), [wallets]);

  // All wallet IDs for subscriptions
  const walletIds = useMemo(() => wallets.map(w => w.id), [wallets]);

  // Filtered wallet IDs for network-specific data
  const filteredWalletIds = useMemo(() => filteredWallets.map(w => w.id), [filteredWallets]);

  // Fetch recent transactions for selected network only
  const { data: recentTxRawData, isLoading: txLoading } = useRecentTransactions(filteredWalletIds, 10);
  const recentTxRaw = recentTxRawData ?? EMPTY_TRANSACTIONS;

  // Fetch pending transactions for selected network only
  const { data: pendingTxsData } = usePendingTransactions(filteredWalletIds);
  const pendingTxs = pendingTxsData ?? EMPTY_PENDING;

  // Check if this network has any wallets (to determine if node should be shown)
  const networkHasWallets = filteredWallets.length > 0;
  const isMainnet = selectedNetwork === 'mainnet';

  // Convert API transactions to component format
  const recentTx: Transaction[] = useMemo(() => recentTxRaw.map(tx => {
    const rawAmount = typeof tx.amount === 'string' ? parseInt(tx.amount, 10) : tx.amount;
    const amount = tx.type === 'sent' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    return {
      id: tx.id,
      txid: tx.txid,
      walletId: tx.walletId,
      amount,
      fee: tx.fee ? (typeof tx.fee === 'string' ? parseInt(tx.fee, 10) : tx.fee) : undefined,
      confirmations: tx.confirmations,
      confirmed: tx.confirmations > 0,
      blockHeight: tx.blockHeight,
      timestamp: tx.blockTime ? new Date(tx.blockTime).getTime() : Date.now(),
      label: tx.label || '',
      type: tx.type,
    };
  }), [recentTxRaw]);

  // Derive fees from React Query data
  const fees: DashboardFeeEstimate | null = feeEstimates ? {
    fast: feeEstimates.fastest,
    medium: feeEstimates.hour,
    slow: feeEstimates.economy,
  } : null;

  // Format fee rate: show decimals only when meaningful
  const formatFeeRate = (rate: number | undefined): string => {
    if (rate === undefined) return '---';
    if (rate >= 10) return Math.round(rate).toString();
    if (Number.isInteger(rate)) return rate.toString();
    return rate.toFixed(1);
  };

  // Derive node status from Bitcoin status
  const nodeStatus: 'unknown' | 'checking' | 'connected' | 'error' =
    statusLoading ? 'checking' :
    bitcoinStatus === undefined ? 'unknown' :
    bitcoinStatus?.connected ? 'connected' : 'error';

  // Derive mempool blocks from React Query data
  const mempoolBlocks = mempoolData ? [...mempoolData.mempool, ...mempoolData.blocks] : [];
  const queuedBlocksSummary = mempoolData?.queuedBlocksSummary || null;
  const lastMempoolUpdate = mempoolData ? new Date() : null;

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

    // Determine title based on transaction type
    const title = data.type === 'received' ? 'Bitcoin Received'
      : data.type === 'consolidation' ? 'Consolidation'
      : 'Bitcoin Sent';

    // Determine amount prefix based on type
    const prefix = data.type === 'received' ? '+' : '-';

    addNotification({
      type: 'transaction',
      title,
      message: `${prefix}${formatBTC(satsToBTC(Math.abs(data.amount ?? 0)), 8, false)} BTC • ${data.confirmations ?? 0} confirmations`,
      duration: 10000,
      data,
    });

    // Play sound for receive/send events
    if (data.type === 'received') {
      playEventSound('receive');
    } else if (data.type === 'sent' || data.type === 'consolidation') {
      playEventSound('send');
    }

    // Invalidate wallet queries to refresh data
    invalidateAllWallets();
  }, [addNotification, invalidateAllWallets, playEventSound]);

  // Handle balance updates
  useWebSocketEvent('balance', (event) => {
    const data = event.data as WebSocketBalanceData;

    const change = data.change ?? 0;
    if (Math.abs(change) > 10000) {
      addNotification({
        type: 'balance',
        title: 'Balance Updated',
        message: `${change > 0 ? '+' : ''}${formatBTC(satsToBTC(change), 8, false)} BTC`,
        duration: 8000,
        data,
      });
    }

    // Invalidate wallet queries to refresh data
    invalidateAllWallets();
  }, [addNotification, invalidateAllWallets]);

  // Handle new block notifications
  useWebSocketEvent('block', (event) => {
    const data = event.data as { height: number; transactionCount?: number };

    addNotification({
      type: 'block',
      title: 'New Block Mined',
      message: `Block #${data.height.toLocaleString()} • ${data.transactionCount || 0} transactions`,
      duration: 6000,
      data,
    });

    // Refresh mempool data when a new block is mined
    refreshMempoolData();
  }, [addNotification, refreshMempoolData]);

  // Handle confirmation updates
  useWebSocketEvent('confirmation', (event) => {
    const data = event.data as WebSocketConfirmationData & { previousConfirmations?: number };

    // Check if this is a first confirmation milestone (0→1+)
    const confirmations = data.confirmations ?? 0;
    const isFirstConfirmation = data.previousConfirmations === 0 && confirmations >= 1;

    if ([1, 3, 6].includes(confirmations) || isFirstConfirmation) {
      addNotification({
        type: 'confirmation',
        title: 'Transaction Confirmed',
        message: `${confirmations} confirmation${confirmations > 1 ? 's' : ''} reached`,
        duration: 5000,
        data,
      });

      // Play sound on first confirmation (when previousConfirmations was 0)
      if (isFirstConfirmation) {
        playEventSound('confirmation');
      }
    }

    // Refresh wallet data to update confirmation counts in the UI
    invalidateAllWallets();
  }, [addNotification, playEventSound, invalidateAllWallets]);

  // Handle sync status changes - update syncInProgress in real-time
  useWebSocketEvent('sync', (event) => {
    const data = event.data as WebSocketSyncData;
    const walletId = data.walletId;

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
