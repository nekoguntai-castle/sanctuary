/**
 * Confirmation Updater
 *
 * Updates confirmations for all wallets with pending transactions.
 * Queries transactions with < 6 confirmations, populates missing fields,
 * and broadcasts changes via events and WebSocket notifications.
 */

import { db as prisma } from '../../repositories/db';
import { updateTransactionConfirmations, populateMissingTransactionFields } from '../bitcoin/blockchain';
import { getNotificationService } from '../../websocket/notifications';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { eventService } from '../eventService';

const log = createLogger('SYNC:CONFIRM');

/**
 * Update confirmations for all wallets with pending transactions.
 *
 * @param isRunning - Whether the sync service is currently running; returns early if false.
 */
export async function updateAllConfirmations(isRunning: boolean): Promise<void> {
  if (!isRunning) return;

  try {
    // Get all wallets with pending transactions
    const walletsWithPending = await prisma.transaction.findMany({
      where: {
        confirmations: { lt: 6 },
      },
      select: {
        walletId: true,
      },
      distinct: ['walletId'],
    });

    let totalUpdated = 0;

    for (const { walletId } of walletsWithPending) {
      try {
        // First, try to populate missing blockHeight for transactions that were discovered in mempool
        // This handles servers like Blockstream that don't support verbose transaction responses
        const populateResult = await populateMissingTransactionFields(walletId);
        if (populateResult.updated > 0) {
          log.debug(`[SYNC] Populated missing fields for ${populateResult.updated} transactions in wallet ${walletId}`);
        }

        // updateTransactionConfirmations now returns detailed info about changes
        const updates = await updateTransactionConfirmations(walletId);
        totalUpdated += updates.length + populateResult.updated;

        // Combine confirmation updates from both sources
        const allConfirmationUpdates = [...populateResult.confirmationUpdates, ...updates];

        // Notify frontend of updates - only broadcast transactions that actually changed
        if (allConfirmationUpdates.length > 0) {
          const notificationService = getNotificationService();

          for (const update of allConfirmationUpdates) {
            // Emit confirmation event to event bus
            // Note: blockHeight not available in ConfirmationUpdate, use 0 as placeholder
            eventService.emitTransactionConfirmed({
              walletId,
              txid: update.txid,
              confirmations: update.newConfirmations,
              blockHeight: 0,
              previousConfirmations: update.oldConfirmations,
            });

            // Broadcast with milestone info so frontend knows if this is first confirmation
            notificationService.broadcastConfirmationUpdate(walletId, {
              txid: update.txid,
              confirmations: update.newConfirmations,
              previousConfirmations: update.oldConfirmations,
            });
          }
        }
      } catch (error) {
        log.error(`[SYNC] Failed to update confirmations for wallet ${walletId}`, { error: getErrorMessage(error) });
      }
    }

    if (totalUpdated > 0) {
      log.info(`[SYNC] Updated ${totalUpdated} transaction confirmations`);
    }
  } catch (error) {
    log.error('[SYNC] Failed to update confirmations', { error: getErrorMessage(error) });
  }
}
