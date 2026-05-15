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
import { usePaginatedList } from '../../../hooks/usePaginatedList';
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
import { getDefaultNodeExternalServiceUrl } from '@sanctuary/shared/constants/nodeConfig';

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
  // Transactions (paginated)
  // -----------------------------------------------------------------------
  const txList = usePaginatedList<Transaction>();
  const [transactionStats, setTransactionStats] = useState<transactionsApi.TransactionStats | null>(null);

  // -----------------------------------------------------------------------
  // UTXOs (paginated)
  // -----------------------------------------------------------------------
  const utxoList = usePaginatedList<UTXO>();
  const [utxoSummary, setUtxoSummary] = useState<{ count: number; totalBalance: number } | null>(null);
  const [utxoStats, setUtxoStats] = useState<UTXO[]>([]);
  const [loadingUtxoStats, setLoadingUtxoStats] = useState(false);

  // -----------------------------------------------------------------------
  // Privacy
  // -----------------------------------------------------------------------
  const [privacyData, setPrivacyData] = useState<transactionsApi.UtxoPrivacyInfo[]>([]);
  const [privacySummary, setPrivacySummary] = useState<transactionsApi.WalletPrivacySummary | null>(null);
  const [showPrivacy] = useState(true);

  // -----------------------------------------------------------------------
  // Addresses (paginated)
  // -----------------------------------------------------------------------
  const addrList = usePaginatedList<Address>();
  const [addressSummary, setAddressSummary] = useState<transactionsApi.AddressSummary | null>(null);

  // Memoize wallet addresses to prevent infinite re-renders in TransactionList
  const walletAddressStrings = useMemo(() => addrList.items.map(a => a.address), [addrList.items]);

  // -----------------------------------------------------------------------
  // Drafts
  // -----------------------------------------------------------------------
  const [draftsCount, setDraftsCount] = useState(0);

  // -----------------------------------------------------------------------
  // Explorer
  // -----------------------------------------------------------------------
  const [explorerUrl, setExplorerUrl] = useState(getDefaultNodeExternalServiceUrl('mainnet'));

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
      addrList.setHasMore(addrList.offset < addressSummary.totalAddresses);
    }
  }, [addressSummary, addrList.offset]);

  useEffect(() => {
    if (utxoSummary) {
      utxoList.setHasMore(utxoList.offset < utxoSummary.count);
    }
  }, [utxoSummary, utxoList.offset]);

  // Reset UTXO state when wallet ID changes
  useEffect(() => {
    utxoList.reset();
    setUtxoSummary(null);
    setUtxoStats([]);
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
      addrList.setLoading(true);
      if (reset) addrList.setOffset(0);

      const formattedAddrs = await loadAddressPage(walletId, offset, limit);

      if (reset) {
        addrList.replaceItems(formattedAddrs, formattedAddrs.length,
          addressSummary ? formattedAddrs.length < addressSummary.totalAddresses : formattedAddrs.length === limit);
      } else {
        addrList.appendItems(formattedAddrs,
          addressSummary ? addressSummary.totalAddresses : limit,
          addressSummary ? 'total' : 'pageSize');
      }
    } catch (err) {
      logError(log, err, 'Failed to load addresses');
      addrList.setLoading(false);
    }
  };

  const loadUtxos = async (walletId: string, limit: number, offset: number) => {
    utxoList.setLoading(true);

    try {
      const page = await loadUtxoPage(walletId, offset, limit);
      setUtxoSummary({ count: page.count, totalBalance: page.totalBalance });
      utxoList.appendItems(page.utxos, page.count, 'total');
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs');
      utxoList.setLoading(false);
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
    if (!id || txList.loading || !txList.hasMore) return;

    try {
      txList.setLoading(true);
      const formattedTxs = await loadTransactionPage(id, txList.offset, TX_PAGE_SIZE);
      txList.appendItems(formattedTxs, TX_PAGE_SIZE);
    } catch (err) {
      logError(log, err, 'Failed to load more transactions');
      handleError(err, 'Failed to Load More Transactions');
      txList.setLoading(false);
    }
  };

  const loadMoreUtxos = async () => {
    if (!id || utxoList.loading || !utxoList.hasMore) return;
    await loadUtxos(id, UTXO_PAGE_SIZE, utxoList.offset);
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
      txList.replaceItems(aux.transactions, TX_PAGE_SIZE, aux.transactions.length === TX_PAGE_SIZE);
    }
    if (aux.transactionStats) setTransactionStats(aux.transactionStats);
    if (aux.utxoPage) {
      setUtxoSummary({ count: aux.utxoPage.count, totalBalance: aux.utxoPage.totalBalance });
      utxoList.replaceItems(aux.utxoPage.utxos, aux.utxoPage.utxos.length,
        aux.utxoPage.utxos.length < aux.utxoPage.count);
    }
    setPrivacyData(aux.privacyData);
    setPrivacySummary(aux.privacySummary);
    if (aux.addressSummary) setAddressSummary(aux.addressSummary);
    if (aux.addresses !== null) {
      addrList.replaceItems(aux.addresses, aux.addresses.length,
        aux.addressSummary
          ? aux.addresses.length < aux.addressSummary.totalAddresses
          : aux.addresses.length === ADDRESS_PAGE_SIZE);
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
    transactions: txList.items,
    setTransactions: txList.setItems,
    transactionStats,
    txOffset: txList.offset,
    hasMoreTx: txList.hasMore,
    loadingMoreTx: txList.loading,
    loadMoreTransactions,

    // UTXOs
    utxos: utxoList.items,
    setUTXOs: utxoList.setItems,
    utxoSummary,
    hasMoreUtxos: utxoList.hasMore,
    loadingMoreUtxos: utxoList.loading,
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
    addresses: addrList.items,
    setAddresses: addrList.setItems,
    walletAddressStrings,
    addressSummary,
    hasMoreAddresses: addrList.hasMore,
    loadingAddresses: addrList.loading,
    loadAddresses: loadAddressesFn,
    loadAddressSummary: loadAddressSummaryFn,
    addressOffset: addrList.offset,
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
