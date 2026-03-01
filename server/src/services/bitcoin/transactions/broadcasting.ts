/**
 * Transaction Broadcasting Module
 *
 * Handles broadcasting signed transactions and persisting them to the database.
 * Supports two broadcast modes:
 * 1. signedPsbtBase64: Extract and broadcast from signed PSBT (Ledger, file upload)
 * 2. rawTxHex: Broadcast raw transaction hex directly (Trezor)
 *
 * Also handles:
 * - UTXO marking as spent
 * - RBF replacement tracking
 * - Transaction input/output storage
 * - Internal wallet receiving transaction creation
 * - Notification dispatch
 * - Balance recalculation
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork } from '../utils';
import { broadcastTransaction, recalculateWalletBalances } from '../blockchain';
import { db as prisma } from '../../../repositories/db';
import { createLogger } from '../../../utils/logger';
import { eventService } from '../../eventService';
import { transactionBroadcastsTotal } from '../../../observability/metrics';
import { parseMultisigScript, finalizeMultisigInput } from '../psbtBuilder';
import { isUniqueConstraintError } from './helpers';
import type { TransactionInputMetadata, TransactionOutputMetadata, BroadcastResult } from './types';

const log = createLogger('TX-BROADCAST');

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
    import('../../notifications/notificationService').then(({ notifyNewTransactions }) => {
      notifyNewTransactions(walletId, [{
        txid,
        type: persisted.txType,
        amount: BigInt(metadata.amount),
      }]).catch(err => {
        log.warn('Failed to send notifications', { error: String(err) });
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
    import('../../notifications/notificationService').then(({ notifyNewTransactions }) => {
      notifyNewTransactions(receivingTx.walletId, [{
        txid,
        type: 'received',
        amount: BigInt(receivingTx.amount),
      }]).catch(err => {
        log.warn('Failed to send notifications for receiving wallet', { error: String(err) });
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

/**
 * Persist a broadcast transaction to the database within a Prisma transaction.
 * Handles UTXO marking, RBF tracking, I/O storage, and internal wallet detection.
 */
async function persistTransaction(
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

/**
 * Store transaction inputs, either from provided metadata or by looking up UTXO records.
 */
async function storeTransactionInputs(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  transactionId: string,
  txid: string,
  walletId: string,
  metadata: {
    utxos: Array<{ txid: string; vout: number }>;
    inputs?: TransactionInputMetadata[];
  }
): Promise<void> {
  if (metadata.inputs && metadata.inputs.length > 0) {
    const inputData = metadata.inputs.map((input, index) => ({
      transactionId,
      inputIndex: index,
      txid: input.txid,
      vout: input.vout,
      address: input.address,
      amount: BigInt(input.amount),
      derivationPath: input.derivationPath,
    }));

    await tx.transactionInput.createMany({
      data: inputData,
      skipDuplicates: true,
    });
    log.debug(`Stored ${inputData.length} transaction inputs for ${txid}`);
    return;
  }

  // Fallback: try to get input data from UTXO table if not provided
  // OPTIMIZED: Batch fetch all UTXOs and addresses to avoid N+1 queries
  const utxoKeys = metadata.utxos.map(u => ({ txid: u.txid, vout: u.vout }));

  const utxoRecords = await tx.uTXO.findMany({
    where: {
      OR: utxoKeys.map(k => ({ txid: k.txid, vout: k.vout })),
    },
  });
  const utxoLookup = new Map(utxoRecords.map(u => [`${u.txid}:${u.vout}`, u]));

  const utxoAddresses = utxoRecords.map(u => u.address);
  const addressRecords = await tx.address.findMany({
    where: {
      walletId,
      address: { in: utxoAddresses },
    },
    select: { address: true, derivationPath: true },
  });
  const addressPathLookup = new Map(addressRecords.map(a => [a.address, a.derivationPath]));

  const utxoInputs = metadata.utxos.map((utxo, index) => {
    const utxoRecord = utxoLookup.get(`${utxo.txid}:${utxo.vout}`);
    if (!utxoRecord) return null;

    return {
      transactionId,
      inputIndex: index,
      txid: utxo.txid,
      vout: utxo.vout,
      address: utxoRecord.address,
      amount: utxoRecord.amount,
      derivationPath: addressPathLookup.get(utxoRecord.address),
    };
  });

  const validInputs = utxoInputs.filter(Boolean) as Array<{
    transactionId: string;
    inputIndex: number;
    txid: string;
    vout: number;
    address: string;
    amount: bigint;
    derivationPath: string | null | undefined;
  }>;

  if (validInputs.length > 0) {
    await tx.transactionInput.createMany({
      data: validInputs,
      skipDuplicates: true,
    });
    log.debug(`Stored ${validInputs.length} transaction inputs (from UTXO fallback) for ${txid}`);
  }
}

/**
 * Store transaction outputs, either from provided metadata or by parsing the raw transaction.
 */
async function storeTransactionOutputs(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  transactionId: string,
  txid: string,
  walletId: string,
  rawTx: string,
  metadata: {
    recipient: string;
    outputs?: TransactionOutputMetadata[];
  },
  isConsolidation: boolean
): Promise<void> {
  if (metadata.outputs && metadata.outputs.length > 0) {
    const outputData = metadata.outputs.map((output, index) => ({
      transactionId,
      outputIndex: index,
      address: output.address,
      amount: BigInt(output.amount),
      outputType: output.outputType,
      isOurs: output.isOurs,
      scriptPubKey: output.scriptPubKey,
    }));

    await tx.transactionOutput.createMany({
      data: outputData,
      skipDuplicates: true,
    });
    log.debug(`Stored ${outputData.length} transaction outputs for ${txid}`);
    return;
  }

  // Fallback: parse outputs from the raw transaction
  try {
    const txParsed = bitcoin.Transaction.fromHex(rawTx);
    const network = await tx.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });
    const networkObj = getNetwork(network?.network === 'testnet' ? 'testnet' : 'mainnet');

    // Get all wallet addresses to check ownership
    const walletAddresses = await tx.address.findMany({
      where: { walletId },
      select: { address: true },
    });
    const walletAddressSet = new Set(walletAddresses.map(a => a.address));

    const outputData = txParsed.outs.map((output, index) => {
      let address = '';
      try {
        address = bitcoin.address.fromOutputScript(output.script, networkObj);
      } catch (_e) {
        // OP_RETURN or non-standard output
      }

      const isOurs = walletAddressSet.has(address);
      let outputType: string = 'unknown';

      if (address === metadata.recipient) {
        outputType = 'recipient';
      } else if (isOurs) {
        outputType = isConsolidation ? 'consolidation' : 'change';
      } else if (address) {
        outputType = 'recipient';
      } else {
        outputType = 'op_return';
      }

      return {
        transactionId,
        outputIndex: index,
        address,
        amount: BigInt(output.value),
        outputType,
        isOurs,
        scriptPubKey: output.script.toString('hex'),
      };
    });

    if (outputData.length > 0) {
      await tx.transactionOutput.createMany({
        data: outputData,
        skipDuplicates: true,
      });
      log.debug(`Stored ${outputData.length} transaction outputs (from raw tx) for ${txid}`);
    }
  } catch (e) {
    log.warn(`Failed to parse outputs from raw transaction: ${e}`);
  }
}

