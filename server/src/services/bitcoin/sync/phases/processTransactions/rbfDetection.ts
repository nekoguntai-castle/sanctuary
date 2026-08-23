/**
 * RBF (Replace-By-Fee) Detection
 *
 * Implements detection per BIP-125: when a confirmed transaction shares an input
 * with a pending transaction, the pending tx has been replaced.
 * See: https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki
 */

import { transactionRepository } from '../../../../../repositories';
import { walletLog } from '../../../../../websocket/notifications';
import type { TxInputCreateData } from '../../types';
import type { PrismaTxClient } from '../../../../../models/prisma';

/**
 * Detect and link RBF (Replace-By-Fee) replacements
 */
export async function detectRBFReplacements(
  walletId: string,
  createdTxRecords: Array<{ id: string; txid: string; type: string }>,
  confirmedTxids: ReadonlySet<string>,
  txInputsToCreate: TxInputCreateData[],
  tx?: PrismaTxClient,
  deferPostCommit?: (effect: () => void | Promise<void>) => void,
): Promise<void> {
  const confirmedTxRecords = createdTxRecords.filter(tx => confirmedTxids.has(tx.txid));

  if (confirmedTxRecords.length === 0) return;

  const confirmedInputPatterns: Array<{ confirmedTxid: string; inputTxid: string; inputVout: number }> = [];
  for (const txRecord of confirmedTxRecords) {
    const inputs = txInputsToCreate.filter(i => i.transactionId === txRecord.id);
    for (const input of inputs) {
      confirmedInputPatterns.push({
        confirmedTxid: txRecord.txid,
        inputTxid: input.txid,
        inputVout: input.vout,
      });
    }
  }

  if (confirmedInputPatterns.length === 0) return;

  const pendingTxsWithMatchingInputs = await transactionRepository.findPendingWithSharedInputs(
    walletId,
    confirmedInputPatterns.map(p => ({ txid: p.inputTxid, vout: p.inputVout })),
    tx,
  );

  const rbfUpdates: Array<{ id: string; txid: string; replacementTxid: string }> = [];

  for (const pendingTx of pendingTxsWithMatchingInputs) {
    const pendingInputKeys = new Set(pendingTx.inputs.map(i => `${i.txid}:${i.vout}`));
    const replacementTxid = confirmedInputPatterns.find(p =>
      pendingInputKeys.has(`${p.inputTxid}:${p.inputVout}`)
    )?.confirmedTxid;

    if (replacementTxid && replacementTxid !== pendingTx.txid) {
      rbfUpdates.push({ id: pendingTx.id, txid: pendingTx.txid, replacementTxid });
    }
  }

  if (rbfUpdates.length > 0) {
    await transactionRepository.batchUpdateRbfStatus(
      rbfUpdates.map(u => ({
        id: u.id,
        rbfStatus: 'replaced',
        replacedByTxid: u.replacementTxid,
      })),
      tx,
    );

    for (const update of rbfUpdates) {
      const publish = () => walletLog(
          walletId,
          'info',
          'RBF',
          `Linked pending tx ${update.txid.slice(0, 8)}... as replaced by confirmed tx ${update.replacementTxid.slice(0, 8)}...`
        );
      if (deferPostCommit) deferPostCommit(publish);
      else publish();
    }
  }
}
