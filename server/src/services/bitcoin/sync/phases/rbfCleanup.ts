/**
 * RBF Cleanup Phase
 *
 * Marks pending transactions as replaced if a confirmed transaction
 * shares the same inputs. This catches RBF replacements from external
 * software or prior syncs.
 */

import { transactionRepository } from '../../../../repositories';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

interface TxWithInputs {
  id: string;
  txid: string;
  inputs: Array<{ txid: string; vout: number }>;
}

/**
 * Build a map from "inputTxid:vout" → confirmed replacement txid,
 * then find the replacement for each pending/unlinked transaction.
 */
function buildInputToConfirmedMap(
  confirmedTxs: Array<{ txid: string; inputs: Array<{ txid: string; vout: number }> }>,
  excludeTxids: Set<string>,
): Map<string, string> {
  const inputToConfirmedTxid = new Map<string, string>();
  for (const confirmed of confirmedTxs) {
    /* v8 ignore next -- exclusion set is populated only for same-batch replacement chains */
    if (excludeTxids.has(confirmed.txid)) continue;
    for (const input of confirmed.inputs) {
      inputToConfirmedTxid.set(`${input.txid}:${input.vout}`, confirmed.txid);
    }
  }
  return inputToConfirmedTxid;
}

function findReplacement(tx: TxWithInputs, inputMap: Map<string, string>): string | undefined {
  return tx.inputs.map(i => inputMap.get(`${i.txid}:${i.vout}`)).find(Boolean);
}

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
  const pendingTxsWithInputs = await transactionRepository.findPendingWithInputs(walletId);

  // Batch: collect all inputs from pending txs and find confirmed replacements in one query
  if (pendingTxsWithInputs.length > 0) {
    const allPendingInputs = pendingTxsWithInputs.flatMap(tx => tx.inputs);
    const pendingTxids = new Set(pendingTxsWithInputs.map(tx => tx.txid));

    // Single query: find all confirmed txs sharing any input with pending txs
    const confirmedWithSharedInputs = await transactionRepository.findConfirmedWithSharedInputs(
      walletId,
      allPendingInputs.map(i => ({ txid: i.txid, vout: i.vout }))
    );

    // Build input→confirmed map and match pending txs in memory
    const inputToConfirmedTxid = buildInputToConfirmedMap(confirmedWithSharedInputs, pendingTxids);

    for (const pendingTx of pendingTxsWithInputs) {
      const replacementTxid = findReplacement(pendingTx, inputToConfirmedTxid);

      if (replacementTxid) {
        await transactionRepository.updateRbfStatus(pendingTx.id, {
          rbfStatus: 'replaced',
          replacedByTxid: replacementTxid,
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
  const unlinkedReplacedTxs = await transactionRepository.findUnlinkedReplaced(walletId);

  if (unlinkedReplacedTxs.length > 0) {
    const txsWithInputs = unlinkedReplacedTxs.filter(tx => tx.inputs.length > 0);

    if (txsWithInputs.length > 0) {
      const allUnlinkedInputs = txsWithInputs.flatMap(tx => tx.inputs);
      const unlinkedTxids = new Set(txsWithInputs.map(tx => tx.txid));

      // Single query: find all confirmed txs sharing any input
      const confirmedMatches = await transactionRepository.findConfirmedWithSharedInputs(
        walletId,
        allUnlinkedInputs.map(i => ({ txid: i.txid, vout: i.vout }))
      );

      // Build input→confirmed map and match in memory
      const inputToConfirmed = buildInputToConfirmedMap(confirmedMatches, unlinkedTxids);

      for (const replacedTx of txsWithInputs) {
        const replacementTxid = findReplacement(replacedTx, inputToConfirmed);

        if (replacementTxid) {
          await transactionRepository.updateRbfStatus(replacedTx.id, {
            replacedByTxid: replacementTxid,
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
