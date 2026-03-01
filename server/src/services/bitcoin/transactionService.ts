/**
 * Transaction Service
 *
 * Thin re-export module that delegates to focused sub-modules in ./transactions/.
 * This file is kept for backward compatibility with existing imports.
 *
 * The actual implementation is split across:
 * - transactions/types.ts: Shared type definitions
 * - transactions/helpers.ts: Small utility functions
 * - transactions/psbtConstruction.ts: Shared PSBT building logic
 * - transactions/createTransaction.ts: Single-recipient transaction creation
 * - transactions/createBatchTransaction.ts: Multi-output batch transactions
 * - transactions/broadcasting.ts: Broadcast + database persistence
 *
 * Additional sub-modules (pre-existing, unchanged):
 * - psbtBuilder.ts: PSBT construction utilities (BIP32 derivations, witness scripts)
 * - utxoSelection.ts: UTXO selection strategies
 * - estimation.ts: Fee and transaction estimation
 * - psbtInfo.ts: PSBT parsing utilities
 */

// Core transaction operations
export { createTransaction } from './transactions/createTransaction';
export { createBatchTransaction } from './transactions/createBatchTransaction';
export { broadcastAndSave } from './transactions/broadcasting';

// Types
export type { TransactionInputMetadata, TransactionOutputMetadata, TransactionOutput } from './transactions/types';

// Convenience wrapper (kept here as it's trivial)
export { createAndBroadcastTransaction } from './transactions/createAndBroadcastTransaction';

// Re-exports from pre-existing sub-modules (for backward compatibility)
export { selectUTXOs, UTXOSelectionStrategy } from './utxoSelection';
export { estimateTransaction } from './estimation';
export { getPSBTInfo } from './psbtInfo';
export { buildMultisigBip32Derivations, buildMultisigWitnessScript, generateDecoyAmounts } from './psbtBuilder';
