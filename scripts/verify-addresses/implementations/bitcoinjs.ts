/**
 * bitcoinjs-lib Implementation Wrapper
 *
 * Uses bitcoinjs-lib directly for address derivation.
 * This is the same library Sanctuary uses, providing a clean reference
 * implementation to verify against other implementations.
 *
 * Note: This is a fresh implementation, not importing from Sanctuary,
 * to ensure we're testing the library's correctness independently.
 */

import * as bitcoin from 'bitcoinjs-lib';
import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';

const bip32 = BIP32Factory(ecc);
import bs58check from 'bs58check';
import type { AddressDeriver, ScriptType, MultisigScriptType, Network } from '../types.js';

// Initialize ECC for bitcoinjs-lib (required for Taproot)
bitcoin.initEccLib(ecc);

/**
 * SLIP-132 version bytes for xpub conversion
 */
const XPUB_VERSIONS: Record<string, Buffer> = {
  // Mainnet
  'xpub': Buffer.from([0x04, 0x88, 0xB2, 0x1E]),
  'ypub': Buffer.from([0x04, 0x88, 0xB2, 0x1E]),
  'zpub': Buffer.from([0x04, 0x88, 0xB2, 0x1E]),
  'Ypub': Buffer.from([0x04, 0x88, 0xB2, 0x1E]),
  'Zpub': Buffer.from([0x04, 0x88, 0xB2, 0x1E]),
  // Testnet
  'tpub': Buffer.from([0x04, 0x35, 0x87, 0xCF]),
  'upub': Buffer.from([0x04, 0x35, 0x87, 0xCF]),
  'vpub': Buffer.from([0x04, 0x35, 0x87, 0xCF]),
  'Upub': Buffer.from([0x04, 0x35, 0x87, 0xCF]),
  'Vpub': Buffer.from([0x04, 0x35, 0x87, 0xCF]),
};

/**
 * Convert any xpub format to standard xpub/tpub
 */
function convertToStandardXpub(extendedKey: string): string {
  const prefix = extendedKey.slice(0, 4);

  // Already standard format
  if (prefix === 'xpub' || prefix === 'tpub') {
    return extendedKey;
  }

  const targetVersion = XPUB_VERSIONS[prefix];
  if (!targetVersion) {
    return extendedKey; // Unknown format, return as-is
  }

  try {
    const decoded = bs58check.decode(extendedKey);
    const converted = Buffer.concat([targetVersion, decoded.slice(4)]);
    return bs58check.encode(converted);
  } catch {
    return extendedKey;
  }
}

/**
 * Get network object
 */
function getNetwork(network: Network): bitcoin.Network {
  return network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

export const bitcoinjsImpl: AddressDeriver = {
  name: 'bitcoinjs-lib',
  version: '7.0.1',

  async deriveSingleSig(
    xpub: string,
    index: number,
    scriptType: ScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    const networkObj = getNetwork(network);
    const standardXpub = convertToStandardXpub(xpub);

    // Parse xpub and derive child key
    const node = bip32.fromBase58(standardXpub, networkObj);
    const changeIndex = change ? 1 : 0;
    const derived = node.derive(changeIndex).derive(index);

    if (!derived.publicKey) {
      throw new Error('Failed to derive public key');
    }
    const publicKey = Buffer.from(derived.publicKey);

    let address: string | undefined;

    switch (scriptType) {
      case 'legacy': {
        // P2PKH
        const payment = bitcoin.payments.p2pkh({
          pubkey: publicKey,
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      case 'nested_segwit': {
        // P2SH-P2WPKH
        const payment = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({
            pubkey: publicKey,
            network: networkObj,
          }),
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      case 'native_segwit': {
        // P2WPKH
        const payment = bitcoin.payments.p2wpkh({
          pubkey: publicKey,
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      case 'taproot': {
        // P2TR - use x-only pubkey (32 bytes, no prefix)
        const payment = bitcoin.payments.p2tr({
          internalPubkey: publicKey.subarray(1, 33),
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      default:
        throw new Error(`Unknown script type: ${scriptType}`);
    }

    if (!address) {
      throw new Error('Failed to generate address');
    }

    return address;
  },

  async deriveMultisig(
    xpubs: string[],
    threshold: number,
    index: number,
    scriptType: MultisigScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    const networkObj = getNetwork(network);
    const changeIndex = change ? 1 : 0;

    // Derive public keys from each xpub
    const pubkeys: Buffer[] = [];
    for (const xpub of xpubs) {
      const standardXpub = convertToStandardXpub(xpub);
      const node = bip32.fromBase58(standardXpub, networkObj);
      const derived = node.derive(changeIndex).derive(index);

      if (!derived.publicKey) {
        throw new Error('Failed to derive public key');
      }

      pubkeys.push(Buffer.from(derived.publicKey));
    }

    // Sort public keys lexicographically (BIP-67)
    pubkeys.sort((a, b) => a.compare(b));

    // Create multisig redeem script
    const p2ms = bitcoin.payments.p2ms({
      m: threshold,
      pubkeys,
      network: networkObj,
    });

    let address: string | undefined;

    switch (scriptType) {
      case 'p2sh': {
        // P2SH (legacy multisig)
        const payment = bitcoin.payments.p2sh({
          redeem: p2ms,
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      case 'p2sh_p2wsh': {
        // P2SH-P2WSH (nested segwit multisig)
        const p2wsh = bitcoin.payments.p2wsh({
          redeem: p2ms,
          network: networkObj,
        });
        const payment = bitcoin.payments.p2sh({
          redeem: p2wsh,
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      case 'p2wsh': {
        // P2WSH (native segwit multisig)
        const payment = bitcoin.payments.p2wsh({
          redeem: p2ms,
          network: networkObj,
        });
        address = payment.address;
        break;
      }

      default:
        throw new Error(`Unknown multisig script type: ${scriptType}`);
    }

    if (!address) {
      throw new Error('Failed to generate multisig address');
    }

    return address;
  },

  async isAvailable(): Promise<boolean> {
    // bitcoinjs-lib is always available as a direct dependency
    return true;
  },
};
