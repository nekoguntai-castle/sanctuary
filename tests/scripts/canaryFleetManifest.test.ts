import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { mnemonicToSeedSync } from 'bip39';
import { BIP32Factory, type BIP32Interface } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';

interface FleetWallet { name: string; network: string; descriptor: string; firstAddress: string }

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const read = (path: string) => JSON.parse(readFileSync(resolve(__dirname, path), 'utf8'));
const fleet: { minimumWallets: number; wallets: FleetWallet[] } = read('../../scripts/release/canary/fleet-manifest.json');
const demo: { testVectorMnemonics: Record<string, string>; wallets: Array<{ descriptor: string }> } =
  read('../../scripts/demo/manifest.json');

// Derivation is independent of server/src descriptor parsing, as in the demo manifest test.
const SINGLE_KEY = /^(pkh|sh\(wpkh|wpkh|tr)\(\[([0-9a-f]{8})((?:\/\d+h){3})\](xpub[1-9A-HJ-NP-Za-km-z]+)\/<0;1>\/\*\)\)?$/;

function parse(descriptor: string) {
  const match = SINGLE_KEY.exec(descriptor);
  if (!match) throw new Error(`unexpected descriptor shape: ${descriptor.slice(0, 16)}`);
  const [, type, fingerprint, path, xpub] = match;
  return { type, fingerprint, path, xpub, origin: `${type}:${fingerprint}${path}` };
}

function rootFor(mnemonic: string): BIP32Interface {
  return bip32.fromSeed(new Uint8Array(mnemonicToSeedSync(mnemonic)));
}

function firstAddress(type: string, xpub: string): string {
  const pubkey = new Uint8Array(bip32.fromBase58(xpub).derive(0).derive(0).publicKey);
  if (type === 'pkh') return bitcoin.payments.p2pkh({ pubkey }).address!;
  if (type === 'sh(wpkh') return bitcoin.payments.p2sh({ redeem: bitcoin.payments.p2wpkh({ pubkey }) }).address!;
  if (type === 'wpkh') return bitcoin.payments.p2wpkh({ pubkey }).address!;
  return bitcoin.payments.p2tr({ internalPubkey: pubkey.subarray(1) }).address!;
}

describe('canary fleet manifest', () => {
  it('meets the canary validator minimum with uniquely named mainnet wallets', () => {
    expect(fleet.minimumWallets).toBe(12);
    expect(fleet.wallets.length).toBeGreaterThanOrEqual(fleet.minimumWallets);
    expect(new Set(fleet.wallets.map((w) => w.name)).size).toBe(fleet.wallets.length);
    for (const w of fleet.wallets) {
      expect(w.network).toBe('mainnet');
      expect(w.name.startsWith('Canary fleet ')).toBe(true);
    }
  });

  it('derives every key from a demo test-vector mnemonic and matches the recorded first address', () => {
    for (const wallet of fleet.wallets) {
      const { type, fingerprint, path, xpub } = parse(wallet.descriptor);
      const mnemonic = demo.testVectorMnemonics[fingerprint];
      expect(mnemonic, `${wallet.name} uses a non-test-vector key`).toBeDefined();
      expect(rootFor(mnemonic).derivePath(`m${path.replaceAll('h', "'")}`).neutered().toBase58()).toBe(xpub);
      expect(firstAddress(type, xpub)).toBe(wallet.firstAddress);
    }
  });

  it('never duplicates a fleet or demo wallet (same script type and key origin)', () => {
    const origins = fleet.wallets.map((w) => parse(w.descriptor).origin);
    expect(new Set(origins).size).toBe(origins.length);
    const demoOrigins = demo.wallets
      .map((w) => SINGLE_KEY.exec(w.descriptor))
      .filter(Boolean)
      .map((m) => `${m![1]}:${m![2]}${m![3]}`);
    for (const origin of origins) expect(demoOrigins).not.toContain(origin);
  });

  it('pins the published BIP44/BIP49/BIP86 first addresses of abandon...about', () => {
    const byOrigin = new Map(fleet.wallets.map((w) => [parse(w.descriptor).origin, w.firstAddress]));
    expect(byOrigin.get("pkh:73c5da0a/44h/0h/0h")).toBe('1LqBGSKuX5yYUonjxT5qGfpUsXKYYWeabA');
    expect(byOrigin.get('sh(wpkh:73c5da0a/49h/0h/0h')).toBe('37VucYSaXLCAsxYyAPfbSi9eh4iEcbShgf');
    expect(byOrigin.get('tr:73c5da0a/86h/0h/0h')).toBe('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  });
});
