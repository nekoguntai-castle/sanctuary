/**
 * Wallet Data Loaders
 *
 * Pure async functions that fetch data from the API and return plain objects.
 * No React state is set here -- the caller (useWalletData) is responsible for
 * applying results to component state.
 */

import type {
  Transaction, UTXO, Device, User, Address, Wallet,
} from '../../../types';
import { WalletType } from '../../../types';
import * as walletsApi from '../../../src/api/wallets';
import * as transactionsApi from '../../../src/api/transactions';
import * as devicesApi from '../../../src/api/devices';
import * as bitcoinApi from '../../../src/api/bitcoin';
import * as draftsApi from '../../../src/api/drafts';
import * as privacyApi from '../../../src/api/transactions';
import * as authApi from '../../../src/api/auth';
import * as adminApi from '../../../src/api/admin';
import { formatApiTransaction, formatApiUtxo } from '../mappers';
import { formatWalletFromApi, formatDevicesForWallet } from './walletDataFormatters';
import { createLogger } from '../../../utils/logger';
import { logError } from '../../../utils/errorHandler';

const log = createLogger('walletDataLoaders');

// ---------------------------------------------------------------------------
// Address loaders
// ---------------------------------------------------------------------------

/**
 * Fetch the address summary (counts, balances) for a wallet.
 */
export async function loadAddressSummary(
  walletId: string,
): Promise<transactionsApi.AddressSummary | null> {
  try {
    return await transactionsApi.getAddressSummary(walletId);
  } catch (err) {
    logError(log, err, 'Failed to load address summary');
    return null;
  }
}

/**
 * Fetch a page of addresses for a wallet.
 * Returns the formatted addresses and the count fetched.
 */
export async function loadAddressPage(
  walletId: string,
  offset: number,
  pageSize: number,
): Promise<Address[]> {
  const apiAddresses = await transactionsApi.getAddresses(walletId, { limit: pageSize, offset });

  return apiAddresses.map(addr => ({
    id: addr.id,
    address: addr.address,
    derivationPath: addr.derivationPath,
    index: addr.index,
    used: addr.used,
    balance: addr.balance || 0,
    isChange: addr.isChange,
    labels: addr.labels || [],
    walletId,
  }));
}

// ---------------------------------------------------------------------------
// UTXO loaders
// ---------------------------------------------------------------------------

/** Result from a paginated UTXO load */
export interface UtxoPageResult {
  utxos: UTXO[];
  count: number;
  totalBalance: number;
}

/**
 * Fetch a page of UTXOs for a wallet.
 * Returns formatted UTXOs plus summary counts.
 */
export async function loadUtxoPage(
  walletId: string,
  offset: number,
  pageSize: number,
): Promise<UtxoPageResult> {
  const utxoData = await transactionsApi.getUTXOs(walletId, { limit: pageSize, offset });
  return {
    utxos: utxoData.utxos.map(formatApiUtxo),
    count: utxoData.count,
    totalBalance: utxoData.totalBalance,
  };
}

/**
 * Fetch all UTXOs for stats calculation (no pagination limit).
 */
export async function loadUtxosForStats(
  walletId: string,
): Promise<UTXO[]> {
  const utxoData = await transactionsApi.getUTXOs(walletId);
  return utxoData.utxos.map(formatApiUtxo);
}

// ---------------------------------------------------------------------------
// Transaction loaders
// ---------------------------------------------------------------------------

/**
 * Fetch a page of transactions for a wallet.
 * Returns formatted transactions.
 */
export async function loadTransactionPage(
  walletId: string,
  offset: number,
  pageSize: number,
): Promise<Transaction[]> {
  const apiTransactions = await transactionsApi.getTransactions(walletId, {
    limit: pageSize,
    offset,
  });
  return apiTransactions.map(tx => formatApiTransaction(tx, walletId));
}

// ---------------------------------------------------------------------------
// Core wallet data loader
// ---------------------------------------------------------------------------

/**
 * Fetch the core wallet object from the API.
 * Returns the raw API wallet (caller should format with `formatWalletFromApi`).
 */
export async function fetchWalletCore(
  walletId: string,
): Promise<Wallet> {
  return walletsApi.getWallet(walletId);
}

