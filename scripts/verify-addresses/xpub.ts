import BIP32Factory from 'bip32';
import * as bip39 from 'bip39';
import * as ecc from 'tiny-secp256k1';

import type { Network } from './types.js';

const bip32 = BIP32Factory(ecc);

const BIP32_NETWORKS: Record<Network, Parameters<typeof bip32.fromSeed>[1]> = {
  mainnet: {
    bip32: { public: 0x0488B21E, private: 0x0488ADE4 },
    wif: 0x80,
  },
  testnet: {
    bip32: { public: 0x043587CF, private: 0x04358394 },
    wif: 0xEF,
  },
};

function getDerivationParts(path: string): string[] {
  return path.replace('m/', '').split('/');
}

function getDerivationIndex(pathPart: string): number {
  return parseInt(pathPart.replace(/['h]/g, ''), 10);
}

function isHardenedPathPart(pathPart: string): boolean {
  return pathPart.endsWith("'") || pathPart.endsWith('h');
}

/**
 * Derive xpub from mnemonic for a given BIP path.
 */
export function deriveXpub(mnemonic: string, path: string, network: Network): string {
  const seed = bip39.mnemonicToSeedSync(mnemonic);
  let node = bip32.fromSeed(seed, BIP32_NETWORKS[network]);

  for (const part of getDerivationParts(path)) {
    const index = getDerivationIndex(part);
    node = isHardenedPathPart(part) ? node.deriveHardened(index) : node.derive(index);
  }

  return node.neutered().toBase58();
}
