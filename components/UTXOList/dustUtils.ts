import type { UTXO, WalletScriptType } from '../../types';

/** Input virtual bytes by script type (for dust calculation) */
export const INPUT_VBYTES: Record<WalletScriptType, number> = {
  legacy: 148,
  nested_segwit: 91,
  native_segwit: 68,
  taproot: 57.5,
};

/**
 * Calculate the dust threshold for a UTXO.
 * A UTXO is considered dust if the fee to spend it exceeds its value.
 * @param feeRate - Current fee rate in sat/vB
 * @param scriptType - Script type of the UTXO
 * @returns Dust threshold in satoshis
 */
export function calculateDustThreshold(feeRate: number, scriptType: WalletScriptType = 'native_segwit'): number {
  const inputVBytes = INPUT_VBYTES[scriptType] || INPUT_VBYTES.native_segwit;
  return Math.ceil(inputVBytes * feeRate);
}

/**
 * Check if a UTXO is dust at the current fee rate.
 */
export function isDustUtxo(utxo: UTXO, feeRate: number): boolean {
  const scriptType = utxo.scriptType || 'native_segwit';
  const threshold = calculateDustThreshold(feeRate, scriptType);
  return utxo.amount < threshold;
}

/**
 * Calculate the cost to spend a UTXO.
 */
export function getSpendCost(utxo: UTXO, feeRate: number): number {
  return calculateDustThreshold(feeRate, utxo.scriptType || 'native_segwit');
}
