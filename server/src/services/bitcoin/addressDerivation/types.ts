/**
 * Address Derivation Types
 *
 * Shared interfaces and types for the address derivation module.
 */

/**
 * Multisig key info extracted from descriptor
 */
export interface MultisigKeyInfo {
  fingerprint: string;
  accountPath: string;
  xpub: string;
  derivationPath: string;
}

/**
 * Parsed descriptor result
 */
export interface ParsedDescriptor {
  type: 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh' | 'wsh-sortedmulti' | 'sh-wsh-sortedmulti';
  xpub?: string;
  path?: string;
  fingerprint?: string;
  accountPath?: string;
  // Multisig specific
  quorum?: number;
  keys?: MultisigKeyInfo[];
}

/**
 * Internal type for BIP32 derivation nodes
 */
export type DerivationNode = {
  publicKey?: Buffer;
  derive(index: number): DerivationNode;
};

/**
 * Dependency injection for derivation functions (enables testing)
 */
export type DescriptorDerivationDeps = {
  fromBase58?: (xpub: string, network: import('bitcoinjs-lib').Network) => DerivationNode;
};

/**
 * Result of a single address derivation
 */
export interface DerivedAddress {
  address: string;
  derivationPath: string;
  publicKey: Buffer;
}

/**
 * Result of a batch address derivation
 */
export interface DerivedAddressWithIndex {
  address: string;
  derivationPath: string;
  index: number;
}

/**
 * Xpub validation result
 */
export interface XpubValidationResult {
  valid: boolean;
  error?: string;
  scriptType?: 'native_segwit' | 'nested_segwit' | 'legacy';
}
