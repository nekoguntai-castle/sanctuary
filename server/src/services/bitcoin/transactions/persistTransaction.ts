/**
 * Persist Transaction
 *
 * Handles persisting a broadcast transaction to the database within
 * a Prisma transaction. Manages UTXO marking, RBF tracking, I/O storage,
 * and internal wallet detection.
 */

import { withTransaction } from '../../../models/prisma';
import { randomUUID } from 'node:crypto';
import { createLogger } from '../../../utils/logger';
import { storeTransactionInputs, storeTransactionOutputs } from './storeTransactionIO';
import {
  createInternalReceivingTransactions,
  type InternalReceivingOutcome,
} from './internalReceiving';
import { BROADCAST_DRAFT_RETENTION_POLICY } from './broadcastContracts';
import type { TransactionInputMetadata, TransactionOutputMetadata } from './types';

const log = createLogger('BITCOIN:SVC_TX_PERSIST');

/**
 * Persist a broadcast transaction to the database within a Prisma transaction.
 * Handles UTXO marking, RBF tracking, I/O storage, and internal wallet detection.
 */
export async function persistTransaction(
  walletId: string,
  txid: string,
  rawTx: string,
  metadata: {
    recipient: string;
    amount: number;
    fee: number;
    label?: string;
    memo?: string;
    utxos: Array<{ txid: string; vout: number }>;
    draftId?: string;
    inputs?: TransactionInputMetadata[];
    outputs?: TransactionOutputMetadata[];
  }
): Promise<{
  txType: 'sent' | 'consolidation';
  mainTransactionCreated: boolean;
  unlockedCount: number;
  draftArchived: boolean;
  receivingTransactions: InternalReceivingOutcome[];
}> {
  return withTransaction(async (tx) => {
    // Mark UTXOs as spent
    for (const utxo of metadata.utxos) {
      await tx.uTXO.update({
        where: {
          walletId_txid_vout: {
            walletId,
            txid: utxo.txid,
            vout: utxo.vout,
          },
        },
        data: {
          spent: true,
        },
      });
    }

    // Release UTXO locks if broadcasting from a draft
    let unlockedCount = 0;
    let draftArchived = false;
    if (metadata.draftId) {
      const unlockResult = await tx.draftUtxoLock.deleteMany({
        where: { draftId: metadata.draftId },
      });
      unlockedCount = unlockResult.count;

      // Keep draft archival atomic with transaction persistence so later draft
      // updates cannot resurrect a broadcasted spend after node acceptance.
      const archiveResult = await tx.draftTransaction.updateMany({
        where: { id: metadata.draftId },
        data: {
          status: BROADCAST_DRAFT_RETENTION_POLICY.terminalStatus,
          updatedAt: new Date(),
        },
      });
      draftArchived = archiveResult.count > 0;
    }

    // Check if recipient is a wallet address (consolidation) or external (sent)
    const isConsolidation = await tx.address.findFirst({
      where: {
        walletId,
        address: metadata.recipient,
      },
    });

    // Check if this is an RBF transaction (memo starts with "Replacing transaction ")
    let replacementForTxid: string | undefined;
    let labelToUse = metadata.label;
    let memoToUse = metadata.memo;

    if (metadata.memo && metadata.memo.startsWith('Replacing transaction ')) {
      replacementForTxid = metadata.memo.replace('Replacing transaction ', '').trim();

      const originalTx = await tx.transaction.findFirst({
        where: {
          txid: replacementForTxid,
          walletId,
        },
      });

      if (originalTx) {
        await tx.transaction.update({
          where: { id: originalTx.id },
          data: {
            rbfStatus: 'replaced',
            replacedByTxid: txid,
          },
        });

        if (!labelToUse && originalTx.label) {
          labelToUse = originalTx.label;
        }
      }
    }

    // Save transaction to database
    const txType = isConsolidation ? 'consolidation' : 'sent';
    // For consolidation: amount is negative fee (only fee is lost, funds stay in wallet)
    // For sent: amount is negative (funds leaving wallet = amount + fee)
    const txAmount = isConsolidation
      ? -metadata.fee
      : -(metadata.amount + metadata.fee);

    const newTransactionId = randomUUID();
    const insertResult = await tx.transaction.createMany({
      data: [{
        id: newTransactionId,
        txid,
        walletId,
        type: txType,
        amount: BigInt(txAmount),
        fee: BigInt(metadata.fee),
        confirmations: 0,
        label: labelToUse,
        memo: memoToUse,
        blockHeight: null,
        blockTime: null,
        replacementForTxid,
        rbfStatus: 'active',
        rawTx,
        counterpartyAddress: metadata.recipient,
      }],
      skipDuplicates: true,
    });
    const mainTransactionCreated = insertResult.count > 0;
    const txRecord = mainTransactionCreated
      ? { id: newTransactionId }
      : await tx.transaction.findUnique({
        where: { txid_walletId: { txid, walletId } },
        select: { id: true },
      });
    if (!txRecord) {
      throw new Error(`Unable to resolve broadcast transaction ${txid} for wallet ${walletId}`);
    }
    if (!mainTransactionCreated) {
      log.warn(`Transaction ${txid} already existed for wallet ${walletId} during broadcast save`);
    }

    // Store transaction inputs
    await storeTransactionInputs(tx, txRecord.id, txid, walletId, metadata);

    // Store transaction outputs
    await storeTransactionOutputs(tx, txRecord.id, txid, walletId, rawTx, metadata, !!isConsolidation);

    // Create pending received transactions for internal wallets
    const receivingTransactions = await createInternalReceivingTransactions(tx, txid, walletId, rawTx);

    return {
      txType: txType as 'sent' | 'consolidation',
      mainTransactionCreated,
      unlockedCount,
      draftArchived,
      receivingTransactions,
    };
  });
}
