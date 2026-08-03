import { WalletScriptType as WalletScriptTypeValue } from '@sanctuary/shared/constants/walletIdentity';
import type { UTXO, WalletScriptType } from '../../types';

/** Input virtual bytes by script type (for dust calculation) */
export const INPUT_VBYTES: Record<WalletScriptType, number> = {
  [WalletScriptTypeValue.LEGACY]: 148,
  [WalletScriptTypeValue.NESTED_SEGWIT]: 91,
  [WalletScriptTypeValue.NATIVE_SEGWIT]: 68,
  [WalletScriptTypeValue.TAPROOT]: 57.5,
};

/**
 * Calculate the dust threshold for a UTXO.
 * A UTXO is considered dust if the fee to spend it exceeds its value.
 * @param feeRate - Current fee rate in sat/vB
 * @param scriptType - Script type of the UTXO
 * @returns Dust threshold in satoshis
 */
export function calculateDustThreshold(
  feeRate: number,
  scriptType: WalletScriptType = WalletScriptTypeValue.NATIVE_SEGWIT,
): number {
  const inputVBytes = INPUT_VBYTES[scriptType] || INPUT_VBYTES[WalletScriptTypeValue.NATIVE_SEGWIT];
  return Math.ceil(inputVBytes * feeRate);
}

/**
 * Check if a UTXO is dust at the current fee rate.
 */
export function isDustUtxo(utxo: UTXO, feeRate: number): boolean {
  const scriptType = utxo.scriptType || WalletScriptTypeValue.NATIVE_SEGWIT;
  const threshold = calculateDustThreshold(feeRate, scriptType);
  return utxo.amount < threshold;
}

/**
 * Calculate the cost to spend a UTXO.
 */
export function getSpendCost(utxo: UTXO, feeRate: number): number {
  return calculateDustThreshold(feeRate, utxo.scriptType || WalletScriptTypeValue.NATIVE_SEGWIT);
}
