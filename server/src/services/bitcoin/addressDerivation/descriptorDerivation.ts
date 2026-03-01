/**
 * Descriptor-Based Address Derivation
 *
 * High-level functions that derive addresses from output descriptors,
 * routing to single-sig or multisig derivation as appropriate.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { parseDescriptor } from './descriptorParser';
import { deriveAddress } from './singleSigDerivation';
import { deriveMultisigAddress } from './multisigDerivation';
import type { ParsedDescriptor, DescriptorDerivationDeps, DerivedAddress } from './types';

// Initialize ECC library for Taproot/Schnorr support
bitcoin.initEccLib(ecc);

/**
 * Derive address from descriptor
 */
export function deriveAddressFromDescriptor(
  descriptor: string,
  index: number,
  options: {
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean;
  } = {}
): DerivedAddress {
  const parsed = parseDescriptor(descriptor);
  return deriveAddressFromParsedDescriptor(parsed, index, options);
}

/**
 * Derive address from a pre-parsed descriptor.
 * Useful for callers that already validated/parsing descriptors and for targeted branch testing.
 */
export function deriveAddressFromParsedDescriptor(
  parsed: ParsedDescriptor,
  index: number,
  options: {
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean;
  } = {},
  deps: DescriptorDerivationDeps = {}
): DerivedAddress {
  const { network = 'mainnet', change = false } = options;

  // Handle multisig descriptors
  if (parsed.type === 'wsh-sortedmulti' || parsed.type === 'sh-wsh-sortedmulti') {
    return deriveMultisigAddress(parsed, index, { network, change }, deps);
  }

  // Map descriptor type to script type for single-sig
  const scriptTypeMap: Record<'wpkh' | 'sh-wpkh' | 'tr' | 'pkh', 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy'> = {
    wpkh: 'native_segwit',
    'sh-wpkh': 'nested_segwit',
    tr: 'taproot',
    pkh: 'legacy',
  };

  const scriptType = scriptTypeMap[parsed.type as 'wpkh' | 'sh-wpkh' | 'tr' | 'pkh'];

  if (!parsed.xpub) {
    throw new Error('No xpub found in descriptor');
  }

  return deriveAddress(parsed.xpub, index, {
    scriptType,
    network,
    change,
  });
}

/**
 * Derive multiple addresses from descriptor at once
 */
export function deriveAddressesFromDescriptor(
  descriptor: string,
  startIndex: number,
  count: number,
  options: {
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean;
  } = {}
): Array<{
  address: string;
  derivationPath: string;
  index: number;
}> {
  const addresses: Array<{
    address: string;
    derivationPath: string;
    index: number;
  }> = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    const { address, derivationPath } = deriveAddressFromDescriptor(descriptor, index, options);
    addresses.push({ address, derivationPath, index });
  }

  return addresses;
}
