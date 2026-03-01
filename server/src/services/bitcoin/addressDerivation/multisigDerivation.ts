/**
 * Multisig Address Derivation
 *
 * Derives addresses from multisig descriptors (P2WSH and P2SH-P2WSH).
 * Handles sortedmulti key ordering and various derivation path formats.
 */

import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';
import { convertToStandardXpub } from './xpubConversion';
import { getNetwork } from './utils';
import type { ParsedDescriptor, DerivationNode, DescriptorDerivationDeps, DerivedAddress } from './types';

const bip32 = BIP32Factory(ecc);

/**
 * Derive multisig address from parsed descriptor
 */
export function deriveMultisigAddress(
  parsed: ParsedDescriptor,
  index: number,
  options: {
    network: 'mainnet' | 'testnet' | 'regtest';
    change: boolean;
  },
  deps: DescriptorDerivationDeps = {}
): DerivedAddress {
  const { network, change } = options;
  const networkObj = getNetwork(network);
  const fromBase58 = deps.fromBase58 ?? ((xpub: string, net: bitcoin.Network) => bip32.fromBase58(xpub, net) as unknown as DerivationNode);

  if (!parsed.keys || parsed.keys.length === 0) {
    throw new Error('No keys found in multisig descriptor');
  }
  if (parsed.quorum === undefined) {
    throw new Error('No quorum found in multisig descriptor');
  }

  const changeIndex = change ? 1 : 0;

  // Derive public keys from each xpub at the given index
  const pubkeys: Buffer[] = [];
  for (const keyInfo of parsed.keys) {
    // Convert zpub/ypub/Zpub/Ypub to standard xpub format for parsing
    const standardXpub = convertToStandardXpub(keyInfo.xpub);
    const node = fromBase58(standardXpub, networkObj);
    // Derivation path after xpub is typically <0;1>/* or 0/* (external/internal)
    // Handle both formats:
    // - "0/*" -> derive at 0/index (receive only)
    // - "<0;1>/*" -> derive at changeIndex/index (both receive and change)
    // - "/*" -> derive at changeIndex/index (assumes change prefix needed)
    let pathStr = keyInfo.derivationPath;

    // Replace <0;1> with the appropriate change index
    if (pathStr.includes('<0;1>')) {
      pathStr = pathStr.replace('<0;1>', String(changeIndex));
    } else if (pathStr.startsWith('0/') || pathStr.startsWith('1/')) {
      // Path already has explicit change index, replace the first number with our change index
      pathStr = String(changeIndex) + pathStr.slice(1);
    } else if (pathStr === '*' || pathStr === '/*') {
      // No change prefix, add it
      pathStr = `${changeIndex}/${index}`;
    }

    // Replace * with index
    pathStr = pathStr.replace('*', String(index));

    const pathParts = pathStr.split('/');
    let derived = node;
    for (const part of pathParts) {
      if (part === '') continue;
      const idx = parseInt(part, 10);
      if (!isNaN(idx)) {
        derived = derived.derive(idx);
      }
    }
    if (!derived.publicKey) {
      throw new Error('Failed to derive public key from xpub');
    }
    pubkeys.push(derived.publicKey);
  }

  // Sort public keys for sortedmulti (lexicographic order)
  pubkeys.sort((a, b) => a.compare(b));

  // Create the multisig redeem script (p2ms)
  const p2ms = bitcoin.payments.p2ms({
    m: parsed.quorum,
    pubkeys,
    network: networkObj,
  });

  let address: string;

  if (parsed.type === 'wsh-sortedmulti') {
    // P2WSH (native segwit multisig)
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: p2ms,
      network: networkObj,
    });
    if (!p2wsh.address) throw new Error('Failed to generate P2WSH address');
    address = p2wsh.address;
  } else {
    // P2SH-P2WSH (nested segwit multisig)
    const p2wsh = bitcoin.payments.p2wsh({
      redeem: p2ms,
      network: networkObj,
    });
    const p2sh = bitcoin.payments.p2sh({
      redeem: p2wsh,
      network: networkObj,
    });
    if (!p2sh.address) throw new Error('Failed to generate P2SH-P2WSH address');
    address = p2sh.address;
  }

  // Build derivation path string (use first key's path as reference)
  const firstKey = parsed.keys[0];
  const derivationPath = `m/${firstKey.accountPath}/${changeIndex}/${index}`;

  return {
    address,
    derivationPath,
    publicKey: pubkeys[0], // Return first sorted pubkey as reference
  };
}
