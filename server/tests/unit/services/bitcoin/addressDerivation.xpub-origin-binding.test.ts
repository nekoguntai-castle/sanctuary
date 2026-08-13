import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import { describe, expect, it } from 'vitest';
import bip32 from '../../../../src/services/bitcoin/bip32';
import { deriveCanonicalAddress } from '../../../../src/services/bitcoin/addressDerivation/descriptorDerivation';

const hardened = (index: number): number => index + 0x80000000;

function accountXpub(
  seedByte: number,
  network: bitcoin.Network,
  path: number[],
): string {
  let node = bip32.fromSeed(Buffer.alloc(32, seedByte), network);
  for (const component of path) node = node.derive(component);
  return node.neutered().toBase58();
}

function singleSigDescriptors(xpub: string, accountPath = "84'/1'/0'") {
  return {
    receiveDescriptor: `wpkh([aabbccdd/${accountPath}]${xpub}/0/*)`,
    changeDescriptor: `wpkh([aabbccdd/${accountPath}]${xpub}/1/*)`,
  };
}

function withZeroParentFingerprint(xpub: string): string {
  const payload = Buffer.from(bs58check.decode(xpub));
  payload.fill(0, 5, 9);
  return bs58check.encode(payload);
}

describe('canonical descriptor xpub/account binding', () => {
  it('accepts a testnet account xpub whose depth and child number match its origin', () => {
    const xpub = accountXpub(
      1,
      bitcoin.networks.testnet,
      [hardened(84), hardened(1), hardened(0)],
    );

    expect(() => deriveCanonicalAddress(
      singleSigDescriptors(xpub),
      { branch: 0, index: 0, network: 'testnet3' },
    )).not.toThrow();
  });

  it('rejects an xpub encoded for the wrong derivation-network family', () => {
    const mainnetXpub = accountXpub(
      2,
      bitcoin.networks.bitcoin,
      [hardened(84), hardened(0), hardened(0)],
    );

    expect(() => deriveCanonicalAddress(
      singleSigDescriptors(mainnetXpub),
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('xpub network does not match derivation path coin type');
  });

  it('rejects an xpub whose decoded depth is shallower than its declared account path', () => {
    const shallowXpub = accountXpub(
      3,
      bitcoin.networks.testnet,
      [hardened(84), hardened(1)],
    );

    expect(() => deriveCanonicalAddress(
      singleSigDescriptors(shallowXpub),
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('Extended public key depth does not match descriptor origin');
  });

  it('rejects an account xpub with missing serialized parent evidence', () => {
    const xpub = accountXpub(
      13,
      bitcoin.networks.testnet,
      [hardened(84), hardened(1), hardened(0)],
    );
    expect(() => deriveCanonicalAddress(
      singleSigDescriptors(withZeroParentFingerprint(xpub)),
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('Extended public key parent fingerprint must be nonzero');
  });

  it('rejects a single-sig xpub whose child number differs from the declared account', () => {
    const wrongAccountXpub = accountXpub(
      4,
      bitcoin.networks.testnet,
      [hardened(84), hardened(1), hardened(1)],
    );

    expect(() => deriveCanonicalAddress(
      singleSigDescriptors(wrongAccountXpub),
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('Extended public key child number does not match descriptor origin');
  });

  it('rejects a descriptor wrapper that contradicts the canonical origin policy', () => {
    const xpub = accountXpub(
      9,
      bitcoin.networks.testnet,
      [hardened(84), hardened(1), hardened(0)],
    );
    const descriptors = {
      receiveDescriptor: `tr([aabbccdd/84'/1'/0']${xpub}/0/*)`,
      changeDescriptor: `tr([aabbccdd/84'/1'/0']${xpub}/1/*)`,
    };

    expect(() => deriveCanonicalAddress(
      descriptors,
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('Descriptor origin is not a canonical account path for its wrapper');
  });

  it('rejects native SegWit wrapping for a BIP86 origin', () => {
    const xpub = accountXpub(11, bitcoin.networks.testnet, [
      hardened(86), hardened(1), hardened(0),
    ]);
    expect(() => deriveCanonicalAddress({
      receiveDescriptor: `wpkh([aabbccdd/86'/1'/0']${xpub}/0/*)`,
      changeDescriptor: `wpkh([aabbccdd/86'/1'/0']${xpub}/1/*)`,
    }, { branch: 0, index: 0, network: 'testnet3' }))
      .toThrow('Descriptor origin is not a canonical account path for its wrapper');
  });

  it.each([
    { wrapper: 'wsh', script: 1, seed: 12 },
    { wrapper: 'sh-wsh', script: 2, seed: 14 },
  ])('rejects $wrapper multisig wrapping for BIP48/$script origins', ({ wrapper, script, seed }) => {
    const first = accountXpub(seed, bitcoin.networks.testnet, [
      hardened(48), hardened(1), hardened(0), hardened(script),
    ]);
    const second = accountXpub(seed + 1, bitcoin.networks.testnet, [
      hardened(48), hardened(1), hardened(0), hardened(script),
    ]);
    const inner = `sortedmulti(2,[aabbccdd/48'/1'/0'/${script}']${first}/0/*,[eeff0011/48'/1'/0'/${script}']${second}/0/*)`;
    const receiveDescriptor = wrapper === 'wsh' ? `wsh(${inner})` : `sh(wsh(${inner}))`;
    expect(() => deriveCanonicalAddress({
      receiveDescriptor,
      changeDescriptor: receiveDescriptor.replaceAll('/0/*', '/1/*'),
    }, { branch: 0, index: 0, network: 'testnet3' }))
      .toThrow('Descriptor origin is not a canonical account path for its wrapper');
  });

  it('rejects a canonical origin coin type that contradicts the wallet network', () => {
    const xpub = accountXpub(
      10,
      bitcoin.networks.testnet,
      [hardened(84), hardened(0), hardened(0)],
    );
    const descriptors = singleSigDescriptors(xpub, "84'/0'/0'");

    expect(() => deriveCanonicalAddress(
      descriptors,
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('xpub network does not match derivation path coin type');
  });

  it('rejects a BIP48 xpub whose child number differs from the declared script component', () => {
    const first = accountXpub(
      5,
      bitcoin.networks.testnet,
      [hardened(48), hardened(1), hardened(0), hardened(1)],
    );
    const second = accountXpub(
      6,
      bitcoin.networks.testnet,
      [hardened(48), hardened(1), hardened(0), hardened(2)],
    );
    const receiveDescriptor = `wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/2']${first}/0/*,[eeff0011/48'/1'/0'/2']${second}/0/*))`;

    expect(() => deriveCanonicalAddress(
      { receiveDescriptor, changeDescriptor: receiveDescriptor.replaceAll('/0/*', '/1/*') },
      { branch: 0, index: 0, network: 'testnet3' },
    )).toThrow('Extended public key child number does not match descriptor origin');
  });

  it('accepts BIP48 nested multisig keys exported at the declared /1 script component', () => {
    const first = accountXpub(
      7,
      bitcoin.networks.testnet,
      [hardened(48), hardened(1), hardened(0), hardened(1)],
    );
    const second = accountXpub(
      8,
      bitcoin.networks.testnet,
      [hardened(48), hardened(1), hardened(0), hardened(1)],
    );
    const receiveDescriptor = `sh(wsh(sortedmulti(2,[aabbccdd/48'/1'/0'/1']${first}/0/*,[eeff0011/48'/1'/0'/1']${second}/0/*)))`;

    const derived = deriveCanonicalAddress(
      { receiveDescriptor, changeDescriptor: receiveDescriptor.replaceAll('/0/*', '/1/*') },
      { branch: 0, index: 0, network: 'testnet3' },
    );
    const publicKeys = [first, second]
      .map((xpub) => bip32.fromBase58(xpub, bitcoin.networks.testnet).derive(0).derive(0).publicKey)
      .sort(Buffer.compare);
    const redeem = bitcoin.payments.p2sh({
      redeem: bitcoin.payments.p2wsh({
        redeem: bitcoin.payments.p2ms({ m: 2, pubkeys: publicKeys, network: bitcoin.networks.testnet }),
        network: bitcoin.networks.testnet,
      }),
      network: bitcoin.networks.testnet,
    });

    expect(redeem.address).toBe('2N37zM2Rvw9dy2XZak4GbVb29nogvtnGA4D');
    expect(derived.address).toBe('2N37zM2Rvw9dy2XZak4GbVb29nogvtnGA4D');
    expect(derived.scriptPubKey).toBe('a9146c52f540602b2d51eb9175c6aafcc4707325ed4487');
  });
});
