/**
 * Ownership Transfer Service Module
 *
 * Barrel file re-exporting the public API from all sub-modules.
 * External consumers should import from this index.
 *
 * Handles secure 3-step ownership transfers for wallets and devices:
 * 1. Owner initiates transfer
 * 2. Recipient accepts (or declines)
 * 3. Owner confirms to complete
 *
 * Owner can cancel at any point before final confirmation.
 */

// Types
export type {
  TransferStatus,
  ResourceType,
  Transfer,
  InitiateTransferInput,
  TransferFilters,
} from './types';

// Transfer initiation
export { initiateTransfer } from './initiate';

// Transfer actions (accept, decline, cancel)
export { acceptTransfer, declineTransfer, cancelTransfer } from './actions';

// Transfer confirmation and execution
export { confirmTransfer } from './confirm';

// Transfer queries
export {
  getUserTransfers,
  getTransfer,
  hasActiveTransfer,
  getPendingIncomingCount,
  getAwaitingConfirmationCount,
} from './queries';

// Transfer maintenance
export { expireOldTransfers } from './maintenance';
