/**
 * Bitcoin Transaction Size Constants
 *
 * Consolidated constants for transaction size estimation.
 * These values are used across the application for fee calculation and UTXO selection.
 */

import { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';

/**
 * Transaction overhead in virtual bytes
 * Includes version (4 bytes) + locktime (4 bytes) + input count (1 byte) + output count (1 byte)
 * For SegWit transactions, the witness marker and flag add ~0.5 vBytes
 */
export const OVERHEAD_VBYTES = 10.5;

/**
 * Input sizes in virtual bytes by script type
 * These values account for the witness discount in SegWit transactions
 */
export const INPUT_VBYTES: Record<string, number> = {
  [WalletScriptType.LEGACY]: 148,           // P2PKH: Full signature in scriptSig
  [WalletScriptType.NESTED_SEGWIT]: 91,     // P2SH-P2WPKH: Witness data gets 75% discount
  [WalletScriptType.NATIVE_SEGWIT]: 68,     // P2WPKH: Native witness with full discount
  [WalletScriptType.TAPROOT]: 57.5,         // P2TR: Schnorr signature in witness
};

/**
 * Default input size for unknown script types (native SegWit)
 */
export const DEFAULT_INPUT_VBYTES = 68;

/**
 * Output sizes in virtual bytes
 * P2WPKH outputs are approximately 34 vBytes (scriptPubKey + value + length bytes)
 * This is consistent across most output types
 */
export const OUTPUT_P2WPKH_VBYTES = 34;

/**
 * P2TR (Taproot) output size in virtual bytes
 * Slightly larger due to 32-byte witness program
 */
export const OUTPUT_P2TR_VBYTES = 43;

/**
 * Alias for backward compatibility
 */
export const OUTPUT_VBYTES = OUTPUT_P2WPKH_VBYTES;
