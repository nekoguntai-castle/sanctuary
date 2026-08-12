import { BIP32Factory } from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from '@bitcoinerlab/secp256k1';
import { describe, expect, it } from 'vitest';
import {
  assertJadeAccountXpubChain,
  masterFingerprintFromRootXpub,
} from '../../src/services/hardwareWallet/adapters/jadeIdentity';

const bip32 = BIP32Factory(ecc);
const seed = Uint8Array.from(Buffer.alloc(32, 7));

describe('Jade stable identity', () => {
  it.each([
    ['mainnet', bitcoin.networks.bitcoin],
    ['testnet', bitcoin.networks.testnet],
  ] as const)('derives the exact master fingerprint from a transient %s root xpub', (family, network) => {
    const root = bip32.fromSeed(seed, network);
    expect(masterFingerprintFromRootXpub(root.neutered().toBase58(), family))
      .toBe(Buffer.from(root.fingerprint).toString('hex'));
  });

  it('proves every hardened parent from the transient root identity to the requested account', () => {
    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const purpose = root.deriveHardened(84);
    const coin = purpose.deriveHardened(0);
    const account = coin.deriveHardened(7);

    expect(assertJadeAccountXpubChain(
      [purpose.neutered().toBase58(), coin.neutered().toBase58(), account.neutered().toBase58()],
      "m/84'/0'/7'",
      'mainnet',
      Buffer.from(root.fingerprint).toString('hex'),
    )).toBe(account.neutered().toBase58());
  });

  it('rejects a same-depth account xpub substituted from the wrong purpose', () => {
    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const requestedPurpose = root.deriveHardened(86);
    const requestedCoin = requestedPurpose.deriveHardened(0);
    const substitutedAccount = root.deriveHardened(84).deriveHardened(0).deriveHardened(0);

    expect(() => assertJadeAccountXpubChain(
      [
        requestedPurpose.neutered().toBase58(),
        requestedCoin.neutered().toBase58(),
        substitutedAccount.neutered().toBase58(),
      ],
      "m/86'/0'/0'",
      'mainnet',
      Buffer.from(root.fingerprint).toString('hex'),
    )).toThrow(/parent fingerprint/i);
  });

  it('rejects incomplete, malformed-root, and wrong-child ancestry evidence', () => {
    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const purpose = root.deriveHardened(84);
    const coin = purpose.deriveHardened(0);
    const account = coin.deriveHardened(0);
    const chain = [
      purpose.neutered().toBase58(),
      coin.neutered().toBase58(),
      account.neutered().toBase58(),
    ];
    const fingerprint = Buffer.from(root.fingerprint).toString('hex');

    expect(() => assertJadeAccountXpubChain(chain.slice(0, 2), "m/84'/0'/0'", 'mainnet', fingerprint))
      .toThrow(/incomplete/i);
    expect(() => assertJadeAccountXpubChain(chain, "m/84'/0'/0'", 'mainnet', 'not-a-fingerprint'))
      .toThrow(/incomplete/i);
    expect(() => assertJadeAccountXpubChain(
      [coin.neutered().toBase58(), coin.neutered().toBase58(), account.neutered().toBase58()],
      "m/84'/0'/0'",
      'mainnet',
      fingerprint,
    )).toThrow(/depth or child identity/i);
  });

  it('rejects an empty xpub before parsing network metadata', () => {
    expect(() => masterFingerprintFromRootXpub('', 'mainnet')).toThrow(/invalid root xpub/i);
  });

  it('rejects malformed and cross-network root xpubs', () => {
    const mainnetRoot = bip32.fromSeed(seed, bitcoin.networks.bitcoin).neutered().toBase58();

    expect(() => masterFingerprintFromRootXpub('not-an-xpub', 'mainnet'))
      .toThrow(/invalid root xpub for the selected network/i);
    expect(() => masterFingerprintFromRootXpub(mainnetRoot, 'testnet'))
      .toThrow(/invalid root xpub for the selected network/i);
  });

  it.each([
    ['malformed', "m/84'/0'"],
    ['multisig', "m/48'/0'/0'/2'"],
    ['cross-network', "m/84'/1'/0'"],
  ])('rejects a %s account path before accepting ancestry evidence', (_label, path) => {
    const root = bip32.fromSeed(seed, bitcoin.networks.bitcoin);
    const purpose = root.deriveHardened(84);
    const coin = purpose.deriveHardened(0);
    const account = coin.deriveHardened(0);

    expect(() => assertJadeAccountXpubChain(
      [purpose.neutered().toBase58(), coin.neutered().toBase58(), account.neutered().toBase58()],
      path,
      'mainnet',
      Buffer.from(root.fingerprint).toString('hex'),
    )).toThrow(/canonical single-signature path/i);
  });

  it('rejects a non-root xpub as master identity evidence', () => {
    const account = bip32.fromSeed(seed).deriveHardened(84).neutered().toBase58();
    expect(() => masterFingerprintFromRootXpub(account, 'mainnet')).toThrow(/master public key/i);
  });
});
