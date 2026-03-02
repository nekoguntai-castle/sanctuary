/**
 * Store Transaction Inputs/Outputs
 *
 * Handles persisting transaction inputs and outputs to the database.
 * Supports both metadata-provided I/O and fallback parsing from raw tx / UTXO records.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork } from '../utils';
import { createLogger } from '../../../utils/logger';
import type { PrismaTxClient, TransactionInputMetadata, TransactionOutputMetadata } from './types';

const log = createLogger('TX-BROADCAST');

/**
 * Store transaction inputs, either from provided metadata or by looking up UTXO records.
 */
export async function storeTransactionInputs(
  tx: PrismaTxClient,
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
export async function storeTransactionOutputs(
  tx: PrismaTxClient,
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
