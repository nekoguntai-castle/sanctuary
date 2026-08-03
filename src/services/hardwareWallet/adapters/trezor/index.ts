/**
 * Trezor Adapter - Barrel Export
 *
 * Re-exports the public API so that existing imports
 * (e.g., `from './trezor'`) continue to work unchanged.
 */

// Main adapter class
export { TrezorAdapter } from './trezorAdapter';

// Types
export type { TrezorConnection, TrezorMultisig, TrezorMultisigPubkey } from './types';

// @internal testing utilities
export { validateSatoshiAmount, getTrezorScriptType, isBip48MultisigPath, getAccountPathPrefix, pathToAddressN } from './pathUtils';
export { convertToStandardXpub } from './xpubUtils';
export { buildTrezorMultisig, isMultisigInput } from './multisig';
