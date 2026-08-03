/**
 * CreateWallet Component Module
 *
 * Refactored CreateWallet component split into:
 * - CreateWallet (main orchestrator with state, navigation, wallet creation)
 * - WalletTypeStep (Step 1: single-sig vs multi-sig selection)
 * - SignerSelectionStep (Step 2: device/signer picker)
 * - ConfigurationStep (Step 3: name, network, script type, quorum)
 * - ReviewStep (Step 4: review details before creation)
 * - types (shared type aliases)
 */

// Main component
export { CreateWallet } from './CreateWallet';

// Step subcomponents
export { WalletTypeStep } from './WalletTypeStep';
export { SignerSelectionStep } from './SignerSelectionStep';
export { ConfigurationStep } from './ConfigurationStep';
export { ReviewStep } from './ReviewStep';

// Types
export * from './types';
