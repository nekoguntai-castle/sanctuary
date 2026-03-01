/**
 * Transaction Input/Output Storage
 *
 * Stores transaction inputs and outputs in the database after
 * new transactions are created. Also triggers RBF detection.
 */

import { db as prisma } from '../../../../../repositories/db';
import { createLogger } from '../../../../../utils/logger';
import type { SyncContext, TransactionCreateData, TxInputCreateData, TxOutputCreateData } from '../../types';
import { detectRBFReplacements } from './rbfDetection';

const log = createLogger('SYNC-TX');

/**
 * Store transaction inputs and outputs in the database
 */
export async function storeTransactionIO(
  ctx: SyncContext,
  newTransactions: TransactionCreateData[]
): Promise<void> {
  const { walletId, txDetailsCache, walletAddressSet, addressToDerivationPath } = ctx;

  try {
    const createdTxRecords = await prisma.transaction.findMany({
      where: {
        walletId,
        txid: { in: newTransactions.map(tx => tx.txid) },
      },
      select: { id: true, txid: true, type: true },
    });

    const txInputsToCreate: TxInputCreateData[] = [];
    const txOutputsToCreate: TxOutputCreateData[] = [];

    for (const txRecord of createdTxRecords) {
      const txDetails = txDetailsCache.get(txRecord.txid);
      if (!txDetails) continue;

      const inputs = txDetails.vin || [];
      const outputs = txDetails.vout || [];

      // Process inputs
      for (let inputIdx = 0; inputIdx < inputs.length; inputIdx++) {
        const input = inputs[inputIdx];
        if (input.coinbase) continue;

        let inputAddress: string | undefined;
        let inputAmount = 0;

        if (input.prevout && input.prevout.scriptPubKey) {
          inputAddress = input.prevout.scriptPubKey.address ||
            (input.prevout.scriptPubKey.addresses && input.prevout.scriptPubKey.addresses[0]);
          if (input.prevout.value !== undefined) {
            inputAmount = input.prevout.value >= 1000000
              ? input.prevout.value
              : Math.round(input.prevout.value * 100000000);
          }
        } else if (input.txid && input.vout !== undefined) {
          const prevTx = txDetailsCache.get(input.txid);
          if (prevTx && prevTx.vout && prevTx.vout[input.vout]) {
            const prevOutput = prevTx.vout[input.vout];
            inputAddress = prevOutput.scriptPubKey?.address ||
              (prevOutput.scriptPubKey?.addresses && prevOutput.scriptPubKey.addresses[0]);
            if (prevOutput.value !== undefined) {
              inputAmount = Math.round(prevOutput.value * 100000000);
            }
          }
        }

        if (inputAddress && input.txid !== undefined && input.vout !== undefined) {
          txInputsToCreate.push({
            transactionId: txRecord.id,
            inputIndex: inputIdx,
            txid: input.txid,
            vout: input.vout,
            address: inputAddress,
            amount: BigInt(inputAmount),
            derivationPath: addressToDerivationPath.get(inputAddress),
          });
        }
      }

      // Process outputs
      for (let outputIdx = 0; outputIdx < outputs.length; outputIdx++) {
        const output = outputs[outputIdx];
        const outputAddress = output.scriptPubKey?.address ||
          (output.scriptPubKey?.addresses && output.scriptPubKey.addresses[0]);

        if (!outputAddress) continue;

        const outputAmount = Math.round((output.value || 0) * 100000000);
        const isOurs = walletAddressSet.has(outputAddress);

        let outputType = 'unknown';
        if (txRecord.type === 'sent') {
          outputType = isOurs ? 'change' : 'recipient';
        } else if (txRecord.type === 'received') {
          outputType = isOurs ? 'recipient' : 'unknown';
        } else if (txRecord.type === 'consolidation') {
          outputType = 'consolidation';
        }

        txOutputsToCreate.push({
          transactionId: txRecord.id,
          outputIndex: outputIdx,
          address: outputAddress,
          amount: BigInt(outputAmount),
          scriptPubKey: output.scriptPubKey?.hex,
          outputType,
          isOurs,
        });
      }
    }

    if (txInputsToCreate.length > 0) {
      await prisma.transactionInput.createMany({
        data: txInputsToCreate,
        skipDuplicates: true,
      });

      // RBF detection
      await detectRBFReplacements(walletId, createdTxRecords, newTransactions, txInputsToCreate);
    }

    if (txOutputsToCreate.length > 0) {
      await prisma.transactionOutput.createMany({
        data: txOutputsToCreate,
        skipDuplicates: true,
      });
    }
  } catch (ioError) {
    log.warn(`[SYNC] Failed to store transaction inputs/outputs: ${ioError}`);
  }
}
