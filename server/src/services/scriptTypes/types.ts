/**
 * Script Type Handler Types
 *
 * Defines interfaces for the pluggable script type system.
 * New script types can be added by implementing ScriptTypeHandler.
 */

import type { NetworkType } from '@sanctuary/shared/constants/bitcoin';
import type { WalletScriptType } from '@sanctuary/shared/constants/walletIdentity';

export type Network = NetworkType;

/**
 * Device key information for descriptor building
 */
export interface DeviceKeyInfo {
  fingerprint: string;
  xpub: string;
  derivationPath?: string;
}

/**
 * Descriptor build options
 */
export interface DescriptorBuildOptions {
  network: Network;
  change?: boolean; // true = internal/change chain (1/*), false = external/receive chain (0/*)
}

/**
 * Multi-sig descriptor build options
 */
export interface MultiSigBuildOptions extends DescriptorBuildOptions {
  quorum: number;
}

/**
 * Script type handler interface
 *
 * Implement this interface to add support for a new script type.
 * Register the handler with scriptTypeRegistry.register()
 */
export interface ScriptTypeHandler {
  /** Unique identifier for this script type (e.g., 'native_segwit') */
  readonly id: WalletScriptType;

  /** Human-readable name (e.g., 'Native SegWit (P2WPKH)') */
  readonly name: string;

  /** Description of this script type */
  readonly description: string;

  /** BIP number associated with this script type (for single-sig) */
  readonly bip?: number;

  /** BIP number for multisig derivation */
  readonly multisigBip?: number;

  /** Multisig script type number (for BIP48) */
  readonly multisigScriptTypeNumber?: number;

  /** Whether this script type supports multisig */
  readonly supportsMultisig: boolean;

  /** Alias names for this script type (for detection/compatibility) */
  readonly aliases?: string[];

  /**
   * Get the standard derivation path for single-sig
   */
  getDerivationPath(network: Network, account?: number): string;

  /**
   * Get the standard derivation path for multi-sig
   */
  getMultisigDerivationPath(network: Network, account?: number): string;

  /**
   * Build a single-sig descriptor
   */
  buildSingleSigDescriptor(device: DeviceKeyInfo, options: DescriptorBuildOptions): string;

  /**
   * Build a multi-sig descriptor (optional, only if supportsMultisig is true)
   */
  buildMultiSigDescriptor?(devices: DeviceKeyInfo[], options: MultiSigBuildOptions): string;

  /**
   * Validate that a device supports this script type (optional)
   */
  validateDevice?(deviceScriptTypes: string[]): boolean;
}

/**
 * Registry configuration
 */
export interface ScriptTypeRegistryConfig {
  /** Enable debug logging */
  debug?: boolean;
}
