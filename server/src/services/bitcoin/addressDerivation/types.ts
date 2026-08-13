/**
 * Address Derivation Types
 *
 * Shared interfaces and types for the address derivation module.
 */

import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';

export type AddressDerivationNetwork =
  | 'mainnet'
  // Internal compatibility alias for verified vectors and ambiguous testnet-family descriptors.
  | 'testnet'
  | 'testnet3'
  | 'testnet4'
  | 'signet'
  | 'regtest';

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

/** Account-xpub child output. It deliberately carries no master/account path. */
export interface RelativeDerivedAddress {
  address: string;
  publicKey: Buffer;
  branch: 0 | 1;
  index: number;
}

export interface CanonicalSignerOrigin {
  fingerprint: string;
  accountPath: string;
  branch: 0 | 1;
  index: number;
}

export interface CanonicalDerivedAddress extends DerivedAddress {
  branch: 0 | 1;
  index: number;
  scriptPubKey: string;
  signerOrigins: CanonicalSignerOrigin[];
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
  scriptType?: WalletScriptType;
}
