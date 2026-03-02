/**
 * Blockchain Service
 *
 * Barrel file re-exporting all blockchain service functionality.
 * Maintains backward compatibility with existing imports from `../blockchain`.
 */

// Types
export type {
  SyncAddressResult,
  SyncWalletResult,
  FeeEstimates,
  CheckAddressResult,
} from './types';

// Address sync
export { syncAddress } from './syncAddress';

// Wallet sync
export { syncWallet } from './syncWallet';

// Network operations
export {
  broadcastTransaction,
  getFeeEstimates,
  getTransactionDetails,
  monitorAddress,
  checkAddress,
} from './networkOperations';

// Re-exports for backward compatibility (from modular utilities)
export {
  getCachedBlockHeight,
  setCachedBlockHeight,
  getBlockHeight,
  getBlockTimestamp,
  type Network,
} from '../utils/blockHeight';
export { recalculateWalletBalances, correctMisclassifiedConsolidations } from '../utils/balanceCalculation';
export { ensureGapLimit } from '../sync/addressDiscovery';
export {
  updateTransactionConfirmations,
  populateMissingTransactionFields,
  type ConfirmationUpdate,
  type PopulateFieldsResult,
} from '../sync/confirmations';
