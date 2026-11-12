/**
 * Transaction Event Emitters
 *
 * Handles emission of transaction-related events to the event bus and WebSocket.
 */

import { eventBus } from '../../events/eventBus';
import { broadcastTransaction, broadcastConfirmation } from '../../websocket/broadcast';
import { createLogger } from '../../utils/logger';
import type { TransactionBroadcastResult, TransactionReceivedData, TransactionConfirmationData } from './types';

const log = createLogger('EVENT:SVC_TX');

/**
 * Emit transaction sent (broadcast) event
 */
export function emitTransactionSent(data: TransactionBroadcastResult): void {
  eventBus.emit('transaction:sent', {
    walletId: data.walletId,
    txid: data.txid,
    amount: data.amount,
    fee: data.fee,
    recipients: data.recipients,
  });

  // Also emit broadcast event with raw tx
  if (data.rawTx) {
    eventBus.emit('transaction:broadcast', {
      walletId: data.walletId,
      txid: data.txid,
      rawTx: data.rawTx,
    });
  }

  broadcastTransaction(data.walletId, {
    txid: data.txid,
    type: data.type ?? 'sent',
    // Negative for an outflow. A consolidation moves funds within the wallet,
    // so it costs only the fee; that is also the amount persisted for it.
    amount: data.type === 'consolidation' ? -Number(data.fee) : -Number(data.amount),
    confirmations: 0,
    timestamp: new Date(),
  });

  log.info('Emitted transaction:sent', {
    walletId: data.walletId,
    txid: data.txid,
    amount: data.amount.toString(),
  });
}

/**
 * Emit transaction received event
 */
export function emitTransactionReceived(data: TransactionReceivedData): void {
  eventBus.emit('transaction:received', data);

  broadcastTransaction(data.walletId, {
    txid: data.txid,
    type: 'received',
    amount: Number(data.amount),
    confirmations: data.confirmations,
    timestamp: new Date(),
  });

  log.info('Emitted transaction:received', {
    walletId: data.walletId,
    txid: data.txid,
    amount: data.amount.toString(),
  });
}

/**
 * Emit transaction confirmed event
 */
export function emitTransactionConfirmed(data: TransactionConfirmationData): void {
  eventBus.emit('transaction:confirmed', {
    walletId: data.walletId,
    txid: data.txid,
    confirmations: data.confirmations,
    blockHeight: data.blockHeight,
  });

  broadcastConfirmation(data.walletId, {
    txid: data.txid,
    confirmations: data.confirmations,
    previousConfirmations: data.previousConfirmations,
  });

  log.debug('Emitted transaction:confirmed', {
    txid: data.txid,
    confirmations: data.confirmations,
  });
}

/**
 * Emit RBF replacement event
 */
export function emitTransactionReplaced(walletId: string, originalTxid: string, replacementTxid: string): void {
  eventBus.emit('transaction:rbfReplaced', {
    walletId,
    originalTxid,
    replacementTxid,
  });

  log.info('Emitted transaction:rbfReplaced', {
    walletId,
    originalTxid,
    replacementTxid,
  });
}
