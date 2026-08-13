/**
 * Sync Module
 *
 * Re-exports all sync-related functions for wallet synchronization.
 * The sync pipeline provides a modular, testable architecture for wallet sync.
 */

// Legacy exports (still used directly in some places)
export { ensureGapLimit } from './addressDiscovery';

export {
  updateTransactionConfirmations,
  populateMissingTransactionFields,
  type ConfirmationUpdate,
  type PopulateFieldsResult,
} from './confirmations';

// Pipeline infrastructure
export { executeSyncPipeline, createPhase } from './pipeline';
export { createSyncContext, createTestContext, createSyncStats } from './context';

// Types
export type {
  SyncContext,
  SyncPhase,
  SyncResult,
  SyncStats,
  PipelineOptions,
  SyncPipelineError,
  BitcoinNetwork,
  TxHistoryEntry,
  ElectrumUTXO,
  RawTransaction,
  TransactionCreateData,
  UTXOCreateData,
  ReceiveEvidenceRetryableError,
} from './types';

// Phases
export {
  defaultSyncPhases,
  quickSyncPhases,
  rbfCleanupPhase,
  fetchHistoriesPhase,
  checkExistingPhase,
  processTransactionsPhase,
  fetchUtxosPhase,
  reconcileUtxosPhase,
  insertUtxosPhase,
  updateAddressesPhase,
  gapLimitPhase,
  fixConsolidationsPhase,
  receiveEvidenceGatePhase,
} from './phases';
