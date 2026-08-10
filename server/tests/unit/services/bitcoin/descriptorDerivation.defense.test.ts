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
