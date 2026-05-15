/**
 * Wallet Service - Barrel Export
 *
 * Re-exports the public API from all wallet service modules so that
 * external imports (e.g., `from '../services/wallet'`) continue to work
 * without any changes.
 */

// Types
export type { WalletAccessCheckResult, CreateWalletInput, WalletRole, WalletWithBalance } from './types';

// Access control — consolidated into services/accessControl (with Redis caching)
export {
  getUserWalletRole,
  hasWalletAccess as checkWalletAccess,
  checkWalletEditAccess,
  checkWalletOwnerAccess,
  checkWalletApproveAccess,
  checkWalletAccess as checkWalletAccessWithRole,
} from '../accessControl';

// Address generation
export { generateInitialAddresses, generateAddress } from './addressGeneration';

// Wallet creation
export { createWallet } from './walletCreate';

// Wallet queries
export { getUserWallets, getWalletById, getWalletStats } from './walletQueries';

// Wallet mutations
export { updateWallet, deleteWallet } from './walletMutations';

// Wallet device operations
export { addDeviceToWallet, repairWalletDescriptor } from './walletDevices';
