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
  RelativeDerivedAddress,
  CanonicalDerivedAddress,
  CanonicalSignerOrigin,
  DerivedAddressWithIndex,
  XpubValidationResult,
  AddressDerivationNetwork,
} from './types';

// Xpub conversion
export { convertToStandardXpub, convertXpubToFormat } from './xpubConversion';

// Descriptor parsing
export { parseDescriptor } from './descriptorParser';

// Single-sig derivation
export {
  deriveRelativeAddress,
  deriveRelativeAddresses,
} from './singleSigDerivation';

// Descriptor-based derivation (routes to single-sig or multisig)
export {
  deriveCanonicalAddress,
  deriveAddressFromDescriptor,
  deriveAddressesFromDescriptor,
} from './descriptorDerivation';

// Utilities
export { validateXpub } from './utils';
