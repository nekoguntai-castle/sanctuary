import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mnemonicToSeedSync, validateMnemonic } from 'bip39';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';
import { parseEnvFile } from '../../scripts/demo/lib/env.mjs';
import { WALLET_SHARE_ROLE_VALUES, type WalletShareRole } from '../../shared/constants/walletRoles';

interface DemoWallet {
  name: string;
  network: string;
  descriptor: string;
  firstAddress?: string;
  labels?: Array<{ name: string; txids: string[] }>;
  shares?: Array<{ username: string; role: WalletShareRole }>;
}

interface DemoManifest {
  testVectorMnemonics: Record<string, string>;
  agents?: Array<{ name: string; fundingWallet: string; operationalWallet: string }>;
  users: Array<{ username: string }>;
  groups: Array<{ members: string[] }>;
  devices: Array<{ fingerprint: string }>;
  wallets: DemoWallet[];
}

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const manifest: DemoManifest = JSON.parse(
  readFileSync(resolve(__dirname, '../../scripts/demo/manifest.json'), 'utf8'),
);

// Published BIP39 test vectors (trezor/python-mnemonic vectors.json; also
// TEST_SEEDS in scripts/verify-addresses/testCases.ts) — the only seeds the demo
// instance may use, because anyone can derive their keys.
const PUBLISHED_TEST_VECTORS = new Set([
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
  'legal winner thank year wave sausage worth useful legal winner thank yellow',
  'letter advice cage absurd amount doctor acoustic avoid letter advice cage above',
  'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
]);

// Derivation here is deliberately independent of server/src descriptor parsing,
// so the manifest is not checked by the code it feeds.
const KEY_EXPRESSION = /\[([0-9a-f]{8})((?:\/\d+h)+)\](xpub[1-9A-HJ-NP-Za-km-z]+)\/<0;1>\/\*/g;

function rootFor(mnemonic: string): BIP32Interface {
  // jsdom swaps the global Uint8Array, and bitcoinjs/bip32 validate against it, so
  // Node Buffers are copied into the test realm's Uint8Array at every boundary.
  return bip32.fromSeed(new Uint8Array(mnemonicToSeedSync(mnemonic)));
}

function keyExpressions(descriptor: string) {
  return [...descriptor.matchAll(KEY_EXPRESSION)].map(([, fingerprint, path, xpub]) => ({
    fingerprint,
    path: `m${path.replaceAll('h', "'")}`,
    xpub,
  }));
}

function firstReceiveAddress(descriptor: string): string {
  const [key] = keyExpressions(descriptor);
  const pubkey = new Uint8Array(bip32.fromBase58(key.xpub).derive(0).derive(0).publicKey);
  if (descriptor.startsWith('wpkh(')) return bitcoin.payments.p2wpkh({ pubkey }).address!;
  if (descriptor.startsWith('tr(')) return bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1) }).address!;
  if (descriptor.startsWith('pkh(')) return bitcoin.payments.p2pkh({ pubkey }).address!;
  throw new Error(`unsupported single-sig descriptor: ${descriptor.slice(0, 8)}`);
}

describe('demo manifest', () => {
  it('only lists published BIP39 test-vector mnemonics, keyed by their real fingerprints', () => {
    for (const [fingerprint, mnemonic] of Object.entries(manifest.testVectorMnemonics)) {
      expect(PUBLISHED_TEST_VECTORS.has(mnemonic)).toBe(true);
      expect(validateMnemonic(mnemonic)).toBe(true);
      expect(Buffer.from(rootFor(mnemonic).fingerprint).toString('hex')).toBe(fingerprint);
    }
  });

  it.each(manifest.wallets.map((w) => [w.name, w] as const))(
    '%s derives every xpub from a listed test vector',
    (_name, wallet) => {
      const keys = keyExpressions(wallet.descriptor);
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        const mnemonic = manifest.testVectorMnemonics[key.fingerprint];
        expect(mnemonic, `fingerprint ${key.fingerprint} is not a listed test vector`).toBeDefined();
        expect(rootFor(mnemonic).derivePath(key.path).neutered().toBase58()).toBe(key.xpub);
      }
    },
  );

  it.each(manifest.wallets.filter((w) => w.firstAddress).map((w) => [w.name, w] as const))(
    '%s first receive address matches the descriptor',
    (_name, wallet) => {
      expect(firstReceiveAddress(wallet.descriptor)).toBe(wallet.firstAddress);
    },
  );

  it('never gives two wallets the same script type and device set (wallet import rejects it)', () => {
    // Mirrors checkDuplicateWallet: the same signers may back wallets of different script types.
    const scriptType = (descriptor: string) => descriptor.slice(0, descriptor.indexOf('('));
    const identities = manifest.wallets.map((w) => [
      scriptType(w.descriptor),
      ...keyExpressions(w.descriptor).map((k) => k.fingerprint).sort(),
    ].join(','));
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('points every agent at two distinct seeded wallets', () => {
    const walletNames = new Set(manifest.wallets.map((w) => w.name));
    for (const agent of manifest.agents ?? []) {
      expect(walletNames.has(agent.fundingWallet)).toBe(true);
      expect(walletNames.has(agent.operationalWallet)).toBe(true);
      expect(agent.fundingWallet).not.toBe(agent.operationalWallet);
    }
  });

  it('references only declared users, devices and well-formed txids', () => {
    const usernames = new Set(manifest.users.map((u) => u.username));
    for (const group of manifest.groups) {
      for (const member of group.members) expect(usernames.has(member)).toBe(true);
    }
    for (const device of manifest.devices) {
      expect(manifest.testVectorMnemonics[device.fingerprint]).toBeDefined();
    }
    for (const wallet of manifest.wallets) {
      expect(wallet.network).toBe('mainnet');
      for (const share of wallet.shares ?? []) {
        expect(usernames.has(share.username)).toBe(true);
        expect(WALLET_SHARE_ROLE_VALUES).toContain(share.role);
      }
      for (const label of wallet.labels ?? []) {
        for (const txid of label.txids) expect(txid).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});

describe('demo env file parsing', () => {
  it('reads KEY=VALUE pairs, strips matching quotes, and skips comments and blanks', () => {
    expect(parseEnvFile([
      '# comment',
      '',
      'DEMO_USERNAME=demo',
      'DEMO_PASSWORD="p=a ss"',
      "SANCTUARY_DEMO_URL='https://localhost:8443'",
      'not a pair',
      '=novalue',
    ].join('\n'))).toEqual({
      DEMO_USERNAME: 'demo',
      DEMO_PASSWORD: 'p=a ss',
      SANCTUARY_DEMO_URL: 'https://localhost:8443',
    });
  });
});
