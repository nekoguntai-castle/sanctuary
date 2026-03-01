/**
 * Transaction Notifications
 *
 * Sends push notifications and WebSocket events for new transactions.
 */

import { createLogger } from '../../../../../utils/logger';
import type { TransactionCreateData } from '../../types';

const log = createLogger('SYNC-TX');

/**
 * Send notifications for new transactions
 */
export async function sendNotifications(
  walletId: string,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  try {
    // Push notifications
    const { notifyNewTransactions } = await import('../../../../notifications/notificationService');
    notifyNewTransactions(walletId, newTransactions.map(tx => ({
      txid: tx.txid,
      type: tx.type,
      amount: tx.amount,
    }))).catch(err => {
      log.warn(`[SYNC] Failed to send notifications: ${err}`);
    });

    // WebSocket events
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
