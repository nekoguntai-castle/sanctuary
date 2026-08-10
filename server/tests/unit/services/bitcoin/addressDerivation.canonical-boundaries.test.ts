import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/services/bitcoin/addressDerivation/descriptorParser', () => ({
  parseDescriptor: vi.fn((descriptor: string) => {
    if (descriptor === 'missing-multisig-origin') return {
        type: 'wsh-sortedmulti',
        quorum: 1,
        keys: [{
          fingerprint: 'aabbccdd',
          accountPath: undefined,
          xpub: 'unused-canonical-boundary-xpub',
          derivationPath: '0/*',
        }],
      };
    if (descriptor === 'prefixed-origin') return {
      type: 'wpkh',
      xpub: 'invalid-prefixed-origin-xpub',
      fingerprint: 'aabbccdd',
      accountPath: "m/84'/1'/0'",
      path: '0/*',
    };
    return {
        type: 'wpkh',
        xpub: 'unused-canonical-boundary-xpub',
        fingerprint: 'aabbccdd',
        accountPath: "84'/1'/0'",
        path: undefined,
      };
  }),
}));

import { deriveCanonicalAddress } from '../../../../src/services/bitcoin/addressDerivation/descriptorDerivation';

describe('canonical descriptor parser boundary', () => {
  it('fails closed when parsed evidence has no explicit branch wildcard', () => {
    expect(() => deriveCanonicalAddress(
      { receiveDescriptor: 'receive', changeDescriptor: 'change' },
      { branch: 0, index: 0, network: 'testnet' },
    )).toThrow('Canonical descriptor must contain an explicit branch wildcard');
  });

  it('fails closed when a parsed multisig signer has no account origin', () => {
    const derivationNode = {
      publicKey: Buffer.from(
        '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798',
        'hex',
      ),
      derive: vi.fn(),
    };
    derivationNode.derive.mockReturnValue(derivationNode);

    expect(() => deriveCanonicalAddress(
      {
        receiveDescriptor: 'missing-multisig-origin',
        changeDescriptor: 'missing-multisig-origin',
      },
      { branch: 0, index: 0, network: 'testnet' },
      { fromBase58: vi.fn(() => derivationNode) },
    )).toThrow('Canonical descriptor requires an account origin for every signer');
  });

  it('normalizes an already master-prefixed canonical origin before key validation', () => {
    expect(() => deriveCanonicalAddress(
      { receiveDescriptor: 'prefixed-origin', changeDescriptor: 'prefixed-origin' },
      { branch: 0, index: 0, network: 'testnet' },
    )).toThrow('Canonical descriptor extended key is invalid');
  });
});
