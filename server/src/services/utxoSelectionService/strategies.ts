/**
 * UTXO Selection Strategies
 *
 * Pure functions implementing different UTXO selection algorithms:
 * - Privacy: Minimize address linkage, prefer already-linked UTXOs
 * - Efficiency: Minimize transaction fees (fewest inputs)
 * - Oldest First: Use oldest UTXOs first (reduce UTXO set age)
 * - Largest First: Use largest UTXOs (minimize input count)
 * - Smallest First: Use smallest UTXOs (consolidation mode)
 */

import { INPUT_VBYTES, DEFAULT_INPUT_VBYTES, OUTPUT_VBYTES, OVERHEAD_VBYTES } from '../bitcoin/constants';
import type { SelectedUtxo, SelectionResult } from './types';

/**
 * Calculate transaction fee based on inputs and outputs
 */
export function calculateFee(
  inputCount: number,
  outputCount: number,
  feeRate: number,
  scriptType: string = 'native_segwit'
): bigint {
  const inputVBytes = INPUT_VBYTES[scriptType] || DEFAULT_INPUT_VBYTES;
  const vSize = OVERHEAD_VBYTES + inputCount * inputVBytes + outputCount * OUTPUT_VBYTES;
  return BigInt(Math.ceil(vSize * feeRate));
}

/**
 * Privacy-focused selection
 * Prefers UTXOs that are already linked (same txid) to minimize new linkages
 */
export function selectForPrivacy(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Group UTXOs by txid (already linked)
  const byTxid = new Map<string, SelectedUtxo[]>();
  for (const utxo of utxos) {
    const group = byTxid.get(utxo.txid) || [];
    group.push(utxo);
    byTxid.set(utxo.txid, group);
  }

  // Sort groups by total amount descending
  const groups = [...byTxid.values()].sort((a, b) => {
    const totalA = a.reduce((sum, u) => sum + u.amount, BigInt(0));
    const totalB = b.reduce((sum, u) => sum + u.amount, BigInt(0));
    return totalB > totalA ? 1 : -1;
  });

  let totalSelected = BigInt(0);
  let addressesSeen = new Set<string>();

  // First, try to satisfy with UTXOs from a single transaction (already linked)
  for (const group of groups) {
    const groupTotal = group.reduce((sum, u) => sum + u.amount, BigInt(0));
    const fee = calculateFee(group.length, 2, feeRate, scriptType);

    if (groupTotal >= targetAmount + fee) {
      selected.push(...group);
      totalSelected = groupTotal;
      group.forEach(u => addressesSeen.add(u.address));
      break;
    }
  }

  // If not satisfied, add more UTXOs preferring same addresses
  if (totalSelected < targetAmount + calculateFee(selected.length || 1, 2, feeRate, scriptType)) {
    // Sort remaining by amount descending
    const remaining = utxos.filter(u => !selected.includes(u));
    remaining.sort((a, b) => (b.amount > a.amount ? 1 : -1));

    for (const utxo of remaining) {
      const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
      if (totalSelected >= targetAmount + currentFee) break;

      selected.push(utxo);
      totalSelected += utxo.amount;
      addressesSeen.add(utxo.address);
    }
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  if (addressesSeen.size > 1) {
    warnings.push(`Spending from ${addressesSeen.size} different addresses links them together`);
  }

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'privacy',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Efficiency-focused selection (minimize fees)
 * Uses largest UTXOs first to minimize input count
 */
export function selectForEfficiency(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Already sorted by amount descending
  let totalSelected = BigInt(0);

  for (const utxo of utxos) {
    const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
    if (totalSelected >= targetAmount + currentFee) break;

    selected.push(utxo);
    totalSelected += utxo.amount;
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  const addressesSeen = new Set(selected.map(u => u.address));

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'efficiency',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Oldest First selection
 * Uses oldest UTXOs first to reduce UTXO set age
 */
export function selectOldestFirst(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Sort by confirmations descending (oldest first)
  const sorted = [...utxos].sort((a, b) => b.confirmations - a.confirmations);

  let totalSelected = BigInt(0);

  for (const utxo of sorted) {
    const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
    if (totalSelected >= targetAmount + currentFee) break;

    selected.push(utxo);
    totalSelected += utxo.amount;
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  const addressesSeen = new Set(selected.map(u => u.address));

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'oldest_first',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}

/**
 * Largest First selection
 * Uses largest UTXOs first (same as efficiency)
 */
export function selectLargestFirst(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const result = selectForEfficiency(utxos, targetAmount, feeRate, scriptType);
  return { ...result, strategy: 'largest_first' };
}

/**
 * Smallest First selection (consolidation mode)
 * Uses smallest UTXOs first to consolidate dust
 */
export function selectSmallestFirst(
  utxos: SelectedUtxo[],
  targetAmount: bigint,
  feeRate: number,
  scriptType: string
): SelectionResult {
  const selected: SelectedUtxo[] = [];
  const warnings: string[] = [];

  // Sort by amount ascending (smallest first)
  const sorted = [...utxos].sort((a, b) => (a.amount < b.amount ? -1 : 1));

  let totalSelected = BigInt(0);

  for (const utxo of sorted) {
    const currentFee = calculateFee(selected.length + 1, 2, feeRate, scriptType);
    if (totalSelected >= targetAmount + currentFee) break;

    selected.push(utxo);
    totalSelected += utxo.amount;
  }

  const finalFee = calculateFee(selected.length, 2, feeRate, scriptType);
  const changeAmount = totalSelected - targetAmount - finalFee;

  if (totalSelected < targetAmount + finalFee) {
    warnings.push('Insufficient funds for this amount');
  }

  if (selected.length > 5) {
    warnings.push(`Using ${selected.length} small UTXOs increases transaction size and fee`);
  }

  const addressesSeen = new Set(selected.map(u => u.address));

  return {
    selected,
    totalAmount: totalSelected,
    estimatedFee: finalFee,
    changeAmount: changeAmount > 0 ? changeAmount : BigInt(0),
    inputCount: selected.length,
    strategy: 'smallest_first',
    warnings,
    privacyImpact: {
      linkedAddresses: addressesSeen.size,
      score: Math.max(0, 100 - (addressesSeen.size - 1) * 20),
    },
  };
}
