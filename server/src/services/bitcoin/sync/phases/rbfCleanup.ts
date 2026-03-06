/**
 * RBF Cleanup Phase
 *
 * Marks pending transactions as replaced if a confirmed transaction
 * shares the same inputs. This catches RBF replacements from external
 * software or prior syncs.
 */

import { db as prisma } from '../../../../repositories/db';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

const log = createLogger('SYNC-RBF');

/**
 * Execute RBF cleanup phase
 *
 * This phase runs at the start of sync to:
 * 1. Find pending transactions with stored inputs
 * 2. Check if any confirmed transaction uses the same inputs
 * 3. Mark the pending tx as "replaced" and link to the replacement
 * 4. Also repair orphaned replaced transactions (missing replacedByTxid)
 */
export async function rbfCleanupPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId } = ctx;

  // Find pending transactions that have inputs stored
  const pendingTxsWithInputs = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: { some: {} },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });

  // Batch: collect all inputs from pending txs and find confirmed replacements in one query
  if (pendingTxsWithInputs.length > 0) {
    const allPendingInputs = pendingTxsWithInputs.flatMap(tx => tx.inputs);
    const pendingTxids = new Set(pendingTxsWithInputs.map(tx => tx.txid));

    // Single query: find all confirmed txs sharing any input with pending txs
    const confirmedWithSharedInputs = await prisma.transaction.findMany({
      where: {
        walletId,
        confirmations: { gt: 0 },
        inputs: {
          some: {
            OR: allPendingInputs.map(i => ({ txid: i.txid, vout: i.vout })),
          },
        },
      },
      select: {
        txid: true,
        inputs: { select: { txid: true, vout: true } },
      },
    });

    // Build a map: "inputTxid:vout" → confirmed txid
    const inputToConfirmedTxid = new Map<string, string>();
    for (const confirmed of confirmedWithSharedInputs) {
      if (pendingTxids.has(confirmed.txid)) continue; // Skip self-matches
      for (const input of confirmed.inputs) {
        inputToConfirmedTxid.set(`${input.txid}:${input.vout}`, confirmed.txid);
      }
    }

    // Match pending txs to their replacements in memory
    for (const pendingTx of pendingTxsWithInputs) {
      const replacementTxid = pendingTx.inputs
        .map(i => inputToConfirmedTxid.get(`${i.txid}:${i.vout}`))
        .find(Boolean);

      if (replacementTxid) {
        await prisma.transaction.update({
          where: { id: pendingTx.id },
          data: {
            rbfStatus: 'replaced',
            replacedByTxid: replacementTxid,
          },
        });

        walletLog(
          walletId,
          'info',
          'RBF',
          `Cleanup: Marked ${pendingTx.txid.slice(0, 8)}... as replaced by ${replacementTxid.slice(0, 8)}...`
        );
      }
    }
  }

  // Retroactive RBF linking: Find replaced transactions without replacedByTxid
  const unlinkedReplacedTxs = await prisma.transaction.findMany({
    where: {
      walletId,
      rbfStatus: 'replaced',
      replacedByTxid: null,
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });

  if (unlinkedReplacedTxs.length > 0) {
    const txsWithInputs = unlinkedReplacedTxs.filter(tx => tx.inputs.length > 0);

    if (txsWithInputs.length > 0) {
      const allUnlinkedInputs = txsWithInputs.flatMap(tx => tx.inputs);
      const unlinkedTxids = new Set(txsWithInputs.map(tx => tx.txid));

      // Single query: find all confirmed txs sharing any input
      const confirmedMatches = await prisma.transaction.findMany({
        where: {
          walletId,
          confirmations: { gt: 0 },
          inputs: {
            some: {
              OR: allUnlinkedInputs.map(i => ({ txid: i.txid, vout: i.vout })),
            },
          },
        },
        select: {
          txid: true,
          inputs: { select: { txid: true, vout: true } },
        },
      });

      // Build input → confirmed txid map
      const inputToConfirmed = new Map<string, string>();
      for (const confirmed of confirmedMatches) {
        if (unlinkedTxids.has(confirmed.txid)) continue;
        for (const input of confirmed.inputs) {
          inputToConfirmed.set(`${input.txid}:${input.vout}`, confirmed.txid);
        }
      }

      // Match in memory
      for (const replacedTx of txsWithInputs) {
        const replacementTxid = replacedTx.inputs
          .map(i => inputToConfirmed.get(`${i.txid}:${i.vout}`))
          .find(Boolean);

        if (replacementTxid) {
          await prisma.transaction.update({
            where: { id: replacedTx.id },
            data: { replacedByTxid: replacementTxid },
          });

          walletLog(
            walletId,
            'info',
            'RBF',
            `Retroactive link: ${replacedTx.txid.slice(0, 8)}... replaced by ${replacementTxid.slice(0, 8)}...`
          );
        }
      }
    }
  }

  return ctx;
}
