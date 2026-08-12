/**
 * Stable Jade identity binding.
 *
 * The root xpub is parsed only long enough to derive the BIP32 master
 * fingerprint. Account export then proves each hardened parent fingerprint
 * from that root identity through purpose, coin type, and account, so an
 * account-level xpub with plausible depth metadata cannot be substituted.
 */
import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import {
  parseCanonicalAccountPath,
  type DerivationNetworkFamily,
} from '@sanctuary/shared/constants/walletPolicy';

const bip32 = BIP32Factory(ecc);

const networkForFamily = (family: DerivationNetworkFamily): bitcoin.Network => (
  family === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet
);

function parseXpub(xpub: unknown, family: DerivationNetworkFamily, label: string) {
  if (typeof xpub !== 'string' || xpub.length === 0) {
    throw new Error(`Jade returned an invalid ${label}`);
  }
  try {
    return bip32.fromBase58(xpub, networkForFamily(family));
  } catch {
    throw new Error(`Jade returned an invalid ${label} for the selected network`);
  }
}

function fingerprintNumber(bytes: Uint8Array): number {
  return Buffer.from(bytes).readUInt32BE(0);
}

function parseSingleSigAccountPath(path: string, family: DerivationNetworkFamily) {
  const parsed = parseCanonicalAccountPath(path);
  if (!parsed || parsed.policy.walletType !== 'single_sig' || parsed.derivationFamily !== family) {
    throw new Error('Jade account path is not a canonical single-signature path for this session');
  }
  return parsed;
}

/** Derive the master fingerprint without retaining the root xpub or root node. */
export function masterFingerprintFromRootXpub(
  rootXpub: unknown,
  family: DerivationNetworkFamily,
): string {
  const node = parseXpub(rootXpub, family, 'root xpub');
  if (node.depth !== 0 || node.index !== 0 || node.parentFingerprint !== 0) {
    throw new Error('Jade root xpub is not a BIP32 master public key');
  }
  return Buffer.from(node.fingerprint).toString('hex');
}

/** Prove every hardened edge from the transient root fingerprint to the account xpub. */
export function assertJadeAccountXpubChain(
  xpubs: readonly unknown[],
  path: string,
  family: DerivationNetworkFamily,
  masterFingerprint: string,
): string {
  const parsed = parseSingleSigAccountPath(path, family);
  if (!/^[0-9a-f]{8}$/.test(masterFingerprint) || xpubs.length !== 3) {
    throw new Error('Jade account xpub chain is incomplete');
  }
  const nodes = xpubs.map((xpub, index) => parseXpub(xpub, family, `path level ${index + 1} xpub`));
  // Canonical BIP44/49/84/86 accounts have three hardened levels below root.
  const expectedIndexes = [parsed.policy.purpose, parsed.coinType, parsed.account]
    .map(index => 0x80000000 + index);
  let expectedParentFingerprint = Number.parseInt(masterFingerprint, 16);
  for (const [index, node] of nodes.entries()) {
    if (node.depth !== index + 1 || node.index !== expectedIndexes[index]) {
      throw new Error('Jade account xpub depth or child identity differs from the requested path');
    }
    if (node.parentFingerprint !== expectedParentFingerprint) {
      throw new Error('Jade account xpub parent fingerprint chain differs from the selected root identity');
    }
    expectedParentFingerprint = fingerprintNumber(node.fingerprint);
  }
  return xpubs[2] as string;
}
