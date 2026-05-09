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
export type {
  BroadcastErrorReason,
  BroadcastAuthoritativeSource,
  BroadcastCanonicalIntentField,
  BroadcastEntrypointSpec,
  BroadcastFailureRetryPolicy,
  BroadcastIdempotencyBasis,
  BroadcastIdempotencyInput,
  BroadcastInvariantPhase,
  BroadcastInvariantSpec,
  BroadcastIntentOutputType,
  BroadcastIntentSource,
  BroadcastMetadataConflictField,
  BroadcastPayloadMode,
  BroadcastPayloadDerivedField,
  CanonicalBroadcastInput,
  CanonicalBroadcastIntent,
  CanonicalBroadcastOutput,
} from './broadcastContracts';
export {
  BROADCAST_CANONICAL_INTENT_REQUIRED_FIELDS,
  BROADCAST_CANONICAL_INTENT_SOURCE_VALUES,
  BROADCAST_DRAFT_RETENTION_POLICY,
  BROADCAST_ENTRYPOINTS,
  BROADCAST_ERROR_REASON_VALUES,
  BROADCAST_EXACTLY_ONCE_SIDE_EFFECTS,
  BROADCAST_PAYLOAD_DERIVED_FIELDS,
  BROADCAST_PRE_PROPAGATION_INVARIANTS,
  BROADCAST_REQUEST_METADATA_CONFLICT_FIELDS,
  getBroadcastFailureRetryPolicy,
  isBroadcastErrorReason,
  selectBroadcastIdempotencyBasis,
} from './broadcastContracts';

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
