import BIP32Factory, { type BIP32Interface } from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

import type {
  AccountKeyEvidence,
  ChainEnvironment,
  DerivationEvidence,
  DerivationImplementation,
  DerivationTestCase,
  TestSeed,
} from '../types.js';
import {
  canonicalFormatForFamily,
  convertExtendedPublicKey,
  decodeAccountKeyEvidence,
} from '../xpub.js';

const bip32 = BIP32Factory(ecc);
bitcoin.initEccLib(ecc);

const REGTEST_NETWORK: bitcoin.Network = {
  ...bitcoin.networks.testnet,
  bech32: 'bcrt',
};

export function networkForChain(chain: ChainEnvironment): bitcoin.Network {
  if (chain === 'mainnet') return bitcoin.networks.bitcoin;
  if (chain === 'regtest') return REGTEST_NETWORK;
  return bitcoin.networks.testnet;
}

function seedMap(seeds: readonly TestSeed[]): Map<string, TestSeed> {
  const mapped = new Map(seeds.map(seed => [seed.id, seed]));
  if (mapped.size !== seeds.length) throw new Error('Duplicate seed identifiers');
  return mapped;
}

function accountNode(root: BIP32Interface, path: string): BIP32Interface {
  if (!/^m(?:\/[0-9]+'?)+$/.test(path)) throw new Error(`Invalid derivation path: ${path}`);
  return root.derivePath(path.slice(2));
}

function accountEvidence(
  testCase: DerivationTestCase,
  seeds: Map<string, TestSeed>,
  network: bitcoin.Network,
): { evidence: AccountKeyEvidence[]; nodes: BIP32Interface[] } {
  if (new Set(testCase.seedIds).size !== testCase.seedIds.length) {
    throw new Error(`Duplicate seed-derived account key in ${testCase.id}`);
  }
  const evidence: AccountKeyEvidence[] = [];
  const nodes: BIP32Interface[] = [];
  const seenAccountKeys = new Set<string>();
  for (const seedId of testCase.seedIds) {
    const testSeed = seeds.get(seedId);
    if (!testSeed) throw new Error(`Unknown seed identifier: ${seedId}`);
    if (!bip39.validateMnemonic(testSeed.mnemonic)) throw new Error(`Invalid BIP39 mnemonic: ${seedId}`);
    const root = bip32.fromSeed(bip39.mnemonicToSeedSync(testSeed.mnemonic), network);
    const node = accountNode(root, testCase.accountPath);
    const canonical = node.neutered().toBase58();
    const expectedCanonical = canonicalFormatForFamily(testCase.derivationFamily);
    const encoded = convertExtendedPublicKey(canonical, testCase.slip132Format, testCase.derivationFamily);
    const keyEvidence = decodeAccountKeyEvidence({
      seedId,
      masterFingerprint: Buffer.from(root.fingerprint).toString('hex'),
      originPath: testCase.accountPath,
      encoded,
      expectedFormat: testCase.slip132Format,
    });
    const keyIdentity = `${keyEvidence.chainCodeHex}:${keyEvidence.publicKeyHex}`;
    if (seenAccountKeys.has(keyIdentity)) {
      throw new Error(`Duplicate derived account key material in ${testCase.id}`);
    }
    seenAccountKeys.add(keyIdentity);
    evidence.push(keyEvidence);
    if (!canonical.startsWith(expectedCanonical)) {
      throw new Error(`Canonical extended key family mismatch for ${testCase.id}`);
    }
    nodes.push(node);
  }
  return { evidence, nodes };
}

function singlePayment(
  testCase: Extract<DerivationTestCase, { kind: 'single_sig' }>,
  publicKey: Buffer,
  network: bitcoin.Network,
): bitcoin.Payment {
  if (testCase.scriptType === 'legacy') return bitcoin.payments.p2pkh({ pubkey: publicKey, network });
  if (testCase.scriptType === 'nested_segwit') {
    return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey: publicKey, network }), network });
  }
  if (testCase.scriptType === 'native_segwit') return bitcoin.payments.p2wpkh({ pubkey: publicKey, network });
  return bitcoin.payments.p2tr({ internalPubkey: publicKey.subarray(1), network });
}

function multisigPayment(
  testCase: Extract<DerivationTestCase, { kind: 'multisig' }>,
  publicKeys: Buffer[],
  network: bitcoin.Network,
): bitcoin.Payment {
  const sorted = [...publicKeys].sort(Buffer.compare);
  const p2ms = bitcoin.payments.p2ms({ m: testCase.threshold, pubkeys: sorted, network });
  const p2wsh = bitcoin.payments.p2wsh({ redeem: p2ms, network });
  return testCase.scriptType === 'p2sh_p2wsh'
    ? bitcoin.payments.p2sh({ redeem: p2wsh, network })
    : p2wsh;
}

function descriptorFor(testCase: DerivationTestCase, keys: readonly AccountKeyEvidence[]): string {
  const expressions = keys.map(key => (
    `[${key.masterFingerprint}/${testCase.accountPath.slice(2)}]${key.encoded}/${testCase.branch}/${testCase.index}`
  ));
  if (testCase.kind === 'multisig') {
    const sortedMulti = `sortedmulti(${testCase.threshold},${expressions.join(',')})`;
    return testCase.scriptType === 'p2sh_p2wsh' ? `sh(wsh(${sortedMulti}))` : `wsh(${sortedMulti})`;
  }
  const expression = expressions[0];
  if (testCase.scriptType === 'legacy') return `pkh(${expression})`;
  if (testCase.scriptType === 'nested_segwit') return `sh(wpkh(${expression}))`;
  if (testCase.scriptType === 'native_segwit') return `wpkh(${expression})`;
  return `tr(${expression})`;
}

function deriveCase(testCase: DerivationTestCase, seeds: Map<string, TestSeed>): DerivationEvidence {
  const network = networkForChain(testCase.chain);
  const { evidence, nodes } = accountEvidence(testCase, seeds, network);
  const childKeys = nodes.map(node => Buffer.from(node.derive(testCase.branch).derive(testCase.index).publicKey));
  const payment = testCase.kind === 'single_sig'
    ? singlePayment(testCase, childKeys[0], network)
    : multisigPayment(testCase, childKeys, network);
  if (!payment.address || !payment.output) throw new Error(`No address/script derived for ${testCase.id}`);
  return {
    caseId: testCase.id,
    implementation: 'bitcoinjs-lib',
    implementationVersion: bitcoinjsImpl.version,
    evidenceScope: 'seed-to-account-and-output',
    accountKeys: evidence,
    address: payment.address,
    scriptPubKeyHex: Buffer.from(payment.output).toString('hex'),
    descriptor: descriptorFor(testCase, evidence),
  };
}

export const bitcoinjsImpl: DerivationImplementation = {
  id: 'bitcoinjs-lib',
  name: 'bitcoinjs-lib',
  version: '7.0.1',
  async isAvailable() { return true; },
  async deriveCases(cases, seeds) {
    const mappedSeeds = seedMap(seeds);
    return cases.map(testCase => deriveCase(testCase, mappedSeeds));
  },
};
