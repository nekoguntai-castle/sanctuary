/**
 * CPFP (Child-Pays-For-Parent) Transaction Support
 *
 * Implements Child-Pays-For-Parent functionality for accelerating
 * stuck unconfirmed transactions by spending their outputs with
 * a higher fee rate.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork, estimateTransactionSize, calculateFee } from '../utils';
import { getNodeClient } from '../nodeClient';
import { db as prisma } from '../../../repositories/db';
import { getDustThreshold } from './shared';

/**
 * Calculate CPFP fee to achieve target fee rate
 */
export function calculateCPFPFee(
  parentTxSize: number,
  parentFeeRate: number,
  childTxSize: number,
  targetFeeRate: number
): {
  childFee: number;
  childFeeRate: number;
  totalFee: number;
  totalSize: number;
  effectiveFeeRate: number;
} {
  // Calculate parent fee
  const parentFee = Math.ceil(parentTxSize * parentFeeRate);

  // Calculate total fee needed for target rate
  const totalSize = parentTxSize + childTxSize;
  const totalFee = Math.ceil(totalSize * targetFeeRate);

  // Child fee is the difference
  const childFee = totalFee - parentFee;
  const childFeeRate = Math.ceil(childFee / childTxSize);

  // Effective fee rate for the package
  const effectiveFeeRate = totalFee / totalSize;

  return {
    childFee,
    childFeeRate,
    totalFee,
    totalSize,
    effectiveFeeRate,
  };
}

/**
 * Create a CPFP transaction
 */
export async function createCPFPTransaction(
  parentTxid: string,
  parentVout: number,
  targetFeeRate: number,
  recipientAddress: string,
  walletId: string,
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  childFee: number;
  childFeeRate: number;
  parentFeeRate: number;
  effectiveFeeRate: number;
}> {
  // Use nodeClient which respects poolEnabled setting from node_configs
  const client = await getNodeClient();

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get parent transaction
  const parentTx = await client.getTransaction(parentTxid);
  const parentVsize = bitcoin.Transaction.fromHex(parentTx.hex).virtualSize();

  // Get the UTXO from parent transaction
  const utxo = await prisma.uTXO.findUnique({
    where: {
      txid_vout: {
        txid: parentTxid,
        vout: parentVout,
      },
    },
  });

  if (!utxo) {
    throw new Error('UTXO not found');
  }

  if (utxo.spent) {
    throw new Error('UTXO is already spent');
  }

  // Calculate parent fee rate
  let parentInputValue = 0;
  const tx = bitcoin.Transaction.fromHex(parentTx.hex);

  for (const input of tx.ins) {
    const inputTxid = Buffer.from(input.hash).reverse().toString('hex');
    const inputTx = await client.getTransaction(inputTxid);
    const prevOut = inputTx.vout[input.index];
    parentInputValue += Math.round(prevOut.value * 100000000);
  }

  const parentOutputValue = tx.outs.reduce((sum, out) => sum + out.value, 0);
  const parentFee = parentInputValue - parentOutputValue;
  const parentFeeRate = parentFee / parentVsize;

  // Estimate child transaction size (1 input, 1 output)
  const childTxSize = estimateTransactionSize(1, 1, 'native_segwit');

  // Calculate CPFP fees
  const cpfpCalc = calculateCPFPFee(
    parentVsize,
    parentFeeRate,
    childTxSize,
    targetFeeRate
  );

  // Ensure we have enough value to create the transaction
  const utxoValue = Number(utxo.amount);
  if (cpfpCalc.childFee >= utxoValue) {
    throw new Error(
      `UTXO value (${utxoValue} sats) is insufficient to pay child fee (${cpfpCalc.childFee} sats)`
    );
  }

  const outputValue = utxoValue - cpfpCalc.childFee;
  if (outputValue < dustThreshold) {
    throw new Error(
      `Output would be dust (${outputValue} sats). Minimum is ${dustThreshold} sats.`
    );
  }

  // Create PSBT
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });

  psbt.addInput({
    hash: parentTxid,
    index: parentVout,
    witnessUtxo: {
      script: Buffer.from(utxo.scriptPubKey, 'hex'),
      value: utxoValue,
    },
  });

  psbt.addOutput({
    address: recipientAddress,
    value: outputValue,
  });

  return {
    psbt,
    childFee: cpfpCalc.childFee,
    childFeeRate: cpfpCalc.childFeeRate,
    parentFeeRate,
    effectiveFeeRate: cpfpCalc.effectiveFeeRate,
  };
}
