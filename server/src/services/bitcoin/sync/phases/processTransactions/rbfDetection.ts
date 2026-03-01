/**
 * RBF (Replace-By-Fee) Detection
 *
 * Implements detection per BIP-125: when a confirmed transaction shares an input
 * with a pending transaction, the pending tx has been replaced.
 * See: https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki
 */

import { db as prisma } from '../../../../../repositories/db';
import { walletLog } from '../../../../../websocket/notifications';
import type { TransactionCreateData, TxInputCreateData } from '../../types';

/**
 * Detect and link RBF (Replace-By-Fee) replacements
 */
export async function detectRBFReplacements(
  walletId: string,
  createdTxRecords: Array<{ id: string; txid: string; type: string }>,
  newTransactions: TransactionCreateData[],
  txInputsToCreate: TxInputCreateData[]
): Promise<void> {
  const confirmedTxRecords = createdTxRecords.filter(tx => {
    const txData = newTransactions.find(t => t.txid === tx.txid);
    return txData && txData.confirmations > 0;
  });

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

  const pendingTxsWithMatchingInputs = await prisma.transaction.findMany({
    where: {
      walletId,
      confirmations: 0,
      rbfStatus: 'active',
      inputs: {
        some: {
          OR: confirmedInputPatterns.map(p => ({
            txid: p.inputTxid,
            vout: p.inputVout,
          })),
        },
      },
    },
    select: {
      id: true,
      txid: true,
      inputs: { select: { txid: true, vout: true } },
    },
  });

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
    await prisma.$transaction(
      rbfUpdates.map(update =>
        prisma.transaction.update({
          where: { id: update.id },
          data: {
            rbfStatus: 'replaced',
            replacedByTxid: update.replacementTxid,
          },
        })
      )
    );

    for (const update of rbfUpdates) {
      walletLog(
        walletId,
        'info',
        'RBF',
        `Linked pending tx ${update.txid.slice(0, 8)}... as replaced by confirmed tx ${update.replacementTxid.slice(0, 8)}...`
      );
    }
  }
}
