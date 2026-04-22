/**
 * Caravan (Unchained Capital) Implementation Wrapper
 *
 * Uses @caravan/bitcoin library for address derivation.
 * Caravan is primarily a multisig library, so for single-sig we combine
 * its key derivation with bitcoinjs-lib payment encoding.
 *
 * This gives us independent key derivation (Caravan) while using standard
 * address encoding (bitcoinjs-lib) - any bugs in key derivation will still
 * be caught.
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { BitcoinNetwork as CaravanNetwork } from '@caravan/bitcoin';
import type { AddressDeriver, ScriptType, MultisigScriptType, Network } from '../types.js';

// Initialize bitcoinjs-lib with secp256k1
bitcoin.initEccLib(ecc);

// Caravan imports - will be dynamically imported
let caravan: typeof import('@caravan/bitcoin') | null = null;

async function loadCaravan(): Promise<typeof import('@caravan/bitcoin')> {
  if (!caravan) {
    caravan = await import('@caravan/bitcoin');
  }
  return caravan;
}

/**
 * Map our multisig script types to Caravan's address types
 */
function mapMultisigScriptTypeToCaravan(scriptType: MultisigScriptType): string {
  switch (scriptType) {
    case 'p2sh':
      return 'P2SH';
    case 'p2sh_p2wsh':
      return 'P2SH-P2WSH';
    case 'p2wsh':
      return 'P2WSH';
    default:
      throw new Error(`Unknown multisig script type: ${scriptType}`);
  }
}

/**
 * Map our network to Caravan's network constants
 */
function mapNetworkToCaravan(network: Network): CaravanNetwork {
  return (network === 'mainnet' ? 'mainnet' : 'testnet') as CaravanNetwork;
}

/**
 * Get bitcoinjs-lib network
 */
function getBitcoinJsNetwork(network: Network): bitcoin.Network {
  return network === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

export const caravanImpl: AddressDeriver = {
  name: 'Caravan',
  version: '0.4.5',

  async deriveSingleSig(
    xpub: string,
    index: number,
    scriptType: ScriptType,
    change: boolean,
    network: Network
  ): Promise<string> {
    const lib = await loadCaravan();

    const changeNum = change ? 1 : 0;
    const bip32Path = `m/${changeNum}/${index}`;
    const caravanNetwork = mapNetworkToCaravan(network);

    // Caravan's deriveChildPublicKey function - this is independent from bitcoinjs-lib
    const childPubKeyHex = lib.deriveChildPublicKey(xpub, bip32Path, caravanNetwork);

    // Convert to buffer for bitcoinjs-lib
    const pubkeyBuffer = Buffer.from(childPubKeyHex, 'hex');
    const bjsNetwork = getBitcoinJsNetwork(network);

    // Generate address based on script type using bitcoinjs-lib payments
    // The key derivation is Caravan's, address encoding is bitcoinjs-lib's
    let address: string;

    switch (scriptType) {
      case 'legacy': {
        // P2PKH
        const { address: p2pkh } = bitcoin.payments.p2pkh({
          pubkey: pubkeyBuffer,
          network: bjsNetwork,
        });
        address = p2pkh!;
        break;
      }

      case 'nested_segwit': {
        // P2SH-P2WPKH
        const { address: p2sh } = bitcoin.payments.p2sh({
          redeem: bitcoin.payments.p2wpkh({
            pubkey: pubkeyBuffer,
            network: bjsNetwork,
          }),
          network: bjsNetwork,
        });
        address = p2sh!;
        break;
      }

      case 'native_segwit': {
        // P2WPKH
        const { address: p2wpkh } = bitcoin.payments.p2wpkh({
          pubkey: pubkeyBuffer,
          network: bjsNetwork,
        });
        address = p2wpkh!;
        break;
      }

      case 'taproot': {
        // P2TR - need x-only pubkey (32 bytes, no prefix)
        const xOnlyPubkey = pubkeyBuffer.subarray(1, 33); // Remove prefix byte
        const { address: p2tr } = bitcoin.payments.p2tr({
          internalPubkey: xOnlyPubkey,
          network: bjsNetwork,
        });
        address = p2tr!;
        break;
      }

      default:
        throw new Error(`Unknown script type: ${scriptType}`);
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
    const lib = await loadCaravan();

    const changeNum = change ? 1 : 0;
    const bip32Path = `m/${changeNum}/${index}`;
    const caravanNetwork = mapNetworkToCaravan(network);

    // Derive child public keys from each xpub
    const publicKeys = xpubs.map(xpub =>
      lib.deriveChildPublicKey(xpub, bip32Path, caravanNetwork)
    );

    // Caravan 0.4.5 expects callers to sort for sortedmulti/BIP67 compatibility.
    const sortedPubKeys = [...publicKeys].sort();

    // Build multisig address
    const addressType = mapMultisigScriptTypeToCaravan(scriptType);

    const result = lib.generateMultisigFromPublicKeys(
      caravanNetwork,
      addressType,
      threshold,
      ...sortedPubKeys
    );

    if (!result) {
      throw new Error('Failed to generate Caravan multisig address');
    }

    const address = lib.multisigAddress(result);
    if (typeof address !== 'string' || address.length === 0) {
      throw new Error('Failed to read Caravan multisig address');
    }

    return address;
  },

  async isAvailable(): Promise<boolean> {
    try {
      await loadCaravan();
      return true;
    } catch {
      return false;
    }
  },
};
