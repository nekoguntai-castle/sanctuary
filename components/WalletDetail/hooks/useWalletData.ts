/**
 * useWalletData Hook
 *
 * Manages all wallet data fetching, pagination, and background data state.
 * This includes: wallet, devices, transactions, UTXOs, addresses, privacy,
 * drafts, explorer URL, groups, and share info.
 *
 * Extracted from WalletDetail.tsx to isolate data-layer concerns.
 * Loader functions and formatters live in sibling modules; this file
 * orchestrates state and calls into those pure helpers.
 */

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  Wallet, Transaction, UTXO, Device, User, Address,
} from '../../../types';
import type * as transactionsApi from '../../../src/api/transactions';
import type * as walletsApi from '../../../src/api/wallets';
import type * as authApi from '../../../src/api/auth';
import { ApiError } from '../../../src/api/client';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';

// Extracted pure modules
import {
  TX_PAGE_SIZE, UTXO_PAGE_SIZE, ADDRESS_PAGE_SIZE,
} from './walletDataTypes';
import type { UseWalletDataParams, UseWalletDataReturn } from './walletDataTypes';
import {
  loadAddressSummary as loadAddressSummaryLoader,
  loadAddressPage,
  loadUtxoPage,
  loadUtxosForStats as loadUtxosForStatsLoader,
  loadTransactionPage,
  fetchWalletCore,
  fetchAuxiliaryData,
  loadGroups,
  loadWalletShareInfo,
} from './walletDataLoaders';
import { formatWalletFromApi } from './walletDataFormatters';

// Re-export types so existing consumers importing from this file still work
export type { UseWalletDataParams, UseWalletDataReturn } from './walletDataTypes';

