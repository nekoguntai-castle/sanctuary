/**
 * Address Derivation - Re-export
 *
 * This file re-exports from the modularized addressDerivation/ directory
 * to maintain backward compatibility with existing imports.
 *
 * @see ./addressDerivation/ for the implementation
 */

export {
  // Types
  type MultisigKeyInfo,
  type ParsedDescriptor,
  type DerivationNode,
  type DescriptorDerivationDeps,
  type DerivedAddress,
  type RelativeDerivedAddress,
  type CanonicalDerivedAddress,
  type CanonicalSignerOrigin,
  type DerivedAddressWithIndex,
  type XpubValidationResult,
  // Xpub conversion
  convertToStandardXpub,
  convertXpubToFormat,
  // Descriptor parsing
  parseDescriptor,
  // Single-sig derivation
  deriveRelativeAddress,
  deriveRelativeAddresses,
  // Descriptor-based derivation
  deriveCanonicalAddress,
  deriveAddressFromDescriptor,
  deriveAddressesFromDescriptor,
  // Utilities
  validateXpub,
} from './addressDerivation/index';
