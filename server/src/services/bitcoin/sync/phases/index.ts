/**
 * Sync Phases
 *
 * Exports all sync pipeline phases and the default phase sequence.
 */

import { createPhase } from '../pipeline';
import type { SyncPhase } from '../types';

// Import all phase functions
import { rbfCleanupPhase } from './rbfCleanup';
import { fetchHistoriesPhase } from './fetchHistories';
import { checkExistingPhase } from './checkExisting';
import { processTransactionsPhase } from './processTransactions';
import { fetchUtxosPhase } from './fetchUtxos';
import { reconcileUtxosPhase } from './reconcileUtxos';
import { insertUtxosPhase } from './insertUtxos';
import { updateAddressesPhase } from './updateAddresses';
import { gapLimitPhase } from './gapLimit';
import { fixConsolidationsPhase } from './fixConsolidations';
import { receiveEvidenceGatePhase } from './receiveEvidenceGate';

// Export individual phase functions
export {
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
};

/**
 * Default sync phases in execution order
 *
 * Phase 0: RBF Cleanup - Mark pending txs as replaced if confirmed tx shares inputs
 * Phase 1: Fetch Histories - Get transaction history for all addresses
 * Phase 2: Check Existing - Filter out already-processed transactions
 * Phase 3: Process Transactions - Fetch details, classify, and insert new transactions
 * Phase 4: (Integrated into processTransactions) - Recalculate running balances
 * Phase 5: Fetch UTXOs - Get unspent outputs for all addresses
 * Phase 6: Reconcile UTXOs - Mark spent UTXOs, update confirmations
 * Phase 7-8: (Integrated) - Fetch UTXO details and insert new UTXOs
 * Phase 9: Update Addresses - Mark addresses with history as "used"
 * Phase 10: Gap Limit - Generate new addresses if needed
 * Phase 11: Fix Consolidations - Correct misclassified consolidation transactions
 */
export const defaultSyncPhases: SyncPhase[] = [
  createPhase('rbfCleanup', rbfCleanupPhase),
  createPhase('fetchHistories', fetchHistoriesPhase),
  createPhase('checkExisting', checkExistingPhase),
  createPhase('processTransactions', processTransactionsPhase),
  createPhase('fetchUtxos', fetchUtxosPhase),
  createPhase('reconcileUtxos', reconcileUtxosPhase),
  createPhase('insertUtxos', insertUtxosPhase),
  createPhase('updateAddresses', updateAddressesPhase),
  createPhase('receiveEvidenceGate', receiveEvidenceGatePhase),
  createPhase('gapLimit', gapLimitPhase),
  createPhase('fixConsolidations', fixConsolidationsPhase),
];

/**
 * Quick sync phases - minimal sync for balance checking
 * Skips consolidation correction and gap limit expansion
 */
export const quickSyncPhases: SyncPhase[] = [
  createPhase('rbfCleanup', rbfCleanupPhase),
  createPhase('fetchHistories', fetchHistoriesPhase),
  createPhase('checkExisting', checkExistingPhase),
  createPhase('processTransactions', processTransactionsPhase),
  createPhase('fetchUtxos', fetchUtxosPhase),
  createPhase('reconcileUtxos', reconcileUtxosPhase),
  createPhase('insertUtxos', insertUtxosPhase),
  createPhase('updateAddresses', updateAddressesPhase),
  createPhase('receiveEvidenceGate', receiveEvidenceGatePhase),
];
