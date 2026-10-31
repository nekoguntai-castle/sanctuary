/**
 * Transaction Notifications
 *
 * Queues push notifications via the worker's notification queue for
 * retry-capable delivery, and sends WebSocket events inline.
 */

import { createLogger } from '../../../../../utils/logger';
import type { SyncContext, TransactionCreateData } from '../../types';
import { hasRepairableIncompleteInput } from './classification';

const log = createLogger('BITCOIN:SVC_SYNC_TX');

/**
 * Baseline syncs (first sync after import or full resync) rediscover history;
 * only unconfirmed transactions are news worth notifying about there.
 */
export function filterNotifiableTransactions(
  transactions: TransactionCreateData[],
  isBaselineSync: boolean
): TransactionCreateData[] {
  if (!isBaselineSync) return transactions;
  return transactions.filter(tx => (tx.confirmations ?? 0) === 0);
}

/**
 * An incomplete 'received' classification that a later sync could repair may
 * be the change of the wallet's own spend (its parent could not be fetched).
 * It is persisted as an incomplete, repairable row but announced only once a
 * repair proves its authoritative classification. Rows announced at creation
 * can never be repaired, so they are never announced twice.
 */
export function selectAnnounceableTransactions(
  ctx: SyncContext,
  created: TransactionCreateData[],
  repaired: TransactionCreateData[],
): TransactionCreateData[] {
  return [
    ...created.filter(transaction => transaction.type !== 'received'
      || transaction.classificationInputsComplete
      || !hasRepairableIncompleteInput(ctx, transaction.txid)),
    ...repaired.filter(transaction => ctx.incompleteReceiveTxids.has(transaction.txid)),
  ];
}

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
      const { dispatchTransactionNotifications } = await import('../../../../notifications/dispatch.js');
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
    const { getNotificationService } = await import('../../../../../websocket/notifications/index.js');
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
