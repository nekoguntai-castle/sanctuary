import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '../../../../src/services/bitcoin/bip32';
import type { ParsedDescriptor } from '../../../../src/services/bitcoin/addressDerivation';

const parserState = vi.hoisted(() => ({
  parsed: null as ParsedDescriptor | null,
}));

vi.mock('../../../../src/services/bitcoin/addressDerivation/descriptorParser', () => ({
  parseDescriptor: vi.fn(() => parserState.parsed),
}));

import {
  deriveAddressesFromDescriptor,
  deriveAddressFromParsedDescriptor,
  deriveCanonicalAddress,
} from '../../../../src/services/bitcoin/addressDerivation/descriptorDerivation';

const accountXpub = (
  path: string,
  network: bitcoin.Network = bitcoin.networks.testnet,
): string => bip32.fromSeed(Buffer.alloc(32, 71), network)
  .derivePath(path)
  .neutered()
  .toBase58();

const single = (overrides: Partial<ParsedDescriptor> = {}): ParsedDescriptor => ({
  type: 'wpkh',
  xpub: accountXpub("m/84'/1'/0'"),
  path: '0/*',
  fingerprint: 'aabbccdd',
  accountPath: "m/84'/1'/0'",
  ...overrides,
});

const derive = (network: 'mainnet' | 'testnet' = 'testnet') => deriveCanonicalAddress(
  { receiveDescriptor: 'mocked-receive', changeDescriptor: 'mocked-change' },
  { branch: 0, index: 0, network },
);

describe('canonical derivation defense in depth', () => {
  beforeEach(() => {
    parserState.parsed = single();
  });

  it('rejects parser regressions in branch and signer-origin evidence', () => {
    parserState.parsed = single({ path: '7/*' });
    expect(() => derive()).toThrow('Unsupported canonical descriptor suffix');

    parserState.parsed = single({ fingerprint: undefined });
    expect(() => derive()).toThrow('requires signer fingerprint and account origin');

    parserState.parsed = single({ fingerprint: '00000000' });
    expect(() => derive()).toThrow('requires a nonzero signer fingerprint');
  });

  it('binds the declared account origin to wrapper and network policy', () => {
    parserState.parsed = single({ accountPath: "m/84'/1'" });
    expect(() => derive()).toThrow('not an allowed account path');

    parserState.parsed = single({
      accountPath: "m/44'/1'/0'",
      xpub: accountXpub("m/44'/1'/0'"),
    });
    expect(() => derive()).toThrow('wrapper does not match account origin policy');

    parserState.parsed = single({
      accountPath: "m/84'/0'/0'",
      xpub: accountXpub("m/84'/0'/0'", bitcoin.networks.bitcoin),
    });
    expect(() => derive()).toThrow('coin type does not match wallet network');

    parserState.parsed = single({ accountPath: "84'/1'/0'" });
    expect(() => derive()).not.toThrow();
  });

  it('binds xpub serialization depth and child number to the declared origin', () => {
    parserState.parsed = single({
      xpub: bip32.fromSeed(Buffer.alloc(32, 72), bitcoin.networks.testnet)
        .neutered().toBase58(),
    });
    expect(() => derive()).toThrow('depth does not match account origin');

    parserState.parsed = single({
      accountPath: "m/84'/1'/1'",
      xpub: accountXpub("m/84'/1'/0'"),
    });
    expect(() => derive()).toThrow('child number does not match account origin');
  });

  it('rejects mixed fixed branches in a pre-parsed multisig descriptor', () => {
    expect(() => deriveAddressFromParsedDescriptor({
      type: 'wsh-sortedmulti',
      quorum: 1,
      keys: [
        {
          fingerprint: 'aabbccdd',
          accountPath: "m/48'/1'/0'/2'",
          xpub: accountXpub("m/48'/1'/0'/2'"),
          derivationPath: '0/*',
        },
        {
          fingerprint: '11223344',
          accountPath: "m/48'/1'/0'/2'",
          xpub: bip32.fromSeed(Buffer.alloc(32, 73), bitcoin.networks.testnet)
            .derivePath("m/48'/1'/0'/2'").neutered().toBase58(),
          derivationPath: '1/*',
        },
      ],
    }, 0, { network: 'testnet' })).toThrow('one identical fixed branch');
  });
});

const multisigKey = (seedByte: number, derivationPath: string) => ({
  fingerprint: seedByte.toString(16).padStart(8, '0'),
  accountPath: "m/48'/1'/0'/2'",
  xpub: bip32.fromSeed(Buffer.alloc(32, seedByte), bitcoin.networks.testnet)
    .derivePath("m/48'/1'/0'/2'").neutered().toBase58(),
  derivationPath,
});

const multisig = (keys: ParsedDescriptor['keys']): ParsedDescriptor => ({
  type: 'wsh-sortedmulti',
  quorum: 1,
  keys,
});