const log = createLogger('useWalletData');

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWalletData({
  id,
  user,
}: UseWalletDataParams): UseWalletDataReturn {
  const navigate = useNavigate();
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();

  // -----------------------------------------------------------------------
  // Core state
  // -----------------------------------------------------------------------
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Transactions
  // -----------------------------------------------------------------------
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionStats, setTransactionStats] = useState<transactionsApi.TransactionStats | null>(null);
  const [txOffset, setTxOffset] = useState(0);
  const [hasMoreTx, setHasMoreTx] = useState(true);
  const [loadingMoreTx, setLoadingMoreTx] = useState(false);

  // -----------------------------------------------------------------------
  // UTXOs
  // -----------------------------------------------------------------------
  const [utxos, setUTXOs] = useState<UTXO[]>([]);
  const [utxoSummary, setUtxoSummary] = useState<{ count: number; totalBalance: number } | null>(null);
  const [utxoOffset, setUtxoOffset] = useState(0);
  const [hasMoreUtxos, setHasMoreUtxos] = useState(true);
  const [loadingMoreUtxos, setLoadingMoreUtxos] = useState(false);
  const [utxoStats, setUtxoStats] = useState<UTXO[]>([]);
  const [loadingUtxoStats, setLoadingUtxoStats] = useState(false);

  // -----------------------------------------------------------------------
  // Privacy
  // -----------------------------------------------------------------------
  const [privacyData, setPrivacyData] = useState<transactionsApi.UtxoPrivacyInfo[]>([]);
  const [privacySummary, setPrivacySummary] = useState<transactionsApi.WalletPrivacySummary | null>(null);
  const [showPrivacy] = useState(true);

  // -----------------------------------------------------------------------
  // Addresses
  // -----------------------------------------------------------------------
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressOffset, setAddressOffset] = useState(0);
  const [hasMoreAddresses, setHasMoreAddresses] = useState(true);
  const [addressSummary, setAddressSummary] = useState<transactionsApi.AddressSummary | null>(null);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  // Memoize wallet addresses to prevent infinite re-renders in TransactionList
  const walletAddressStrings = useMemo(() => addresses.map(a => a.address), [addresses]);

  // -----------------------------------------------------------------------
  // Drafts
  // -----------------------------------------------------------------------
  const [draftsCount, setDraftsCount] = useState(0);

  // -----------------------------------------------------------------------
  // Explorer
  // -----------------------------------------------------------------------
  const [explorerUrl, setExplorerUrl] = useState('https://mempool.space');

  // -----------------------------------------------------------------------
  // Users & Groups & Share info
  // -----------------------------------------------------------------------
  const [users] = useState<User[]>([]);
  const [groups, setGroups] = useState<authApi.UserGroup[]>([]);
  const [walletShareInfo, setWalletShareInfo] = useState<walletsApi.WalletShareInfo | null>(null);

  // -----------------------------------------------------------------------
  // Sync effects for pagination boundaries
  // -----------------------------------------------------------------------
  useEffect(() => {
    if (addressSummary) {
      setHasMoreAddresses(addressOffset < addressSummary.totalAddresses);
    }
  }, [addressSummary, addressOffset]);

  useEffect(() => {
    if (utxoSummary) {
      setHasMoreUtxos(utxoOffset < utxoSummary.count);
    }
  }, [utxoSummary, utxoOffset]);

  // Reset UTXO state when wallet ID changes
  useEffect(() => {
    setUTXOs([]);
    setUtxoSummary(null);
    setUtxoOffset(0);
    setHasMoreUtxos(true);
    setUtxoStats([]);
    setLoadingMoreUtxos(false);
    setLoadingUtxoStats(false);
  }, [id]);

  // -----------------------------------------------------------------------
  // Load helpers (thin wrappers that call loaders and apply state)
  // -----------------------------------------------------------------------

  const loadAddressSummaryFn = async (walletId: string) => {
    const summary = await loadAddressSummaryLoader(walletId);
    if (summary) setAddressSummary(summary);
  };

  const loadAddressesFn = async (walletId: string, limit: number, offset: number, reset = false) => {
    try {
      setLoadingAddresses(true);
      if (reset) setAddressOffset(0);

      const formattedAddrs = await loadAddressPage(walletId, offset, limit);

      setAddresses(prev => reset ? formattedAddrs : [...prev, ...formattedAddrs]);
      const nextOffset = offset + formattedAddrs.length;
      setAddressOffset(nextOffset);
      if (addressSummary) {
        setHasMoreAddresses(nextOffset < addressSummary.totalAddresses);
      } else {
        setHasMoreAddresses(formattedAddrs.length === limit);
      }
    } catch (err) {
      logError(log, err, 'Failed to load addresses');
    } finally {
      setLoadingAddresses(false);
    }
  };

  const loadUtxos = async (walletId: string, limit: number, offset: number, reset = false) => {
    if (!reset) setLoadingMoreUtxos(true);

    try {
      if (reset) setUtxoOffset(0);

      const page = await loadUtxoPage(walletId, offset, limit);
      setUtxoSummary({ count: page.count, totalBalance: page.totalBalance });
      setUTXOs(prev => reset ? page.utxos : [...prev, ...page.utxos]);

      const nextOffset = offset + page.utxos.length;
      setUtxoOffset(nextOffset);
      setHasMoreUtxos(nextOffset < page.count);
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs');
    } finally {
      if (!reset) setLoadingMoreUtxos(false);
    }
  };

  const loadUtxosForStatsFn = async (walletId: string) => {
    setLoadingUtxoStats(true);
    try {
      const formattedUTXOs = await loadUtxosForStatsLoader(walletId);
      setUtxoStats(formattedUTXOs);
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs for stats');
    } finally {
      setLoadingUtxoStats(false);
    }
  };

  // -----------------------------------------------------------------------
  // Pagination actions
  // -----------------------------------------------------------------------

  const loadMoreTransactions = async () => {
    if (!id || loadingMoreTx || !hasMoreTx) return;

    try {
      setLoadingMoreTx(true);
      const formattedTxs = await loadTransactionPage(id, txOffset, TX_PAGE_SIZE);

      setTransactions(prev => [...prev, ...formattedTxs]);
      setTxOffset(prev => prev + TX_PAGE_SIZE);
      setHasMoreTx(formattedTxs.length === TX_PAGE_SIZE);
    } catch (err) {
      logError(log, err, 'Failed to load more transactions');
      handleError(err, 'Failed to Load More Transactions');
    } finally {
      setLoadingMoreTx(false);
    }
  };

  const loadMoreUtxos = async () => {
    if (!id || loadingMoreUtxos || !hasMoreUtxos) return;
    await loadUtxos(id, UTXO_PAGE_SIZE, utxoOffset, false);
  };

  // -----------------------------------------------------------------------
  // Main data fetcher
  // -----------------------------------------------------------------------

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!id || !user) return;

    if (!isRefresh) setLoading(true);
    setError(null);

    // 1. Fetch core wallet -- critical, fail-fast
    let apiWallet: Wallet;
    try {
      apiWallet = await fetchWalletCore(id);
    } catch (err) {
      log.error('Failed to fetch wallet', { error: err });
      if (err instanceof ApiError) {
        if (err.status === 404) { navigate('/wallets'); return; }
        setError(err.message);
      } else {
        setError('Failed to load wallet');
      }
      setLoading(false);
      return;
    }

    const formattedWallet = formatWalletFromApi(apiWallet, user.id);
    setWallet(formattedWallet);
    setLoading(false);

    // 2. Fetch auxiliary data in parallel (non-critical)
    const aux = await fetchAuxiliaryData(id, apiWallet, user.id, {
      tx: TX_PAGE_SIZE,
      utxo: UTXO_PAGE_SIZE,
      address: ADDRESS_PAGE_SIZE,
    });

    // Apply auxiliary results to state (null values indicate failed fetches)
    if (aux.explorerUrl) setExplorerUrl(aux.explorerUrl);
    setDevices(aux.devices);
    if (aux.transactions !== null) {
      setTransactions(aux.transactions);
      setTxOffset(TX_PAGE_SIZE);
      setHasMoreTx(aux.transactions.length === TX_PAGE_SIZE);
    }
    if (aux.transactionStats) setTransactionStats(aux.transactionStats);
    if (aux.utxoPage) {
      setUtxoSummary({ count: aux.utxoPage.count, totalBalance: aux.utxoPage.totalBalance });
      setUTXOs(aux.utxoPage.utxos);
      setUtxoOffset(aux.utxoPage.utxos.length);
      setHasMoreUtxos(aux.utxoPage.utxos.length < aux.utxoPage.count);
    }
    setPrivacyData(aux.privacyData);
    setPrivacySummary(aux.privacySummary);
    if (aux.addressSummary) setAddressSummary(aux.addressSummary);
    if (aux.addresses !== null) {
      setAddresses(aux.addresses);
      setAddressOffset(aux.addresses.length);
      if (aux.addressSummary) {
        setHasMoreAddresses(aux.addresses.length < aux.addressSummary.totalAddresses);
      } else {
        setHasMoreAddresses(aux.addresses.length === ADDRESS_PAGE_SIZE);
      }
    }

    // Drafts + notifications
    setDraftsCount(aux.drafts.length);
    if (aux.drafts.length > 0) {
      addAppNotification({
        type: 'pending_drafts',
        scope: 'wallet',
        scopeId: id,
        severity: 'warning',
        title: `${aux.drafts.length} pending draft${aux.drafts.length > 1 ? 's' : ''}`,
        message: 'Resume or broadcast your draft transactions',
        count: aux.drafts.length,
        actionUrl: `/wallets/${id}`,
        actionLabel: 'View Drafts',
        dismissible: true,
        persistent: false,
      });
    } else {
      removeNotificationsByType('pending_drafts', id);
    }

    // 3. Groups & share info (sequential, after main parallel batch)
    const fetchedGroups = await loadGroups(user);
    setGroups(fetchedGroups);

    const shareInfo = await loadWalletShareInfo(id);
    setWalletShareInfo(shareInfo);
  }, [id, user]);

  // -----------------------------------------------------------------------
  // Initial load effect
  // -----------------------------------------------------------------------
  useEffect(() => {
    fetchData();
  }, [id, user]);

  // Refetch wallet data when window becomes visible (handles missed WS events)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id && user) {
        fetchData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, user]);

  // -----------------------------------------------------------------------
  // Return
  // -----------------------------------------------------------------------
  return {
    // Core
    wallet,
    setWallet,
    devices,
    loading,
    error,
    setError,

    // Transactions
    transactions,
    setTransactions,
    transactionStats,
    txOffset,
    hasMoreTx,
    loadingMoreTx,
    loadMoreTransactions,

    // UTXOs
    utxos,
    setUTXOs,
    utxoSummary,
    hasMoreUtxos,
    loadingMoreUtxos,
    loadMoreUtxos,

    // UTXO stats
    utxoStats,
    setUtxoStats,
    loadingUtxoStats,
    loadUtxosForStats: loadUtxosForStatsFn,

    // Privacy
    privacyData,
    privacySummary,
    showPrivacy,

    // Addresses
    addresses,
    setAddresses,
    walletAddressStrings,
    addressSummary,
    hasMoreAddresses,
    loadingAddresses,
    loadAddresses: loadAddressesFn,
    loadAddressSummary: loadAddressSummaryFn,
    addressOffset,
    ADDRESS_PAGE_SIZE,

    // Drafts
    draftsCount,
    setDraftsCount,

    // Explorer
    explorerUrl,

    // Users & Groups
    users,
    groups,

    // Share info
    walletShareInfo,
    setWalletShareInfo,

    // Refresh
    fetchData,
  };
}
