/**
 * Notification Broadcasts
 *
 * All WebSocket broadcast methods for different event types.
 * Each method routes through the typed WebSocket broadcast helpers.
 */

import { getWebSocketServerIfInitialized, WebSocketEvent } from '../server';
import {
  broadcastTransaction,
  broadcastBalance,
  broadcastBlock,
  broadcastNewBlock as broadcastTypedNewBlock,
  broadcastMempool,
  broadcastConfirmation,
  broadcastSync,
  broadcastLog,
} from '../broadcast';
import { redisBridge } from '../redisBridge';
import { walletLogBuffer } from '../../services/walletLogBuffer';
import { createLogger } from '../../utils/logger';
import type {
  TransactionNotification,
  BalanceUpdate,
  BlockNotification,
  MempoolNotification,
  WalletLogEntry,
  SyncStatusUpdate,
  ConfirmationUpdate,
} from './types';

const log = createLogger('WS:NOTIFY_BROADCAST');

/**
 * Decide whether an event has anywhere to go.
 *
 * The API process broadcasts to its own clients. Background processes (the
 * worker) never initialize a WebSocket server, so their only route to the UI is
 * the Redis bridge - the broadcast helpers publish onto it and the API process
 * fans the event out unchanged.
 */
function canBroadcast(eventType: WebSocketEvent['type']): boolean {
  if (getWebSocketServerIfInitialized()) return true;
  if (redisBridge.isActive()) return true;

  log.debug('Skipping websocket broadcast; server not initialized', { type: eventType });
  return false;
}

/**
 * Broadcast transaction notification
 */
export function broadcastTransactionNotification(notification: TransactionNotification): void {
  if (!canBroadcast('transaction')) return;

  broadcastTransaction(notification.walletId, {
    txid: notification.txid,
    type: notification.type,
    amount: notification.amount,
    confirmations: notification.confirmations,
    blockHeight: notification.blockHeight,
    timestamp: notification.timestamp,
  });
  log.debug(`Broadcast transaction notification: ${notification.txid}`);
}

/**
 * Broadcast balance update
 */
export function broadcastBalanceUpdate(update: BalanceUpdate): void {
  if (!canBroadcast('balance')) return;

  broadcastBalance(update.walletId, {
    balance: update.balance,
    unconfirmed: update.unconfirmed,
    change: update.change,
    timestamp: new Date(),
  });
  log.debug(`Broadcast balance update for wallet: ${update.walletId}`);
}

/**
 * Broadcast new block notification (full details)
 */
export function broadcastBlockNotification(notification: BlockNotification): void {
  if (!canBroadcast('block')) return;

  broadcastBlock({
    height: notification.height,
    hash: notification.hash,
    timestamp: notification.timestamp,
    transactionCount: notification.transactionCount,
  });
  log.debug(`Broadcast new block: ${notification.height}`);
}

/**
 * Broadcast new block notification (minimal - just height)
 * Used by real-time Electrum subscription
 */
export function broadcastNewBlock(block: { height: number }): void {
  if (!canBroadcast('newBlock')) return;

  broadcastTypedNewBlock({
    height: block.height,
    timestamp: new Date(),
  });
  log.info(`New block at height ${block.height}`);
}

/**
 * Broadcast mempool notification
 */
export function broadcastMempoolNotification(notification: MempoolNotification): void {
  if (!canBroadcast('mempool')) return;

  broadcastMempool({
    txid: notification.txid,
    fee: notification.fee,
    size: notification.size,
    feeRate: notification.feeRate,
  });
}

/**
 * Broadcast confirmation update for a transaction
 * Includes previousConfirmations so frontend can detect milestone transitions (e.g., 0->1)
 */
export function broadcastConfirmationUpdate(walletId: string, update: ConfirmationUpdate): void {
  if (!canBroadcast('confirmation')) return;

  broadcastConfirmation(walletId, {
    txid: update.txid,
    confirmations: update.confirmations,
    previousConfirmations: update.previousConfirmations,
    timestamp: new Date(),
  });

  // Log at info level for first confirmation milestone (0->1)
  if (update.previousConfirmations === 0 && update.confirmations >= 1) {
    log.info(`First confirmation: ${update.txid.slice(0, 8)}... (${update.confirmations} confs)`);
  } else {
    log.debug(`Broadcast confirmation update: ${update.txid} (${update.previousConfirmations ?? '?'}->${update.confirmations} confs)`);
  }
}

/**
 * Broadcast sync status update for a wallet
 */
export function broadcastSyncStatus(walletId: string, status: SyncStatusUpdate): void {
  if (!canBroadcast('sync')) return;

  broadcastSync(walletId, {
    ...status,
    timestamp: new Date(),
  });
}

/**
 * Broadcast wallet log entry for real-time sync logging
 * Also stores the entry in the log buffer for later retrieval
 */
export function broadcastWalletLog(walletId: string, entry: Omit<WalletLogEntry, 'id' | 'timestamp'>): void {
  const logEntry: WalletLogEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Store in buffer for historical retrieval
  walletLogBuffer.add(walletId, logEntry);

  if (!canBroadcast('log')) return;

  broadcastLog(walletId, logEntry);
}
