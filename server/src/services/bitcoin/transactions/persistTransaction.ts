/**
 * Persist Transaction
 *
 * Handles persisting a broadcast transaction to the database within
 * a Prisma transaction. Manages UTXO marking, RBF tracking, I/O storage,
 * and internal wallet detection.
 */

import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { isUniqueConstraintError } from './helpers';
import { storeTransactionInputs, storeTransactionOutputs } from './storeTransactionIO';
import { createInternalReceivingTransactions } from './internalReceiving';
import type { TransactionInputMetadata, TransactionOutputMetadata } from './types';

const log = createLogger('TX-BROADCAST');

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
  createdReceivingTransactions: Array<{ walletId: string; amount: number; address: string }>;
}> {
  return prisma.$transaction(async (tx) => {
    // Mark UTXOs as spent
    for (const utxo of metadata.utxos) {
      await tx.uTXO.update({
        where: {
          txid_vout: {
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
    if (metadata.draftId) {
      const unlockResult = await tx.draftUtxoLock.deleteMany({
        where: { draftId: metadata.draftId },
      });
      unlockedCount = unlockResult.count;
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

    let txRecord: Awaited<ReturnType<typeof tx.transaction.create>>;
    let mainTransactionCreated = true;

    try {
      txRecord = await tx.transaction.create({
        data: {
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
        },
      });
    } catch (error) {
      // Race-safe idempotency: if another sync/process inserted this tx first,
      // reuse that record instead of failing after successful broadcast.
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const existingTxRecord = await tx.transaction.findUnique({
        where: {
          txid_walletId: {
            txid,
            walletId,
          },
        },
      });

      if (!existingTxRecord) {
        throw error;
      }

      txRecord = existingTxRecord;
      mainTransactionCreated = false;
      log.warn(`Transaction ${txid} already existed for wallet ${walletId} during broadcast save`);
    }

    // Store transaction inputs
    await storeTransactionInputs(tx, txRecord.id, txid, walletId, metadata);

    // Store transaction outputs
    await storeTransactionOutputs(tx, txRecord.id, txid, walletId, rawTx, metadata, !!isConsolidation);

    // Create pending received transactions for internal wallets
    const createdReceivingTransactions = await createInternalReceivingTransactions(
      tx, txid, walletId, rawTx, metadata
    );

    return {
      txType: txType as 'sent' | 'consolidation',
      mainTransactionCreated,
      unlockedCount,
      createdReceivingTransactions,
    };
  });
}
