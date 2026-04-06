/**
 * UTXO Selection Module
 *
 * Strategies and algorithms for selecting UTXOs for transactions.
 */

import { db as prisma } from '../../repositories/db';
import { systemSettingRepository } from '../../repositories';
import { estimateTransactionSize, calculateFee } from './utils';
import { DEFAULT_CONFIRMATION_THRESHOLD } from '../../constants';
import { SystemSettingSchemas } from '../../utils/safeJson';

/**
 * UTXO Selection Strategy
 */
export enum UTXOSelectionStrategy {
  LARGEST_FIRST = 'largest_first',
  SMALLEST_FIRST = 'smallest_first',
  BRANCH_AND_BOUND = 'branch_and_bound', // Most efficient
}

/**
 * Selected UTXO with required fields for transaction building
 */
export interface SelectedUTXO {
  id: string;
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: string;
  address: string;
}

/**
 * Result of UTXO selection
 */
export interface UTXOSelectionResult {
  utxos: SelectedUTXO[];
  totalAmount: number;
  estimatedFee: number;
  changeAmount: number;
}

/**
 * Select UTXOs for a transaction
 *
 * @param walletId - The wallet to select UTXOs from
 * @param targetAmount - The amount to send (in satoshis)
 * @param feeRate - Fee rate in sat/vB
 * @param strategy - UTXO selection strategy to use
 * @param selectedUtxoIds - Optional specific UTXOs to use (format: "txid:vout")
 * @returns Selected UTXOs with amounts and fee estimates
 */
export async function selectUTXOs(
  walletId: string,
  targetAmount: number,
  feeRate: number,
  strategy: UTXOSelectionStrategy = UTXOSelectionStrategy.LARGEST_FIRST,
  selectedUtxoIds?: string[]
): Promise<UTXOSelectionResult> {
  // Get confirmation threshold setting
  const confirmationThreshold = await systemSettingRepository.getParsed('confirmationThreshold', SystemSettingSchemas.number, DEFAULT_CONFIRMATION_THRESHOLD);

  // Get available UTXOs (exclude frozen, unconfirmed, and locked-by-draft UTXOs)
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false, // Frozen UTXOs cannot be spent
      confirmations: { gte: confirmationThreshold }, // Must have enough confirmations
      // Exclude UTXOs locked by other drafts (unless user explicitly selected them)
      ...(selectedUtxoIds && selectedUtxoIds.length > 0
        ? {} // Don't filter locks if user selected specific UTXOs
        : { draftLock: null }), // Auto-selection: exclude locked UTXOs
    },
    orderBy:
      strategy === UTXOSelectionStrategy.LARGEST_FIRST
        ? { amount: 'desc' }
        : { amount: 'asc' },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  if (utxos.length === 0) {
    throw new Error('No spendable UTXOs available');
  }

  // If user explicitly selected UTXOs, use ALL of them (no optimization)
  // This allows users to consolidate UTXOs or control exactly which are spent
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    const totalAmount = utxos.reduce((sum, u) => sum + Number(u.amount), 0);
    const estimatedSize = estimateTransactionSize(utxos.length, 2, 'native_segwit');
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    if (totalAmount < targetAmount + estimatedFee) {
      throw new Error(
        `Insufficient funds. Need ${targetAmount + estimatedFee} sats, have ${totalAmount} sats`
      );
    }

    const changeAmount = totalAmount - targetAmount - estimatedFee;
    return {
      utxos: utxos.map(u => ({
        id: u.id,
        txid: u.txid,
        vout: u.vout,
        amount: u.amount,
        scriptPubKey: u.scriptPubKey || '',
        address: u.address,
      })),
      totalAmount,
      estimatedFee,
      changeAmount,
    };
  }

  // Auto-selection: optimize to minimize inputs while covering the amount
  const selectedUtxos: typeof utxos = [];
  let totalAmount = 0;

  for (const utxo of utxos) {
    selectedUtxos.push(utxo);
    totalAmount += Number(utxo.amount);

    // Estimate fee with current selection
    // 2 outputs: recipient + change
    const estimatedSize = estimateTransactionSize(
      selectedUtxos.length,
      2,
      'native_segwit'
    );
    const estimatedFee = calculateFee(estimatedSize, feeRate);

    // Check if we have enough
    if (totalAmount >= targetAmount + estimatedFee) {
      const changeAmount = totalAmount - targetAmount - estimatedFee;

      return {
        utxos: selectedUtxos.map(u => ({
          id: u.id,
          txid: u.txid,
          vout: u.vout,
          amount: u.amount,
          scriptPubKey: u.scriptPubKey || '',
          address: u.address,
        })),
        totalAmount,
        estimatedFee,
        changeAmount,
      };
    }
  }

  // Not enough funds
  const finalSize = estimateTransactionSize(selectedUtxos.length, 2, 'native_segwit');
  const finalFee = calculateFee(finalSize, feeRate);

  throw new Error(
    `Insufficient funds. Need ${targetAmount + finalFee} sats, have ${totalAmount} sats`
  );
}

/**
 * Get all spendable UTXOs for a wallet (for sendMax calculations)
 *
 * @param walletId - The wallet to get UTXOs from
 * @param selectedUtxoIds - Optional specific UTXOs to use (format: "txid:vout")
 * @returns All spendable UTXOs
 */
export async function getSpendableUTXOs(
  walletId: string,
  selectedUtxoIds?: string[]
): Promise<SelectedUTXO[]> {
  let utxos = await prisma.uTXO.findMany({
    where: {
      walletId,
      spent: false,
      frozen: false,
    },
  });

  // Filter by selected UTXOs if provided
  if (selectedUtxoIds && selectedUtxoIds.length > 0) {
    utxos = utxos.filter((utxo) =>
      selectedUtxoIds.includes(`${utxo.txid}:${utxo.vout}`)
    );
  }

  return utxos.map(u => ({
    id: u.id,
    txid: u.txid,
    vout: u.vout,
    amount: u.amount,
    scriptPubKey: u.scriptPubKey || '',
    address: u.address,
  }));
}