// ---------------------------------------------------------------------------
// Auxiliary data loader
// ---------------------------------------------------------------------------

/** Shape of the non-critical auxiliary data fetched alongside the wallet.
 *  Nullable arrays indicate the fetch failed (vs. an empty result). */
export interface AuxiliaryData {
  explorerUrl: string | null;
  devices: Device[];
  /** null when the transaction fetch failed */
  transactions: Transaction[] | null;
  transactionStats: transactionsApi.TransactionStats | null;
  utxoPage: UtxoPageResult | null;
  privacyData: privacyApi.UtxoPrivacyInfo[];
  privacySummary: privacyApi.WalletPrivacySummary | null;
  addressSummary: transactionsApi.AddressSummary | null;
  /** null when the address fetch failed */
  addresses: Address[] | null;
  drafts: draftsApi.DraftTransaction[];
}

/**
 * Fetch all auxiliary/secondary data for a wallet in parallel.
 * Each sub-fetch has independent error handling and will not block others.
 */
export async function fetchAuxiliaryData(
  walletId: string,
  apiWallet: Wallet,
  userId: string,
  pageSize: { tx: number; utxo: number; address: number },
): Promise<AuxiliaryData> {
  const result: AuxiliaryData = {
    explorerUrl: null,
    devices: [],
    transactions: null,
    transactionStats: null,
    utxoPage: null,
    privacyData: [],
    privacySummary: null,
    addressSummary: null,
    addresses: null,
    drafts: [],
  };

  const settled = await Promise.allSettled([
    // 0 - Explorer URL
    bitcoinApi.getStatus().then(status => {
      result.explorerUrl = status.explorerUrl ?? null;
    }),

    // 1 - Devices
    devicesApi.getDevices().then(allDevices => {
      result.devices = formatDevicesForWallet(allDevices, apiWallet, walletId, userId);
    }),

    // 2 - Transactions (initial page)
    loadTransactionPage(walletId, 0, pageSize.tx).then(txs => {
      result.transactions = txs;
    }),

    // 3 - Transaction stats
    transactionsApi.getTransactionStats(walletId).then(stats => {
      result.transactionStats = stats;
    }),

    // 4 - UTXOs (first page)
    loadUtxoPage(walletId, 0, pageSize.utxo).then(page => {
      result.utxoPage = page;
    }),

    // 5 - Privacy data
    privacyApi.getWalletPrivacy(walletId).then(privacyResponse => {
      result.privacyData = privacyResponse.utxos;
      result.privacySummary = privacyResponse.summary;
    }),

    // 6 - Address summary
    loadAddressSummary(walletId).then(summary => {
      result.addressSummary = summary;
    }),

    // 7 - Addresses (first page)
    loadAddressPage(walletId, 0, pageSize.address).then(addrs => {
      result.addresses = addrs;
    }),

    // 8 - Drafts
    draftsApi.getDrafts(walletId).then(drafts => {
      result.drafts = drafts;
    }),
  ]);

  // Log any failures at debug level (non-critical)
  settled.forEach((s, i) => {
    if (s.status === 'rejected') {
      log.error(`Auxiliary fetch [${i}] failed`, { error: s.reason });
    }
  });

  return result;
}

// ---------------------------------------------------------------------------
// Groups & sharing loaders
// ---------------------------------------------------------------------------

/**
 * Fetch user groups -- admins see all groups, regular users see their own.
 */
export async function loadGroups(
  user: User,
): Promise<authApi.UserGroup[]> {
  try {
    if (user.isAdmin) {
      const allGroups = await adminApi.getGroups();
      return allGroups.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description || undefined,
        memberCount: g.members?.length || 0,
        memberIds: g.members?.map(m => m.userId) || [],
      }));
    }
    return await authApi.getUserGroups();
  } catch (err) {
    logError(log, err, 'Failed to fetch groups');
    return [];
  }
}

/**
 * Fetch wallet share info (access tab).
 */
export async function loadWalletShareInfo(
  walletId: string,
): Promise<walletsApi.WalletShareInfo | null> {
  try {
    return await walletsApi.getWalletShareInfo(walletId);
  } catch (err) {
    logError(log, err, 'Failed to fetch wallet share info');
    return null;
  }
}
