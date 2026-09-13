/**
 * Wallet Data Types & Constants
 *
 * Shared constants and interface definitions for the useWalletData hook
 * and its associated loader/formatter modules.
 */

import type { Dispatch, SetStateAction } from 'react';
import type {
  Wallet, Transaction, UTXO, Device, User, Address,
} from '../../../types';
import type * as transactionsApi from '../../../api/transactions';
import type * as walletsApi from '../../../api/wallets';
import type * as authApi from '../../../api/auth';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const TX_PAGE_SIZE = 50;
export const UTXO_PAGE_SIZE = 100;
export const ADDRESS_PAGE_SIZE = 25;

// ---------------------------------------------------------------------------
// Hook parameter & return types
// ---------------------------------------------------------------------------

/**
 * Outcome of a data-fetch attempt: `'ok'` completed and applied its results,
 * `'superseded'` was preempted by a newer request/route (not a failure — a
 * silent no-op for callers), and `'failed'` genuinely errored.
 */
export type FetchDataResult = 'ok' | 'superseded' | 'failed';

export interface UseWalletDataParams {
  /** Wallet ID from route params */
  id: string | undefined;
  /** Authenticated user */
  user: User | null;
}

export interface UseWalletDataReturn {
  // Core wallet data
  wallet: Wallet | null;
  setWallet: Dispatch<SetStateAction<Wallet | null>>;
  devices: Device[];
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;

  // Transactions
  transactions: Transaction[];
  setTransactions: Dispatch<SetStateAction<Transaction[]>>;
  transactionStats: transactionsApi.TransactionStats | null;
  txOffset: number;
  hasMoreTx: boolean;
  loadingMoreTx: boolean;
  loadMoreTransactions: () => Promise<void>;

  // UTXOs
  utxos: UTXO[];
  setUTXOs: Dispatch<SetStateAction<UTXO[]>>;
  utxoSummary: { count: number; totalBalance: number } | null;
  hasMoreUtxos: boolean;
  loadingMoreUtxos: boolean;
  loadMoreUtxos: () => Promise<void>;

  // UTXO stats (full dataset for stats tab)
  utxoStats: UTXO[];
  setUtxoStats: Dispatch<SetStateAction<UTXO[]>>;
  loadingUtxoStats: boolean;
  /** Wallet id the stats UTXO set was last attempted (success or failure) for, or null if never attempted for the current route. */
  utxoStatsLoadedFor: string | null;
  loadUtxosForStats: (walletId: string) => Promise<void>;

  // Privacy
  privacyData: transactionsApi.UtxoPrivacyInfo[];
  privacySummary: transactionsApi.WalletPrivacySummary | null;
  showPrivacy: boolean;

  // Addresses
  addresses: Address[];
  setAddresses: Dispatch<SetStateAction<Address[]>>;
  walletAddressStrings: string[];
  addressSummary: transactionsApi.AddressSummary | null;
  hasMoreAddresses: boolean;
  loadingAddresses: boolean;
  loadAddresses: (walletId: string, limit: number, offset: number, reset?: boolean) => Promise<void>;
  loadAddressSummary: (walletId: string) => Promise<void>;
  addressOffset: number;
  ADDRESS_PAGE_SIZE: number;

  // Drafts
  draftsCount: number;
  setDraftsCount: Dispatch<SetStateAction<number>>;

  // Explorer
  explorerUrl: string;

  // Users & Groups
  users: User[];
  groups: authApi.UserGroup[];

  // Share info
  walletShareInfo: walletsApi.WalletShareInfo | null;
  setWalletShareInfo: (info: walletsApi.WalletShareInfo | null) => void;

  // Refresh
  fetchData: (isRefresh?: boolean) => Promise<void>;
  refreshData: () => Promise<FetchDataResult>;
}
