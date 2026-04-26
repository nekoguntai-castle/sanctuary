/**
 * Transaction Broadcasting Module
 *
 * Handles broadcasting signed transactions and persisting them to the database.
 * Supports two broadcast modes:
 * 1. signedPsbtBase64: Extract and broadcast from signed PSBT (Ledger, file upload)
 * 2. rawTxHex: Broadcast raw transaction hex directly (Trezor)
 */

import * as bitcoin from 'bitcoinjs-lib';
import { broadcastTransaction, recalculateWalletBalances } from '../blockchain';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { eventService } from '../../eventService';
import { transactionBroadcastsTotal } from '../../../observability/metrics';
import { parseMultisigScript, finalizeMultisigInput } from '../psbtBuilder';
import { persistTransaction } from './persistTransaction';
import type { TransactionInputMetadata, TransactionOutputMetadata, BroadcastResult } from './types';

const log = createLogger('BITCOIN:SVC_TX_BROADCAST');

/**
 * Broadcast a signed transaction and save to database.
 *
 * Supports two modes:
 * 1. signedPsbtBase64: Extract and broadcast from signed PSBT (Ledger, file upload)
 * 2. rawTxHex: Broadcast raw transaction hex directly (Trezor)
 */
export async function broadcastAndSave(
  walletId: string,
  signedPsbtBase64: string | undefined,
  metadata: {
    recipient: string;
    amount: number;
    fee: number;
    label?: string;
    memo?: string;
    utxos: Array<{ txid: string; vout: number }>;
    rawTxHex?: string; // For Trezor: fully signed raw transaction hex
    draftId?: string; // If broadcasting from a draft, release UTXO locks
    // Enhanced metadata for full I/O storage
    inputs?: TransactionInputMetadata[];
    outputs?: TransactionOutputMetadata[];
  }
): Promise<BroadcastResult> {
  // Log which broadcast path we're taking
  log.info('broadcastAndSave called', {
    hasSignedPsbtBase64: !!signedPsbtBase64,
    signedPsbtBase64Length: signedPsbtBase64?.length || 0,
    hasRawTxHex: !!metadata.rawTxHex,
    rawTxHexLength: metadata.rawTxHex?.length || 0,
    recipient: metadata.recipient,
    draftId: metadata.draftId,
  });

  const { rawTx, txid } = extractRawTransaction(signedPsbtBase64, metadata.rawTxHex);

  // Broadcast to network
  const broadcastResult = await broadcastTransaction(rawTx);

  if (!broadcastResult.broadcasted) {
    transactionBroadcastsTotal.inc({ status: 'failure' });
    throw new Error('Failed to broadcast transaction');
  }

  transactionBroadcastsTotal.inc({ status: 'success' });

  const persisted = await persistTransaction(walletId, txid, rawTx, metadata);

  if (metadata.draftId && persisted.unlockedCount > 0) {
    log.debug(`Released ${persisted.unlockedCount} UTXO locks for draft ${metadata.draftId}`);
  }

  // Recalculate running balances for all affected wallets
  await recalculateWalletBalances(walletId);

  if (persisted.mainTransactionCreated) {
    // Send notifications for the broadcast transaction (Telegram + Push)
    // This is async and fire-and-forget to not block the response
    import('../../notifications/dispatch').then(({ dispatchTransactionNotifications }) => {
      dispatchTransactionNotifications(walletId, [{
        txid,
        type: persisted.txType,
        amount: BigInt(metadata.amount),
        feeSats: BigInt(metadata.fee),
      }]).catch(err => {
        log.warn('Failed to send notifications', { error: getErrorMessage(err) });
      });
    });

    // Emit transaction sent event for real-time updates
    eventService.emitTransactionSent({
      walletId,
      txid,
      amount: BigInt(metadata.amount),
      fee: BigInt(metadata.fee),
      recipients: [{ address: metadata.recipient, amount: BigInt(metadata.amount) }],
      rawTx,
    });
  }

  for (const receivingTx of persisted.createdReceivingTransactions) {
    await recalculateWalletBalances(receivingTx.walletId);

    // Emit transaction received event for real-time updates
    eventService.emitTransactionReceived({
      walletId: receivingTx.walletId,
      txid,
      amount: BigInt(receivingTx.amount),
      address: receivingTx.address,
      confirmations: 0,
    });

    // Send notifications for the receiving wallet
    import('../../notifications/dispatch').then(({ dispatchTransactionNotifications }) => {
      dispatchTransactionNotifications(receivingTx.walletId, [{
        txid,
        type: 'received',
        amount: BigInt(receivingTx.amount),
      }]).catch(err => {
        log.warn('Failed to send notifications for receiving wallet', { error: getErrorMessage(err) });
      });
    });
  }

  return {
    txid,
    broadcasted: true,
  };
}

/**
 * Extract raw transaction hex and txid from either a signed PSBT or raw hex.
 */
function extractRawTransaction(
  signedPsbtBase64: string | undefined,
  rawTxHex: string | undefined
): { rawTx: string; txid: string } {
  if (rawTxHex) {
    // Trezor path: Use raw transaction hex directly
    const tx = bitcoin.Transaction.fromHex(rawTxHex);
    return { rawTx: rawTxHex, txid: tx.getId() };
  }

  if (signedPsbtBase64) {
    // Ledger/file upload path: Extract from signed PSBT
    const psbt = bitcoin.Psbt.fromBase64(signedPsbtBase64);

    // Check if all inputs are already finalized (e.g., from hardware wallet signing)
    const allFinalized = psbt.data.inputs.every(
      (input) => input.finalScriptSig || input.finalScriptWitness
    );

    // Only finalize if not already finalized
    if (!allFinalized) {
      finalizePsbtInputs(psbt);
    }

    const tx = psbt.extractTransaction();
    return { rawTx: tx.toHex(), txid: tx.getId() };
  }

  throw new Error('Either signedPsbtBase64 or rawTxHex is required');
}

/**
 * Finalize PSBT inputs, handling both single-sig and multisig.
 */
function finalizePsbtInputs(psbt: bitcoin.Psbt): void {
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const input = psbt.data.inputs[i];

    // Skip already finalized inputs
    if (input.finalScriptSig || input.finalScriptWitness) {
      continue;
    }

    // Check if this is a multisig input
    if (input.witnessScript && input.partialSig && input.partialSig.length > 0) {
      const { isMultisig } = parseMultisigScript(input.witnessScript);
      if (isMultisig) {
        finalizeMultisigInput(psbt, i);
      } else {
        psbt.finalizeInput(i);
      }
    } else {
      psbt.finalizeInput(i);
    }
  }
}