describe('canonical derivation boundaries, each pinned by its own message', () => {
  beforeEach(() => {
    parserState.parsed = single();
  });

  it('accepts the h hardened marker and reports the apostrophe form', () => {
    parserState.parsed = single({ accountPath: '84h/1H/0h' });

    expect(derive().derivationPath).toBe("m/84'/1'/0'/0/0");
    expect(derive().signerOrigins[0].accountPath).toBe("m/84'/1'/0'");
  });

  it.each([
    ['a ninth leading character', 'zaabbccdd'],
    ['a ninth trailing character', 'aabbccddz'],
    ['ten hex characters', 'aabbccddee'],
    ['seven hex characters', 'aabbccd'],
  ])('rejects a signer fingerprint with %s', (_reason, fingerprint) => {
    parserState.parsed = single({ fingerprint });

    expect(() => derive()).toThrow('requires a nonzero signer fingerprint');
  });

  it('lower-cases an upper-case signer fingerprint', () => {
    parserState.parsed = single({ fingerprint: 'AABBCCDD' });

    expect(derive().signerOrigins[0].fingerprint).toBe('aabbccdd');
  });

  // The canonical entry point names the offending suffix; the pre-parsed entry
  // point has its own check with its own message. Each is asserted by message
  // so neither can stand in for the other.
  it.each(['10/*', '0/*/5', 'x0/*', '0/*x'])(
    'rejects the branch suffix %s at the canonical entry point',
    (path) => {
      parserState.parsed = single({ path });

      expect(() => derive()).toThrow(`Unsupported canonical descriptor suffix: ${path}`);
    },
  );

  it.each(['10/*', '0/*/5', 'x0/*', '0/*x'])(
    'rejects the branch suffix %s in a pre-parsed descriptor',
    (path) => {
      expect(() => deriveAddressFromParsedDescriptor(single({ path }), 0, { network: 'testnet' }))
        .toThrow('Descriptor requires an explicit fixed branch wildcard');
    },
  );

  it.each([
    ['first', ['0/7/*', '0/*']],
    ['second', ['0/*', '0/7/*']],
  ] as const)('rejects a pre-parsed multisig whose %s signer has a bad suffix', (_which, paths) => {
    const parsed = multisig([multisigKey(73, paths[0]), multisigKey(74, paths[1])]);

    expect(() => deriveAddressFromParsedDescriptor(parsed, 0, { network: 'testnet' }))
      .toThrow('Descriptor requires an explicit fixed branch wildcard');
  });

  it('rejects a pre-parsed multisig with no signers', () => {
    expect(() => deriveAddressFromParsedDescriptor(multisig([]), 0, { network: 'testnet' }))
      .toThrow('Descriptor requires an explicit fixed branch wildcard');
  });

  // These go through the pre-parsed entry point, which has no earlier caller
  // to check the key bindings for it.
  it('binds a pre-parsed single-sig key to the wallet network', () => {
    const parsed = single({
      accountPath: "m/84'/0'/0'",
      xpub: accountXpub("m/84'/0'/0'", bitcoin.networks.bitcoin),
    });

    expect(() => deriveAddressFromParsedDescriptor(parsed, 0, { network: 'testnet' }))
      .toThrow('coin type does not match wallet network');
  });

  it('binds every pre-parsed multisig key to its declared origin', () => {
    const wrongDepth = {
      ...multisigKey(74, '0/*'),
      xpub: bip32.fromSeed(Buffer.alloc(32, 74), bitcoin.networks.testnet).neutered().toBase58(),
    };
    const parsed = multisig([multisigKey(73, '0/*'), wrongDepth]);

    expect(() => deriveAddressFromParsedDescriptor(parsed, 0, { network: 'testnet' }))
      .toThrow('depth does not match account origin');
    expect(() => deriveAddressFromParsedDescriptor(
      multisig([multisigKey(73, '0/*'), multisigKey(74, '0/*')]), 0, { network: 'testnet' },
    )).not.toThrow();
  });

  // The canonical entry point relies on the pre-parsed one for key bindings.
  it('binds every multisig key at the canonical entry point', () => {
    parserState.parsed = multisig([multisigKey(73, '0/*'), {
      ...multisigKey(74, '0/*'),
      xpub: bip32.fromSeed(Buffer.alloc(32, 74), bitcoin.networks.testnet).neutered().toBase58(),
    }]);
    expect(() => derive()).toThrow('depth does not match account origin');

    parserState.parsed = multisig([multisigKey(73, '0/*'), multisigKey(74, '0/*')]);
    expect(derive().signerOrigins).toHaveLength(2);
  });

  it('refuses a single-sig descriptor without an extended key at the canonical entry point', () => {
    parserState.parsed = single({ xpub: undefined });

    expect(() => derive()).toThrow('No xpub found in descriptor');
  });

  it('refuses a missing network instead of treating it as mainnet', () => {
    parserState.parsed = single({
      accountPath: "m/84'/0'/0'",
      xpub: accountXpub("m/84'/0'/0'", bitcoin.networks.bitcoin),
    });

    // null, not undefined: undefined would select the helper's default network.
    expect(() => derive(null as never)).toThrow('Unsupported network');
    expect(() => derive('mainnet')).not.toThrow();
  });

  it('derives a batch of exactly the maximum size and refuses one more', () => {
    const batch = deriveAddressesFromDescriptor('mocked', 0, 1000, { network: 'testnet' });

    expect(batch).toHaveLength(1000);
    expect(batch[999].index).toBe(999);
    expect(new Set(batch.map(({ address }) => address)).size).toBe(1000);
    expect(() => deriveAddressesFromDescriptor('mocked', 0, 1001, { network: 'testnet' }))
      .toThrow('Address derivation batch exceeds 1000 entries');
  });
});
