/**
 * Notification Types
 *
 * Type definitions for all notification events broadcast via WebSocket.
 */

import type { SyncEvent } from '@sanctuary/shared/types/websocket';

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
  height: number;
  hash: string;
  timestamp: Date;
  transactionCount: number;
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
