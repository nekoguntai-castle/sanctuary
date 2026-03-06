/**
 * Reconcile UTXOs Phase
 *
 * Makes the blockchain authoritative for UTXO state:
 * - Marks UTXOs as spent if no longer on blockchain
 * - Updates confirmations for existing UTXOs
 * - Invalidates draft transactions using spent UTXOs
 */

import { db as prisma } from '../../../../repositories/db';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

const log = createLogger('SYNC-RECONCILE');

/**
 * Execute reconcile UTXOs phase
 *
 * Compares database UTXOs against blockchain state and reconciles:
 * 1. UTXOs no longer on blockchain → mark as spent
 * 2. UTXOs with changed confirmations → update
 * 3. Draft transactions using spent UTXOs → invalidate
 */
export async function reconcileUtxosPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, currentBlockHeight, allUtxoKeys, utxoDataMap, successfullyFetchedAddresses } = ctx;

  walletLog(walletId, 'info', 'SYNC', `Reconciling ${allUtxoKeys.size} UTXOs with database...`);

  // Get all UTXOs from DB (both spent and unspent)
  const existingUtxos = await prisma.uTXO.findMany({
    where: { walletId },
    select: {
      id: true,
      txid: true,
      vout: true,
      spent: true,
      confirmations: true,
      blockHeight: true,
      address: true,
    },
  });

  const existingUtxoMap = new Map(existingUtxos.map(u => [`${u.txid}:${u.vout}`, u]));

  const utxosToMarkSpent: string[] = [];
  const utxosToUpdate: Array<{ id: string; confirmations: number; blockHeight: number | null }> = [];

  for (const [key, dbUtxo] of existingUtxoMap) {
    const blockchainUtxo = utxoDataMap.get(key);

    if (!blockchainUtxo) {
      // UTXO not found on blockchain - only mark as spent if we successfully queried the address
      // This prevents incorrectly marking UTXOs as spent when blockchain fetch fails
      if (!dbUtxo.spent && successfullyFetchedAddresses.has(dbUtxo.address)) {
        utxosToMarkSpent.push(dbUtxo.id);
      }
    } else {
      // UTXO still exists - update confirmations if changed
      const utxo = blockchainUtxo.utxo;
      const newConfirmations = utxo.height > 0
        ? Math.max(0, currentBlockHeight - utxo.height + 1)
        : 0;
      const newBlockHeight = utxo.height > 0 ? utxo.height : null;

      if (dbUtxo.confirmations !== newConfirmations || dbUtxo.blockHeight !== newBlockHeight) {
        utxosToUpdate.push({
          id: dbUtxo.id,
          confirmations: newConfirmations,
          blockHeight: newBlockHeight,
        });
      }
    }
  }

  // Batch mark spent UTXOs
  if (utxosToMarkSpent.length > 0) {
    await prisma.uTXO.updateMany({
      where: { id: { in: utxosToMarkSpent } },
      data: { spent: true },
    });

    ctx.stats.utxosMarkedSpent = utxosToMarkSpent.length;
    walletLog(walletId, 'info', 'UTXO', `Marked ${utxosToMarkSpent.length} UTXOs as spent (no longer on blockchain)`);

    // Find and invalidate draft transactions using these spent UTXOs
    const affectedLocks = await prisma.draftUtxoLock.findMany({
      where: { utxoId: { in: utxosToMarkSpent } },
      select: {
        draftId: true,
        draft: { select: { id: true, label: true, recipient: true } },
      },
    });

    if (affectedLocks.length > 0) {
      const uniqueDraftIds = [...new Set(affectedLocks.map(lock => lock.draftId))];
      const draftLabels = affectedLocks
        .filter(lock => lock.draft.label)
        .map(lock => lock.draft.label)
        .filter((label, idx, arr) => arr.indexOf(label) === idx);

      // Delete the invalidated drafts (UTXO locks cascade delete)
      await prisma.draftTransaction.deleteMany({
        where: { id: { in: uniqueDraftIds } },
      });

      walletLog(
        walletId,
        'info',
        'DRAFT',
        `Invalidated ${uniqueDraftIds.length} draft(s) due to spent UTXOs${draftLabels.length > 0 ? `: ${draftLabels.join(', ')}` : ''}`
      );
    }
  }

  // Batch update UTXO confirmations in chunks to avoid long-held locks
  if (utxosToUpdate.length > 0) {
    const UTXO_BATCH_SIZE = 200;
    for (let i = 0; i < utxosToUpdate.length; i += UTXO_BATCH_SIZE) {
      const chunk = utxosToUpdate.slice(i, i + UTXO_BATCH_SIZE);
      await prisma.$transaction(
        chunk.map(u =>
          prisma.uTXO.update({
            where: { id: u.id },
            data: { confirmations: u.confirmations, blockHeight: u.blockHeight },
          })
        )
      );
    }
    log.debug(`[SYNC] Updated confirmations for ${utxosToUpdate.length} UTXOs`);
  }

  // Log debug info
  const newUtxoCount = Array.from(allUtxoKeys).filter(
    key => !existingUtxoMap.has(key)
  ).length;

  log.debug(
    `[SYNC] Found ${newUtxoCount} new UTXOs (${existingUtxoMap.size} already exist, ${utxosToMarkSpent.length} marked spent)`
  );

  return ctx;
}
