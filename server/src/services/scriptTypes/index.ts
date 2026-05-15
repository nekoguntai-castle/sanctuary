/**
 * Script Type Registry
 *
 * Central registry for Bitcoin script type handlers.
 * Supports derivation paths, descriptor building, and script type validation.
 *
 * Usage:
 *   import { scriptTypeRegistry } from './scriptTypes';
 *
 *   // Get derivation path
 *   const path = scriptTypeRegistry.getDerivationPath('native_segwit', 'mainnet');
 *
 *   // Build descriptor
 *   const descriptor = scriptTypeRegistry.buildSingleSigDescriptor(
 *     'native_segwit',
 *     { fingerprint: '12345678', xpub: 'xpub...' },
 *     { network: 'mainnet' }
 *   );
 *
 * Adding new script types:
 *   1. Create handler in handlers/ directory implementing ScriptTypeHandler
 *   2. Import and register below
 */

import {
  parseWalletScriptType,
  type WalletScriptType,
} from '@sanctuary/shared/constants/walletIdentity';
import { scriptTypeRegistry } from './registry';

// Import handlers
import { nativeSegwitHandler } from './handlers/nativeSegwit';
import { nestedSegwitHandler } from './handlers/nestedSegwit';
import { legacyHandler } from './handlers/legacy';
import { taprootHandler } from './handlers/taproot';

// Register handlers
scriptTypeRegistry.register(nativeSegwitHandler);
scriptTypeRegistry.register(nestedSegwitHandler);
scriptTypeRegistry.register(legacyHandler);
scriptTypeRegistry.register(taprootHandler);

// Export the registry and types
export { scriptTypeRegistry } from './registry';
export type {
  ScriptTypeHandler,
  DeviceKeyInfo,
  DescriptorBuildOptions,
  MultiSigBuildOptions,
  Network,
} from './types';

// Export individual handlers for direct use if needed
export { nativeSegwitHandler } from './handlers/nativeSegwit';
export { nestedSegwitHandler } from './handlers/nestedSegwit';
export { legacyHandler } from './handlers/legacy';
export { taprootHandler } from './handlers/taproot';

/**
 * Convenience type for script type IDs
 */
export type ScriptTypeId = WalletScriptType;

/**
 * Check if a string is a valid script type ID
 */
export function isValidScriptType(id: string): id is ScriptTypeId {
  return parseWalletScriptType(id) !== null && scriptTypeRegistry.has(id);
}