/**
 * Check if any output addresses belong to other wallets in the app.
 * If so, create pending "received" transactions for those wallets immediately.
 */
async function createInternalReceivingTransactions(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  txid: string,
  walletId: string,
  rawTx: string,
  metadata: {
    label?: string;
  }
): Promise<Array<{ walletId: string; amount: number; address: string }>> {
  const createdReceivingTransactions: Array<{ walletId: string; amount: number; address: string }> = [];

  try {
    const txParsed = bitcoin.Transaction.fromHex(rawTx);
    const wallet = await tx.wallet.findUnique({
      where: { id: walletId },
      select: { network: true },
    });
    const networkObj = getNetwork(wallet?.network === 'testnet' ? 'testnet' : 'mainnet');

    // Extract all output addresses
    const outputAddresses: Array<{ address: string; amount: number }> = [];
    for (const output of txParsed.outs) {
      try {
        const addr = bitcoin.address.fromOutputScript(output.script, networkObj);
        outputAddresses.push({ address: addr, amount: output.value });
      } catch (_e) {
        // Skip OP_RETURN or non-standard outputs
      }
    }

    // Find which output addresses belong to OTHER wallets in the app
    const recipientAddresses = await tx.address.findMany({
      where: {
        address: { in: outputAddresses.map(o => o.address) },
        walletId: { not: walletId },
      },
      select: {
        walletId: true,
        address: true,
      },
    });

    // Group outputs by receiving wallet
    const walletOutputs = new Map<string, { address: string; amount: number }[]>();
    for (const addrRecord of recipientAddresses) {
      const outputs = outputAddresses.filter(o => o.address === addrRecord.address);
      const existing = walletOutputs.get(addrRecord.walletId) || [];
      walletOutputs.set(addrRecord.walletId, [...existing, ...outputs]);
    }

    // Create pending received transaction for each receiving wallet
    for (const [receivingWalletId, outputs] of walletOutputs) {
      const totalAmount = outputs.reduce((sum, o) => sum + o.amount, 0);

      log.info('Creating pending received transaction for internal wallet', {
        txid,
        sendingWalletId: walletId,
        receivingWalletId,
        outputCount: outputs.length,
        totalAmount,
      });

      // Check if transaction already exists for receiving wallet (avoid duplicates)
      const existingReceivedTx = await tx.transaction.findFirst({
        where: {
          txid,
          walletId: receivingWalletId,
        },
      });

      if (existingReceivedTx) {
        continue;
      }

      try {
        await tx.transaction.create({
          data: {
            txid,
            walletId: receivingWalletId,
            type: 'received',
            amount: BigInt(totalAmount),
            fee: BigInt(0),
            confirmations: 0,
            label: metadata.label,
            blockHeight: null,
            blockTime: null,
            rawTx,
            counterpartyAddress: null,
          },
        });
      } catch (error) {
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        log.debug('Skipping duplicate pending receive record', {
          txid,
          receivingWalletId,
        });
        continue;
      }

      createdReceivingTransactions.push({
        walletId: receivingWalletId,
        amount: totalAmount,
        address: outputs[0]?.address || '',
      });
    }
  } catch (e) {
    log.warn('Failed to create pending transactions for receiving wallets', { error: String(e) });
  }

  return createdReceivingTransactions;
}
