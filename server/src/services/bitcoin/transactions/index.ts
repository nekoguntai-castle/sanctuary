/**
 * Transactions Module
 *
 * Barrel file re-exporting the public API for transaction operations.
 * This preserves backward compatibility with existing imports from transactionService.
 */

// Types
export type {
  TransactionInputMetadata,
  TransactionOutputMetadata,
  TransactionOutput,
  CreateTransactionResult,
  CreateBatchTransactionResult,
  BroadcastResult,
  WalletSigningInfo,
  PendingOutput,
  UtxoSelection,
} from './types';

// Transaction creation
export { createTransaction } from './createTransaction';
export { createBatchTransaction } from './createBatchTransaction';

// Broadcasting
export { broadcastAndSave } from './broadcasting';

// Convenience wrapper
export { createAndBroadcastTransaction } from './createAndBroadcastTransaction';

// Re-exports from existing sub-modules (for backward compatibility)
// These were previously re-exported from transactionService.ts
export { selectUTXOs, UTXOSelectionStrategy } from '../utxoSelection';
export { estimateTransaction } from '../estimation';
export { getPSBTInfo } from '../psbtInfo';
export { buildMultisigBip32Derivations, buildMultisigWitnessScript, generateDecoyAmounts } from '../psbtBuilder';
