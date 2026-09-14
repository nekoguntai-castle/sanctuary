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
import { resolveReplacementLinkAfterBroadcast, selectCandidateOutpoints } from './replacementLink';
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
    replacesTxid?: string;
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

    // Structural RBF linkage: `assertReplacementLink` already verified
    // `metadata.replacesTxid` before this transaction was broadcast. This is
    // a best-effort re-check (the original could have confirmed, or been
    // linked to a different replacement by a concurrent broadcast, in the
    // race between that check and this persistence transaction) and must
    // never fail persistence of an already-broadcast transaction — a stale
    // link only skips linkage and logs a warning.
    // `resolveReplacementLinkAfterBroadcast` performs the actual
    // compare-and-swap write (via the repository) so the check-then-link
    // race is closed at the database layer, not re-verified here.
    // `metadata.memo` is display text only and has no bearing on this
    // decision (rbf-memo-prefix-spoofs-transaction-replacement).
    const replacement = await resolveReplacementLinkAfterBroadcast(
      walletId,
      txid,
      metadata.replacesTxid,
      selectCandidateOutpoints(metadata.inputs, metadata.utxos),
      tx
    );
    const replacementForTxid = replacement ? metadata.replacesTxid : undefined;
    let labelToUse = metadata.label;
    const memoToUse = metadata.memo;

    if (replacement && !labelToUse && replacement.inheritedLabel) {
      labelToUse = replacement.inheritedLabel;
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
