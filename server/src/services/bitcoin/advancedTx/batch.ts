/**
 * Batch Transaction Support
 *
 * Implements batch transaction creation for sending to multiple
 * recipients in a single transaction, saving on fees compared
 * to individual transactions.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { getNetwork, estimateTransactionSize, calculateFee } from '../utils';
import { db as prisma } from '../../../repositories/db';
import { RBF_SEQUENCE, getDustThreshold } from './shared';

/**
 * Create a batch transaction sending to multiple recipients
 */
export async function createBatchTransaction(
  recipients: Array<{ address: string; amount: number; label?: string }>,
  feeRate: number,
  walletId: string,
  selectedUtxoIds?: string[],
  network: 'mainnet' | 'testnet' | 'regtest' = 'mainnet'
): Promise<{
  psbt: bitcoin.Psbt;
  fee: number;
  totalInput: number;
  totalOutput: number;
  changeAmount: number;
  savedFees: number; // Savings compared to individual transactions
}> {
  if (recipients.length === 0) {
    throw new Error('At least one recipient is required');
  }

  // Get configurable thresholds
  const dustThreshold = await getDustThreshold();

  // Get available UTXOs
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
    },
    orderBy: { amount: 'desc' },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter(utxo =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // Calculate total output amount
  const totalOutputAmount = recipients.reduce((sum, r) => sum + r.amount, 0);

  // Select UTXOs to cover the amount
  const selectedUtxos: typeof utxos = [];
  let totalInput = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalInput += Number(utxo.amount);

    // Estimate fee with current inputs
    const estimatedSize = estimateTransactionSize(
      selectedUtxos.length,
      recipients.length + 1, // +1 for change output
      'native_segwit'
    );
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalInput >= totalOutputAmount + estimatedFee) {
      break;
    }
  }

  // Final fee calculation
  const txSize = estimateTransactionSize(
    selectedUtxos.length,
    recipients.length + 1,
    'native_segwit'
  );
  const fee = calculateFee(txSize, feeRate);

  if (totalInput < totalOutputAmount + fee) {
    throw new Error(
      `Insufficient funds. Need ${totalOutputAmount + fee} sats, have ${totalInput} sats`
    );
  }

  const changeAmount = totalInput - totalOutputAmount - fee;

  // Calculate savings vs individual transactions
  const individualTxFee = calculateFee(
    estimateTransactionSize(1, 2, 'native_segwit'), // 1 in, 2 out (recipient + change)
    feeRate
  );
  const totalIndividualFees = individualTxFee * recipients.length;
  const savedFees = totalIndividualFees - fee;

  // Create PSBT
  const networkObj = getNetwork(network);
  const psbt = new bitcoin.Psbt({ network: networkObj });

  // Add inputs with RBF enabled
  for (const utxo of selectedUtxos) {
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: {
        script: Buffer.from(utxo.scriptPubKey, 'hex'),
        value: Number(utxo.amount),
      },
    });
  }

  // Add recipient outputs
  for (const recipient of recipients) {
    psbt.addOutput({
      address: recipient.address,
      value: recipient.amount,
    });
  }

  // Add change output
  if (changeAmount >= dustThreshold) {
    // Get a change address from the wallet
    const changeAddress = await prisma.address.findFirst({
      where: {
        walletId,
        used: false,
      },
      orderBy: { index: 'asc' },
    });

    if (!changeAddress) {
      throw new Error('No change address available');
    }

    psbt.addOutput({
      address: changeAddress.address,
      value: changeAmount,
    });
  }

  return {
    psbt,
    fee,
    totalInput,
    totalOutput: totalOutputAmount,
    changeAmount,
    savedFees,
  };
}
