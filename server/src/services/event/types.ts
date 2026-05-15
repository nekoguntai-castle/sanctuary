/**
 * Event Service Types
 *
 * Shared interfaces used across event service submodules.
 */

import type { WalletType } from '@sanctuary/shared/constants/walletIdentity';

/**
 * Wallet sync result for emission
 */
export interface WalletSyncResult {
  walletId: string;
  balance: bigint;
  unconfirmedBalance: bigint;
  transactionCount: number;
  duration: number;
  isFullResync?: boolean;
}

/**
 * Transaction broadcast result
 */
export interface TransactionBroadcastResult {
  walletId: string;
  txid: string;
  amount: bigint;
  fee: bigint;
  recipients: Array<{ address: string; amount: bigint }>;
  rawTx?: string;
}

/**
 * Transaction received data
 */
export interface TransactionReceivedData {
  walletId: string;
  txid: string;
  amount: bigint;
  address: string;
  confirmations: number;
}

/**
 * Transaction confirmation update
 */
export interface TransactionConfirmationData {
  walletId: string;
  txid: string;
  confirmations: number;
  blockHeight: number;
  previousConfirmations?: number;
}

/**
 * Balance change data
 */
export interface BalanceChangeData {
  walletId: string;
  previousBalance: bigint;
  newBalance: bigint;
  unconfirmedBalance?: bigint;
}

/**
 * Wallet creation data
 */
export interface WalletCreatedData {
  walletId: string;
  userId: string;
  name: string;
  type: WalletType;
  network: string;
}

/**
 * User login data
 */
export interface UserLoginData {
  userId: string;
  username: string;
  ipAddress?: string;
}

/**
 * Device registered data
 */
export interface DeviceRegisteredData {
  deviceId: string;
  userId: string;
  type: string;
  fingerprint: string;
}
