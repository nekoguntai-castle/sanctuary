/**
 * UTXO Selection Modes
 *
 * Handles UTXO selection for different transaction modes:
 * - Normal: amount + fee from available UTXOs
 * - Send-max: entire balance minus fee
 * - Subtract-fees: fee deducted from amount
 */

import { utxoRepository } from '../../../repositories';
import {
  selectUTXOsExact,
  assertExactUtxoSelection,
  type ExactSelectionFeeContext,
} from '../utxoSelection';
import { estimateTransactionWeight, feeForRate } from '../transactionWeight';
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
  feeContext: ExactSelectionFeeContext,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let effectiveAmount = amount;

  if (sendMax) {
    return selectUtxosForSendMax(walletId, feeRate, feeContext, selectedUtxoIds);
  }

  if (subtractFees) {
    return selectUtxosForSubtractFees(walletId, amount, feeRate, dustThreshold, feeContext, selectedUtxoIds);
  }

  // Normal selection: amount + fee must be covered
  const selection = await selectUTXOsExact(
    walletId,
    amount,
    feeRate,
    feeContext,
    selectedUtxoIds
  );

  return {
    effectiveAmount,
    selection: {
      utxos: selection.utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        // selectUTXOsExact rejects missing script evidence before returning.
        scriptPubKey: u.scriptPubKey!,
      })),
      totalAmount: selection.totalAmount,
      estimatedFee: selection.estimatedFee,
      changeAmount: selection.changeAmount,
      changeOutputCount: selection.changeOutputCount,
      feeSurplusSats: selection.feeSurplusSats,
    },
  };
}

/**
 * Select all UTXOs for send-max mode (entire balance minus fee).
 */
async function selectUtxosForSendMax(
  walletId: string,
  feeRate: number,
  feeContext: ExactSelectionFeeContext,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let utxos = await utxoRepository.findUnspent(walletId, { excludeFrozen: true });

  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    assertExactUtxoSelection(utxos, selectedUtxoIds);
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs found');
  }

  const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
  if (utxos.some(utxo => !utxo.scriptPubKey)) throw new Error('UTXO is missing scriptPubKey evidence');
  const spendPolicies = await feeContext.resolveSpendPolicies(utxos);
  const estimatedFee = feeForRate(estimateTransactionWeight({
    inputs: utxos.map(utxo => ({
      ...(spendPolicies.get(utxo.address) ?? (() => { throw new Error('UTXO spend policy evidence is missing'); })()),
      prevoutScript: Buffer.from(utxo.scriptPubKey!, 'hex'),
    })),
    outputs: [{ scriptPubKey: feeContext.recipientScript }],
  }).vsize, feeRate);

  if (totalAmount <= estimatedFee) {
    throw new Error(`Insufficient funds. Total ${totalAmount} sats is not enough to cover fee ${estimatedFee} sats`);
  }

  const effectiveAmount = totalAmount - estimatedFee;
  if (effectiveAmount < feeContext.dustThreshold) {
    throw new Error(`Send-max amount ${effectiveAmount} sats is below dust threshold ${feeContext.dustThreshold} sats`);
  }

  return {
    effectiveAmount,
    selection: {
      utxos: utxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        // The evidence guard above establishes this invariant.
        scriptPubKey: u.scriptPubKey!,
      })),
      totalAmount,
      estimatedFee,
      changeAmount: 0,
      changeOutputCount: 0,
      feeSurplusSats: 0,
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
  feeContext: ExactSelectionFeeContext,
  selectedUtxoIds?: string[]
): Promise<{ effectiveAmount: number; selection: UtxoSelection }> {
  let utxos = await utxoRepository.findUnspent(walletId, { excludeFrozen: true });

  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    assertExactUtxoSelection(utxos, selectedUtxoIds);
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

  if (selectedUtxos.some(utxo => !utxo.scriptPubKey)) throw new Error('UTXO is missing scriptPubKey evidence');
  const spendPolicies = await feeContext.resolveSpendPolicies(selectedUtxos);
  const rawChangeAmount = totalAmount - amount;
  const changeScripts = rawChangeAmount >= dustThreshold * feeContext.changeScripts.length
    ? feeContext.changeScripts
    : [];
  const estimatedFee = feeForRate(estimateTransactionWeight({
    inputs: selectedUtxos.map(utxo => ({
      ...(spendPolicies.get(utxo.address) ?? (() => { throw new Error('UTXO spend policy evidence is missing'); })()),
      prevoutScript: Buffer.from(utxo.scriptPubKey!, 'hex'),
    })),
    outputs: [feeContext.recipientScript, ...changeScripts].map(scriptPubKey => ({ scriptPubKey })),
  }).vsize, feeRate);

  // Fee is subtracted from the amount being sent
  const effectiveAmount = amount - estimatedFee;
  if (effectiveAmount <= dustThreshold) {
    throw new Error(`Amount ${amount} sats is not enough to cover fee ${estimatedFee} sats (would leave ${effectiveAmount} sats)`);
  }

  // Calculate change
  const changeAmount = changeScripts.length > 0 ? rawChangeAmount : 0;
  const actualFee = estimatedFee + (changeScripts.length > 0 ? 0 : rawChangeAmount);

  return {
    effectiveAmount,
    selection: {
      utxos: selectedUtxos.map(u => ({
        ...u,
        amount: Number(u.amount),
        // The evidence guard above establishes this invariant.
        scriptPubKey: u.scriptPubKey!,
      })),
      totalAmount,
      estimatedFee: actualFee,
      changeAmount,
      changeOutputCount: changeScripts.length,
      feeSurplusSats: changeScripts.length > 0 ? 0 : rawChangeAmount,
    },
  };
}
