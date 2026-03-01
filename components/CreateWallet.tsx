/**
 * CreateWallet Component
 *
 * Re-export from the refactored module for backwards compatibility.
 * The component has been split into smaller, focused modules:
 *
 * @see ./CreateWallet/CreateWallet.tsx - Main orchestrator
 * @see ./CreateWallet/WalletTypeStep.tsx - Step 1: wallet type selection
 * @see ./CreateWallet/SignerSelectionStep.tsx - Step 2: signer picker
 * @see ./CreateWallet/ConfigurationStep.tsx - Step 3: configuration
 * @see ./CreateWallet/ReviewStep.tsx - Step 4: review before creation
 * @see ./CreateWallet/types.ts - Shared types
 */

export { CreateWallet } from './CreateWallet/index';
