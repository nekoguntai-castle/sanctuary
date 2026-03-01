/**
 * CoinControlPanel Utilities
 *
 * Pure utility functions for dust calculation, spend cost estimation,
 * and strategy mapping.
 */

import type { UTXO, WalletScriptType } from '../../types';
import type { SelectionStrategy } from '../../src/api/transactions';
import type { UIStrategy } from '../StrategySelector';

// Map UI strategy to backend API strategy
export const strategyToApiStrategy: Record<UIStrategy, SelectionStrategy | null> = {
  auto: 'efficiency',      // Auto uses efficiency (minimize fees)
  privacy: 'privacy',      // Privacy maximizes privacy score
  manual: null,            // Manual = no API call, user selects
  consolidate: 'smallest_first', // Consolidate picks small UTXOs first
};

// Input virtual bytes by script type (for dust calculation)
export const INPUT_VBYTES: Record<WalletScriptType, number> = {
  legacy: 148,
  nested_segwit: 91,
  native_segwit: 68,
  taproot: 57.5,
};

/**
 * Calculate the dust threshold for a UTXO
 */
export function calculateDustThreshold(feeRate: number, scriptType: WalletScriptType = 'native_segwit'): number {
  const inputVBytes = INPUT_VBYTES[scriptType] || INPUT_VBYTES.native_segwit;
  return Math.ceil(inputVBytes * feeRate);
}

/**
 * Check if a UTXO is dust at the current fee rate
 */
export function isDustUtxo(utxo: UTXO, feeRate: number): boolean {
  const scriptType = utxo.scriptType || 'native_segwit';
  const threshold = calculateDustThreshold(feeRate, scriptType);
  return utxo.amount < threshold;
}

/**
 * Calculate the cost to spend a UTXO
 */
export function getSpendCost(utxo: UTXO, feeRate: number): number {
  const scriptType = utxo.scriptType || 'native_segwit';
  const inputVBytes = INPUT_VBYTES[scriptType] || INPUT_VBYTES.native_segwit;
  return Math.ceil(inputVBytes * feeRate);
}
