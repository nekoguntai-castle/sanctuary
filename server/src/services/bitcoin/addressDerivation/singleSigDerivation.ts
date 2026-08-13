/**
 * Single-Sig Address Derivation
 *
 * Derives addresses from xpubs for single-signature wallets.
 * Supports P2WPKH (native segwit), P2SH-P2WPKH (nested segwit),
 * P2TR (taproot), and P2PKH (legacy) script types.
 */

import * as bitcoin from 'bitcoinjs-lib';
import {
  assertCanonicalRelativeCoordinate,
  assertCanonicalAddressRange,
} from '@sanctuary/shared/constants/walletPolicy';
import {
  WalletScriptType,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import bip32 from '../bip32';
import { convertToStandardXpub } from './xpubConversion';
import { getNetwork } from './utils';
import type {
  AddressDerivationNetwork,
  DerivationNode,
  DescriptorDerivationDeps,
  RelativeDerivedAddress,
} from './types';

const MAX_DERIVATION_BATCH_SIZE = 1000;

/**
 * Derive an address from xpub at a specific index
 */
export function deriveRelativeAddress(
  xpub: string,
  index: number,
  options: {
    scriptType: WalletScriptTypeValue;
    network: AddressDerivationNetwork;
  } & (
    | { branch: 0 | 1; change?: never }
    | { change: boolean; branch?: never }
  ),
  deps: DescriptorDerivationDeps = {}
): RelativeDerivedAddress {
  if (!options || typeof options !== 'object') {
    throw new Error('Explicit address derivation options are required');
  }
  if (options.branch !== undefined && options.change !== undefined) {
    throw new Error('Conflicting canonical address coordinate branch selectors');
  }
  const { scriptType, network } = options;
  if (options.branch === undefined && typeof options.change !== 'boolean') {
    throw new Error('Invalid canonical address coordinate branch');
  }
  const branch = options.branch ?? (options.change ? 1 : 0);
  const coordinate = assertCanonicalRelativeCoordinate({
    branch,
    index,
  });
  const networkObj = getNetwork(network);

  // Convert zpub/ypub/etc to standard xpub format for parsing
  const standardXpub = convertToStandardXpub(xpub);

  // Parse xpub
  const fromBase58 = deps.fromBase58 ?? ((extendedKey: string, net: bitcoin.Network) => bip32.fromBase58(extendedKey, net) as unknown as DerivationNode);
  const node = fromBase58(standardXpub, networkObj);

  // Derive address: m/<change>/<index>
  const derived = node.derive(coordinate.branch).derive(coordinate.index);

  if (!derived.publicKey) {
    throw new Error('Failed to derive public key');
  }

  let address: string;

  // Generate address based on script type
  switch (scriptType) {
    case WalletScriptType.NATIVE_SEGWIT: {
      // P2WPKH (bech32)
      const payment = bitcoin.payments.p2wpkh({
        pubkey: derived.publicKey,
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case WalletScriptType.NESTED_SEGWIT: {
      // P2SH-P2WPKH (starts with 3)
      const payment = bitcoin.payments.p2sh({
        redeem: bitcoin.payments.p2wpkh({
          pubkey: derived.publicKey,
          network: networkObj,
        }),
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case WalletScriptType.TAPROOT: {
      // P2TR (bech32m)
      const payment = bitcoin.payments.p2tr({
        internalPubkey: derived.publicKey.slice(1, 33), // Remove 0x02/0x03 prefix
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case WalletScriptType.LEGACY: {
      // P2PKH (starts with 1)
      const payment = bitcoin.payments.p2pkh({
        pubkey: derived.publicKey,
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    default:
      throw new Error(`Unsupported script type: ${scriptType}`);
  }

  return {
    address,
    publicKey: derived.publicKey,
    branch: coordinate.branch,
    index: coordinate.index,
  };
}

/**
 * Derive multiple addresses at once
 */
export function deriveRelativeAddresses(
  xpub: string,
  startIndex: number,
  count: number,
  options: {
    scriptType: WalletScriptTypeValue;
    network: AddressDerivationNetwork;
  } & (
    | { branch: 0 | 1; change?: never }
    | { change: boolean; branch?: never }
  )
): RelativeDerivedAddress[] {
  assertCanonicalAddressRange(startIndex, count);
  if (count > MAX_DERIVATION_BATCH_SIZE) {
    throw new Error(`Address derivation batch exceeds ${MAX_DERIVATION_BATCH_SIZE} entries`);
  }
  const addresses: RelativeDerivedAddress[] = [];

  for (let i = 0; i < count; i++) {
    const index = startIndex + i;
    addresses.push(deriveRelativeAddress(xpub, index, options));
  }

  return addresses;
}
