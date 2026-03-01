/**
 * Single-Sig Address Derivation
 *
 * Derives addresses from xpubs for single-signature wallets.
 * Supports P2WPKH (native segwit), P2SH-P2WPKH (nested segwit),
 * P2TR (taproot), and P2PKH (legacy) script types.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { convertToStandardXpub } from './xpubConversion';
import { getNetwork, getAccountPath } from './utils';
import type { DerivationNode, DescriptorDerivationDeps, DerivedAddress } from './types';

const bip32 = BIP32Factory(ecc);

/**
 * Derive an address from xpub at a specific index
 */
export function deriveAddress(
  xpub: string,
  index: number,
  options: {
    scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
    network?: 'mainnet' | 'testnet' | 'regtest';
    change?: boolean; // false = external (receive), true = internal (change)
  } = {},
  deps: DescriptorDerivationDeps = {}
): DerivedAddress {
  const {
    scriptType = 'native_segwit',
    network = 'mainnet',
    change = false,
  } = options;

  const networkObj = getNetwork(network);

  // Convert zpub/ypub/etc to standard xpub format for parsing
  const standardXpub = convertToStandardXpub(xpub);

  // Parse xpub
  const fromBase58 = deps.fromBase58 ?? ((extendedKey: string, net: bitcoin.Network) => bip32.fromBase58(extendedKey, net) as unknown as DerivationNode);
  const node = fromBase58(standardXpub, networkObj);

  // Derive address: m/<change>/<index>
  const changeIndex = change ? 1 : 0;
  const derived = node.derive(changeIndex).derive(index);

  if (!derived.publicKey) {
    throw new Error('Failed to derive public key');
  }

  let address: string;
  let derivationPath: string;

  // Get account path from xpub (standard paths)
  const accountPath = getAccountPath(xpub, scriptType, network);
  derivationPath = `${accountPath}/${changeIndex}/${index}`;

  // Generate address based on script type
  switch (scriptType) {
    case 'native_segwit': {
      // P2WPKH (bech32)
      const payment = bitcoin.payments.p2wpkh({
        pubkey: derived.publicKey,
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case 'nested_segwit': {
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

    case 'taproot': {
      // P2TR (bech32m)
      const payment = bitcoin.payments.p2tr({
        internalPubkey: derived.publicKey.slice(1, 33), // Remove 0x02/0x03 prefix
        network: networkObj,
      });
      if (!payment.address) throw new Error('Failed to generate address');
      address = payment.address;
      break;
    }

    case 'legacy': {
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
    derivationPath,
    publicKey: derived.publicKey,
  };
}

/**
 * Derive multiple addresses at once
 */
export function deriveAddresses(
  xpub: string,
  startIndex: number,
  count: number,
  options: {
    scriptType?: 'native_segwit' | 'nested_segwit' | 'taproot' | 'legacy';
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
    const { address, derivationPath } = deriveAddress(xpub, index, options);
    addresses.push({ address, derivationPath, index });
  }

  return addresses;
}
