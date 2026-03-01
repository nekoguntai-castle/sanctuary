/**
 * Wallet Import Service
 *
 * Handles importing wallets from descriptors or JSON configurations.
 * Automatically resolves device conflicts by reusing existing devices
 * when fingerprints match, or creating new devices otherwise.
 *
 * Module structure:
 * - types.ts             - Shared type definitions
 * - deviceResolution.ts  - Fingerprint matching, conflict detection
 * - descriptorImport.ts  - Descriptor string parsing + wallet creation
 * - jsonImport.ts        - JSON config parsing + wallet creation
 * - walletImportService.ts - Shared transaction logic + orchestrator
 */

// Re-export types
export type {
  DeviceResolution,
  ImportValidationResult,
  ImportWalletResult,
  ImportedDeviceInfo,
} from './types';

// Re-export public API functions
export { validateImport, importWallet } from './walletImportService';
export { importFromDescriptor, importFromParsedData } from './descriptorImport';
export { importFromJson } from './jsonImport';
export { resolveDevices, generateUniqueLabel, checkDuplicateWallet } from './deviceResolution';
