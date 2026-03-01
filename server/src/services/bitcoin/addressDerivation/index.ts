/**
 * Address Derivation Module
 *
 * Barrel file re-exporting all address derivation functionality.
 * Maintains the same public API as the original addressDerivation.ts file.
 */

// Types
export type {
  MultisigKeyInfo,
  ParsedDescriptor,
  DerivationNode,
  DescriptorDerivationDeps,
  DerivedAddress,
  DerivedAddressWithIndex,
  XpubValidationResult,
} from './types';

// Xpub conversion
export { convertToStandardXpub, convertXpubToFormat } from './xpubConversion';

// Descriptor parsing
export { parseDescriptor } from './descriptorParser';

// Single-sig derivation
export { deriveAddress, deriveAddresses } from './singleSigDerivation';

// Multisig derivation
export { deriveMultisigAddress } from './multisigDerivation';

// Descriptor-based derivation (routes to single-sig or multisig)
export {
  deriveAddressFromDescriptor,
  deriveAddressFromParsedDescriptor,
  deriveAddressesFromDescriptor,
} from './descriptorDerivation';

// Utilities
export { validateXpub } from './utils';
