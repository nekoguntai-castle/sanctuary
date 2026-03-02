/**
 * UTXO Selection Modes
 *
 * Handles UTXO selection for different transaction modes:
 * - Normal: amount + fee from available UTXOs
 * - Send-max: entire balance minus fee
 * - Subtract-fees: fee deducted from amount
 */

import { estimateTransactionSize, calculateFee } from '../utils';
import { db as prisma } from '../../../repositories/db';
import { selectUTXOs, UTXOSelectionStrategy } from '../utxoSelection';
import type { UtxoSelection } from './types';

/**
 * Select UTXOs based on transaction mode (normal, sendMax, or subtractFees).
 */
export async function selectUtxosForMode(
  walletId: string,
  amount: number,
  feeRate: number,
  dustThreshold: number,
  sendMax: boolean,
  subtractFees: boolean,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let effectiveAmount = amount;

  if (sendMax) {
    return selectUtxosForSendMax(walletId, feeRate, selectedUtxoIds);
  }

  if (subtractFees) {
    return selectUtxosForSubtractFees(walletId, amount, feeRate, dustThreshold, selectedUtxoIds);
  }

  // Normal selection: amount + fee must be covered
  const selection = await selectUTXOs(
    walletId,
    amount,
    feeRate,
    UTXOSelectionStrategy.LARGEST_FIRST,
    selectedUtxoIds
  );

  return {
    effectiveAmount,
    selection: {
      utxos: selection.utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount: selection.totalAmount,
      estimatedFee: selection.estimatedFee,
      changeAmount: selection.changeAmount,
    },
  };
}

/**
 * Select all UTXOs for send-max mode (entire balance minus fee).
 */
async function selectUtxosForSendMax(
  walletId: string,
  feeRate: number,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
  });

  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs found');
  }

  const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
  const estimatedSize = estimateTransactionSize(utxos.length, 1, 'native_segwit');
  const estimatedFee = calculateFee(estimatedSize, feeRate);

  if (totalAmount <= estimatedFee) {
    throw new Error(`Insufficient funds. Total ${totalAmount} sats is not enough to cover fee ${estimatedFee} sats`);
  }

  const effectiveAmount = totalAmount - estimatedFee;

  return {
    effectiveAmount,
    selection: {
      utxos: utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount,
      estimatedFee,
      changeAmount: 0,
    },
  };
}

/**
 * Select UTXOs for subtract-fees mode (fee deducted from amount).
 */
async function selectUtxosForSubtractFees(
  walletId: string,
  amount: number,
  feeRate: number,
  dustThreshold: number,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
    orderBy: { amount: 'desc' },
  });

  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // Select UTXOs to cover just the amount
  const selectedUtxos: typeof utxos = [];
  let totalAmount = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalAmount += Number(utxo.amount);

    if (totalAmount >= amount) {
      break;
    }
  }

  if (totalAmount < amount) {
    throw new Error(`Insufficient funds. Have ${totalAmount} sats, need ${amount} sats`);
  }

  // Calculate fee based on actual selection
  const estimatedSize = estimateTransactionSize(selectedUtxos.length, 2, 'native_segwit');
  const estimatedFee = calculateFee(estimatedSize, feeRate);

  // Fee is subtracted from the amount being sent
  const effectiveAmount = amount - estimatedFee;
  if (effectiveAmount <= dustThreshold) {
    throw new Error(`Amount ${amount} sats is not enough to cover fee ${estimatedFee} sats (would leave ${effectiveAmount} sats)`);
  }

  // Calculate change
  const changeAmount = totalAmount - amount;

  return {
    effectiveAmount,
    selection: {
      utxos: selectedUtxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        scriptPubKey: u.scriptPubKey || '',
      })),
      totalAmount,
      estimatedFee,
      changeAmount,
    },
  };
}
