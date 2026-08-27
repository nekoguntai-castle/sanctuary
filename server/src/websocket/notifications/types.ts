/**
 * Notification Types
 *
 * Type definitions for all notification events broadcast via WebSocket.
 */

import type { SyncEvent } from '@sanctuary/shared/types/websocket';
import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';

export interface TransactionNotification {
  txid: string;
  walletId: string;
  type: 'received' | 'sent' | 'consolidation';
  amount: number; // satoshis
  confirmations: number;
  blockHeight?: number;
  timestamp: Date;
}

export interface BalanceUpdate {
  walletId: string;
  balance: number; // satoshis
  unconfirmed: number; // satoshis
  previousBalance: number;
  change: number;
}

export interface BlockNotification {
  network: NetworkType;
  height: number;
  hash: string;
  timestamp: Date;
  transactionCount: number;
}

export interface NewBlockNotification {
  network: NetworkType;
  height: number;
}

export interface MempoolNotification {
  txid: string;
  fee: number; // satoshis
  size: number; // bytes
  feeRate: number; // sat/vB
}

// Wallet Log Types for real-time sync logging
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface WalletLogEntry {
  id: string;
  sequence?: number;
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  details?: Record<string, unknown>;
}

export type SyncStatusUpdate = Omit<SyncEvent['data'], 'timestamp'>;

export interface ConfirmationUpdate {
  txid: string;
  confirmations: number;
  previousConfirmations?: number;
}
