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
    // dispatchTransactionNotifications encapsulates the "try queue, fall back
    // to inline" pattern so every notification path has the same retry
    // semantics regardless of caller.
    if (newTransactions.length > 0) {
      const { dispatchTransactionNotifications } = await import('../../../../notifications/dispatch');
      dispatchTransactionNotifications(walletId, newTransactions.map(tx => ({
        txid: tx.txid,
        type: tx.type,
        amount: tx.amount,
        feeSats: tx.fee ?? null,
      }))).catch(err => {
        log.warn(`[SYNC] Failed to dispatch notifications: ${err}`);
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
