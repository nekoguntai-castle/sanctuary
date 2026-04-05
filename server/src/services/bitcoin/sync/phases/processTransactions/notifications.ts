/**
 * Transaction Notifications
 *
 * Queues push notifications via the worker's notification queue for
 * retry-capable delivery, and sends WebSocket events inline.
 */

import { createLogger } from '../../../../../utils/logger';
import type { TransactionCreateData } from '../../types';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

/**
 * Send notifications for new transactions
 */
export async function sendNotifications(
  walletId: string,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  try {
    // Try to queue push notifications via the worker's notification queue.
    // Test the first transaction — if it fails, Redis is unavailable and
    // we fall back to inline delivery for everything.
    let useQueue = false;
    if (newTransactions.length > 0) {
      const { queueTransactionNotification } = await import('../../../../../infrastructure');
      const first = newTransactions[0];
      useQueue = await queueTransactionNotification({
        walletId,
        txid: first.txid,
        type: first.type as 'received' | 'sent' | 'consolidation',
        amount: first.amount.toString(),
      });

      if (useQueue && newTransactions.length > 1) {
        // Queue the remaining transactions in parallel
        await Promise.all(newTransactions.slice(1).map(tx =>
          queueTransactionNotification({
            walletId,
            txid: tx.txid,
            type: tx.type as 'received' | 'sent' | 'consolidation',
            amount: tx.amount.toString(),
          })
        ));
      }
    }

    // Fallback: inline delivery when queue is unavailable
    if (!useQueue && newTransactions.length > 0) {
      const { notifyNewTransactions } = await import('../../../../notifications/notificationService');
      notifyNewTransactions(walletId, newTransactions.map(tx => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
      }))).catch(err => {
        log.warn(`[SYNC] Failed to send inline notification: ${err}`);
      });
    }

    // WebSocket events (always inline — they're cheap and real-time)
    const { getNotificationService } = await import('../../../../../websocket/notifications');
    const notificationService = getNotificationService();
    for (const tx of newTransactions) {
      notificationService.broadcastTransactionNotification({
        txid: tx.txid,
        walletId,
        type: tx.type as 'received' | 'sent' | 'consolidation',
        amount: Number(tx.amount),
        confirmations: tx.confirmations || 0,
        blockHeight: tx.blockHeight ?? undefined,
        timestamp: tx.blockTime || new Date(),
      });
    }
  } catch (notifyError) {
    log.warn(`[SYNC] Failed to send notifications: ${notifyError}`);
  }
}
