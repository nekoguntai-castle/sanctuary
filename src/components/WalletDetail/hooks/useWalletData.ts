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
import type { ListEpochToken } from '../../../hooks/usePaginatedList';

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
  const addressSummaryRef = useRef<transactionsApi.AddressSummary | null>(null);

  // Memoize wallet addresses to prevent infinite re-renders in TransactionList
  const walletAddressStrings = useMemo(() => addrList.items.map(a => a.address), [addrList.items]);

  const [draftsCount, setDraftsCount] = useState(0);

  const [explorerUrl, setExplorerUrl] = useState(getDefaultNodeExternalServiceUrl('mainnet'));

  const [users] = useState<User[]>([]);
  const [groups, setGroups] = useState<authApi.UserGroup[]>([]);
  const [walletShareInfo, setWalletShareInfo] = useState<walletsApi.WalletShareInfo | null>(null);

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
    addressSummaryRef.current = null;
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
    const listToken = addrList.captureEpoch();
    if (!ownsRoute(routeToken, walletId)) return;
    const summary = await loadAddressSummaryLoader(walletId);
    if (summary && ownsRoute(routeToken, walletId) && addrList.isEpochOwner(listToken)) {
      addressSummaryRef.current = summary;
      setAddressSummary(summary);
      addrList.setHasMoreForEpoch(listToken, summary.totalAddresses);
    }
  };

  const loadAddressReplacement = async (walletId: string, limit: number) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    const replacement = addrList.beginReplacement();

    try {
      const [formattedAddrs, replacementSummary] = await Promise.all([
        loadAddressPage(walletId, 0, limit),
        loadAddressSummaryLoader(walletId),
      ]);
      const hasMore = replacementSummary
        ? formattedAddrs.length < replacementSummary.totalAddresses
        : formattedAddrs.length === limit;
      if (!ownsRoute(routeToken, walletId)) return;
      if (addrList.commitReplacement(replacement, formattedAddrs, formattedAddrs.length, hasMore)) {
        addressSummaryRef.current = replacementSummary;
        setAddressSummary(replacementSummary);
      }
    } catch (err) {
      logError(log, err, 'Failed to load addresses');
      if (ownsRoute(routeToken, walletId)) addrList.failReplacement(replacement);
    }
  };

  const loadAddressContinuation = async (walletId: string, limit: number) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    const continuation = addrList.claimContinuation();
    if (!continuation) return;

    try {
      const formattedAddrs = await loadAddressPage(walletId, continuation.offset, limit);
      if (!ownsRoute(routeToken, walletId)) return;
      const summary = addressSummaryRef.current;
      addrList.commitContinuation(
        continuation,
        formattedAddrs,
        summary?.totalAddresses ?? limit,
        summary ? 'total' : 'pageSize',
      );
    } catch (err) {
      logError(log, err, 'Failed to load addresses');
      if (ownsRoute(routeToken, walletId)) addrList.failContinuation(continuation);
    }
  };

  const loadAddressesFn = async (walletId: string, limit: number, _offset: number, reset = false) => {
    if (reset) return loadAddressReplacement(walletId, limit);
    return loadAddressContinuation(walletId, limit);
  };

  const loadUtxos = async (walletId: string, limit: number, _offset: number) => {
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    const continuation = utxoList.claimContinuation();
    if (!continuation) return;

    try {
      const page = await loadUtxoPage(walletId, continuation.offset, limit);
      if (!ownsRoute(routeToken, walletId)) return;
      if (utxoList.commitContinuation(continuation, page.utxos, page.count, 'total')) {
        setUtxoSummary({ count: page.count, totalBalance: page.totalBalance });
      }
    } catch (err) {
      logError(log, err, 'Failed to load UTXOs');
      if (ownsRoute(routeToken, walletId)) utxoList.failContinuation(continuation);
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
    if (!id) return;
    const walletId = id;
    const routeToken = ownership.captureRoute(routeKey);
    if (!ownsRoute(routeToken, walletId)) return;
    const continuation = txList.claimContinuation();
    if (!continuation) return;

    try {
      const formattedTxs = await loadTransactionPage(walletId, continuation.offset, TX_PAGE_SIZE);
      if (!ownsRoute(routeToken, walletId)) return;
      txList.commitContinuation(continuation, formattedTxs, TX_PAGE_SIZE);
    } catch (err) {
      logError(log, err, 'Failed to load more transactions');
      if (ownsRoute(routeToken, walletId) && txList.failContinuation(continuation)) {
        handleError(err, 'Failed to Load More Transactions');
      }
    }
  };

  const loadMoreUtxos = async () => {
    if (!id) return;
    await loadUtxos(id, UTXO_PAGE_SIZE, utxoList.offset);
  };

  const applyAuxiliaryData = useCallback((
    aux: AuxiliaryData,
    walletId: string,
    replacements: {
      addresses: ListEpochToken;
      transactions: ListEpochToken;
      utxos: ListEpochToken;
    },
  ) => {
    if (aux.explorerUrl) setExplorerUrl(aux.explorerUrl);
    setDevices(aux.devices);
    if (aux.transactions !== null) {
      txList.commitReplacement(
        replacements.transactions,
        aux.transactions,
        aux.transactions.length,
        aux.transactions.length === TX_PAGE_SIZE,
      );
      if (aux.transactionStats) setTransactionStats(aux.transactionStats);
    } else {
      txList.failReplacement(replacements.transactions);
    }
    if (aux.utxoPage) {
      utxoList.commitReplacement(
        replacements.utxos,
        aux.utxoPage.utxos,
        aux.utxoPage.utxos.length,
        aux.utxoPage.utxos.length < aux.utxoPage.count,
      );
      setUtxoSummary({ count: aux.utxoPage.count, totalBalance: aux.utxoPage.totalBalance });
    } else {
      utxoList.failReplacement(replacements.utxos);
    }
    setPrivacyData(aux.privacyData);
    setPrivacySummary(aux.privacySummary);
    if (aux.addresses !== null) {
      const committed = addrList.commitReplacement(
        replacements.addresses,
        aux.addresses,
        aux.addresses.length,
        aux.addressSummary
          ? aux.addresses.length < aux.addressSummary.totalAddresses
          : aux.addresses.length === ADDRESS_PAGE_SIZE,
      );
      if (committed) {
        addressSummaryRef.current = aux.addressSummary;
        setAddressSummary(aux.addressSummary);
      }
    } else {
      addrList.failReplacement(replacements.addresses);
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
    const replacements = {
      addresses: addrList.beginReplacement(),
      transactions: txList.beginReplacement(),
      utxos: utxoList.beginReplacement(),
    };
    const failReplacements = () => {
      addrList.failReplacement(replacements.addresses);
      txList.failReplacement(replacements.transactions);
      utxoList.failReplacement(replacements.utxos);
    };

    if (!isRefresh) setLoading(true);
    setError(null);

    // 1. Fetch core wallet -- critical, fail-fast
    let apiWallet: Wallet;
    try {
      apiWallet = await fetchWalletCore(id);
    } catch (err) {
      log.error('Failed to fetch wallet', { error: err });
      if (!ownsRequest()) return;
      failReplacements();
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
    const aux: AuxiliaryData = await fetchAuxiliaryData(id, apiWallet, user.id, {
      tx: TX_PAGE_SIZE,
      utxo: UTXO_PAGE_SIZE,
      address: ADDRESS_PAGE_SIZE,
    });
    if (!ownsRequest()) return;

    applyAuxiliaryData(aux, id, replacements);

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
    setTransactions: txList.mutateItems,
    transactionStats,
    txOffset: txList.offset,
    hasMoreTx: txList.hasMore,
    loadingMoreTx: txList.loading,
    loadMoreTransactions,

    // UTXOs
    utxos: utxoList.items,
    setUTXOs: utxoList.mutateItems,
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
    setAddresses: addrList.mutateItems,
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
