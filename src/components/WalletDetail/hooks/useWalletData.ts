import { useEffect, useState, useMemo, useCallback, useLayoutEffect, useRef } from 'react';
import { usePaginatedList } from '../../../hooks/usePaginatedList';
import { useNavigate } from 'react-router-dom';
import type {
  Wallet, Transaction, UTXO, Device, User, Address,
} from '../../../types';
import type * as transactionsApi from '../../../api/transactions';
import type * as walletsApi from '../../../api/wallets';
import type * as authApi from '../../../api/auth';
import { ApiError } from '../../../api/client';
import { useErrorHandler } from '../../../hooks/useErrorHandler';
import { useAppNotifications } from '../../../contexts/AppNotificationContext';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';
import { getDefaultNodeExternalServiceUrl } from '@sanctuary/shared/constants/nodeConfig';

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
import type { AuxiliaryData } from './walletDataLoaders';
import { formatWalletFromApi } from './walletDataFormatters';
import {
  createRequestOwnership,
  type RouteToken,
} from '../../../hooks/requestOwnership';

export type { UseWalletDataParams, UseWalletDataReturn } from './walletDataTypes';

const log = createLogger('useWalletData');

export function useWalletData({
  id,
  user,
}: UseWalletDataParams): UseWalletDataReturn {
  const navigate = useNavigate();
  const { handleError } = useErrorHandler();
  const { addNotification: addAppNotification, removeNotificationsByType } = useAppNotifications();
  const routeKey = `${id ?? ''}:${user?.id ?? ''}`;
  const ownershipRef = useRef<ReturnType<typeof createRequestOwnership> | null>(null);
  if (!ownershipRef.current) {
    ownershipRef.current = createRequestOwnership(routeKey);
  }
  const ownership = ownershipRef.current;

  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const txList = usePaginatedList<Transaction>();
  const [transactionStats, setTransactionStats] = useState<transactionsApi.TransactionStats | null>(null);

  const utxoList = usePaginatedList<UTXO>();
  const [utxoSummary, setUtxoSummary] = useState<{ count: number; totalBalance: number } | null>(null);
  const [utxoStats, setUtxoStats] = useState<UTXO[]>([]);
  const [loadingUtxoStats, setLoadingUtxoStats] = useState(false);

  const [privacyData, setPrivacyData] = useState<transactionsApi.UtxoPrivacyInfo[]>([]);
  const [privacySummary, setPrivacySummary] = useState<transactionsApi.WalletPrivacySummary | null>(null);
  const [showPrivacy] = useState(true);

  const addrList = usePaginatedList<Address>();
  const [addressSummary, setAddressSummary] = useState<transactionsApi.AddressSummary | null>(null);

  // Memoize wallet addresses to prevent infinite re-renders in TransactionList
  const walletAddressStrings = useMemo(() => addrList.items.map(a => a.address), [addrList.items]);

  const [draftsCount, setDraftsCount] = useState(0);

  const [explorerUrl, setExplorerUrl] = useState(getDefaultNodeExternalServiceUrl('mainnet'));

  const [users] = useState<User[]>([]);
  const [groups, setGroups] = useState<authApi.UserGroup[]>([]);
  const [walletShareInfo, setWalletShareInfo] = useState<walletsApi.WalletShareInfo | null>(null);

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

  useLayoutEffect(() => {
    ownership.setRoute(routeKey);
    setWallet(null);
    setDevices([]);
    setLoading(true);
    setError(null);
    txList.reset();
    setTransactionStats(null);
    utxoList.reset();
    setUtxoSummary(null);
    setUtxoStats([]);
    setLoadingUtxoStats(false);
    setPrivacyData([]);
    setPrivacySummary(null);
    addrList.reset();
    setAddressSummary(null);
    setDraftsCount(0);
    setExplorerUrl(getDefaultNodeExternalServiceUrl('mainnet'));
    setGroups([]);
    setWalletShareInfo(null);
  }, [routeKey]);

  useEffect(() => () => ownership.invalidate(), [ownership]);

  const ownsRoute = (token: RouteToken, walletId: string): boolean => (
    ownership.isRouteOwner(token) && walletId === id
  );

  const loadAddressSummaryFn = async (walletId: string) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    const summary = await loadAddressSummaryLoader(walletId);
    if (summary && ownsRoute(routeToken, walletId)) setAddressSummary(summary);
  };

  const loadAddressesFn = async (walletId: string, limit: number, offset: number, reset = false) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    try {
      addrList.setLoading(true);
      if (reset) addrList.setOffset(0);

      const formattedAddrs = await loadAddressPage(walletId, offset, limit);
      if (!ownsRoute(routeToken, walletId)) return;

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
      if (ownsRoute(routeToken, walletId)) addrList.setLoading(false);
    }
  };

  const loadUtxos = async (walletId: string, limit: number, offset: number) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    utxoList.setLoading(true);

    try {
      const page = await loadUtxoPage(walletId, offset, limit);
      if (!ownsRoute(routeToken, walletId)) return;
      setUtxoSummary({ count: page.count, totalBalance: page.totalBalance });
      utxoList.appendItems(page.utxos, page.count, 'total');
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs');
      if (ownsRoute(routeToken, walletId)) utxoList.setLoading(false);
    }
  };

  const loadUtxosForStatsFn = async (walletId: string) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    setLoadingUtxoStats(true);
    try {
      const formattedUTXOs = await loadUtxosForStatsLoader(walletId);
      if (ownsRoute(routeToken, walletId)) setUtxoStats(formattedUTXOs);
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs for stats');
    } finally {
      if (ownsRoute(routeToken, walletId)) setLoadingUtxoStats(false);
    }
  };

  const loadMoreTransactions = async () => {
    if (!id || txList.loading || !txList.hasMore) return;
    const walletId = id;
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;

    try {
      txList.setLoading(true);
      const formattedTxs = await loadTransactionPage(walletId, txList.offset, TX_PAGE_SIZE);
      if (!ownsRoute(routeToken, walletId)) return;
      txList.appendItems(formattedTxs, TX_PAGE_SIZE);
    } catch (err) {
      logError(log, err, 'Failed to load more transactions');
      if (ownsRoute(routeToken, walletId)) {
        handleError(err, 'Failed to Load More Transactions');
        txList.setLoading(false);
      }
    }
  };

  const loadMoreUtxos = async () => {
    if (!id || utxoList.loading || !utxoList.hasMore) return;
    await loadUtxos(id, UTXO_PAGE_SIZE, utxoList.offset);
  };

  const applyAuxiliaryData = useCallback((aux: AuxiliaryData, walletId: string) => {
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
    setDraftsCount(aux.drafts.length);
    if (aux.drafts.length > 0) {
      addAppNotification({
        type: 'pending_drafts', scope: 'wallet', scopeId: walletId, severity: 'warning',
        title: `${aux.drafts.length} pending draft${aux.drafts.length > 1 ? 's' : ''}`,
        message: 'Resume or broadcast your draft transactions', count: aux.drafts.length,
        actionUrl: `/wallets/${walletId}`, actionLabel: 'View Drafts',
        dismissible: true, persistent: false,
      });
    } else {
      removeNotificationsByType('pending_drafts', walletId);
    }
  }, [addAppNotification, addrList, removeNotificationsByType, txList, utxoList]);

  const fetchData = useCallback(async (isRefresh = false) => {
    const request = ownership.beginFetch(routeKey);
    const ownsRequest = () => ownership.isFetchOwner(request);
    if (!id || !user || !ownsRequest()) return;

    if (!isRefresh) setLoading(true);
    setError(null);

    // 1. Fetch core wallet -- critical, fail-fast
    let apiWallet: Wallet;
    try {
      apiWallet = await fetchWalletCore(id);
    } catch (err) {
      log.error('Failed to fetch wallet', { error: err });
      if (!ownsRequest()) return;
      if (err instanceof ApiError) {
        if (err.status === 404) { navigate('/wallets'); return; }
        setError(err.message);
      } else {
        setError('Failed to load wallet');
      }
      setLoading(false);
      return;
    }

    if (!ownsRequest()) return;
    const formattedWallet = formatWalletFromApi(apiWallet, user.id);
    setWallet(formattedWallet);
    setLoading(false);

    // 2. Fetch auxiliary data in parallel (non-critical)
    const aux = await fetchAuxiliaryData(id, apiWallet, user.id, {
      tx: TX_PAGE_SIZE,
      utxo: UTXO_PAGE_SIZE,
      address: ADDRESS_PAGE_SIZE,
    });
    if (!ownsRequest()) return;

    applyAuxiliaryData(aux, id);

    // 3. Groups & share info (sequential, after main parallel batch)
    const fetchedGroups = await loadGroups(user);
    if (!ownsRequest()) return;
    setGroups(fetchedGroups);

    const shareInfo = await loadWalletShareInfo(id);
    if (!ownsRequest()) return;
    setWalletShareInfo(shareInfo);
  }, [
    applyAuxiliaryData,
    id,
    navigate,
    ownership,
    routeKey,
    user,
  ]);

  useEffect(() => {
    void fetchData();
  }, [id, user]);

  // Refetch wallet data when window becomes visible (handles missed WS events)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && id && user) {
        void fetchData(true);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [id, user]);

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
