/**
 * Blockchain Service Types
 *
 * Shared type definitions for the blockchain service module.
 */

/**
 * Result from syncing a single address
 */
export interface SyncAddressResult {
  transactions: number;
  utxos: number;
}

/**
 * Result from syncing an entire wallet
 */
export interface SyncWalletResult {
  addresses: number;
  transactions: number;
  utxos: number;
}

/**
 * Fee estimates for different confirmation targets
 */
export interface FeeEstimates {
  fastest: number;   // ~1 block
  halfHour: number;  // ~3 blocks
  hour: number;      // ~6 blocks
  economy: number;   // ~12 blocks
}

/**
 * Address validation result
 */
export interface CheckAddressResult {
  valid: boolean;
  error?: string;
  balance?: number;
  transactionCount?: number;
}
