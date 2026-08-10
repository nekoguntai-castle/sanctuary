import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  deriveCanonicalAddress,
  deriveAddressFromDescriptor,
  deriveAddressFromParsedDescriptor,
  parseDescriptor,
} from '../../../../src/services/bitcoin/addressDerivation';
import bip32 from '../../../../src/services/bitcoin/bip32';
import { testXpubs } from '../../../fixtures/bitcoin';
import { VERIFIED_MULTISIG_VECTORS } from '../../../fixtures/verified-address-vectors';

describe('Address Derivation Service descriptor parsing', () => {
  describe('Single-sig Descriptors', () => {
    it('should parse wpkh (native segwit) descriptor', () => {
      const descriptor = 'wpkh([d34db33f/84h/0h/0h]xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('wpkh');
      expect(result.fingerprint).toBe('d34db33f');
      expect(result.xpub).toBeDefined();
      expect(result.path).toBe('0/*');
    });

    it('should parse sh-wpkh (nested segwit) descriptor', () => {
      const descriptor = 'sh(wpkh([aabbccdd/49h/0h/0h]xpub6CUGRUonZSQ4TWtTMmzXdrXDtypWZiD6sBpHwJmENQUMWnrdwJP5EHjDBdJxY8hLhN9P3AyaCANDmrUdDLLY8jSqmqQWmxDPdxiKdE6UkHj/0/*))';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('sh-wpkh');
      expect(result.fingerprint).toBe('aabbccdd');
    });

    it('should parse tr (taproot) descriptor', () => {
      const descriptor = 'tr([eeff0011/86h/0h/0h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*)';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('tr');
      expect(result.fingerprint).toBe('eeff0011');
    });

    it('should parse pkh (legacy) descriptor', () => {
      const descriptor = 'pkh([11223344/44h/0h/0h]xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5/0/*)';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('pkh');
      expect(result.fingerprint).toBe('11223344');
    });
  });

  describe('Multisig Descriptors', () => {
    it('should parse wsh(sortedmulti) descriptor', () => {
      const descriptor = 'wsh(sortedmulti(2,[aabbccdd/84h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvCN/0/*,[eeff0011/84h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvDD/0/*))';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('wsh-sortedmulti');
      expect(result.quorum).toBe(2);
      expect(result.keys?.length).toBe(2);
      expect(result.keys?.[0].fingerprint).toBe('aabbccdd');
      expect(result.keys?.[1].fingerprint).toBe('eeff0011');
    });

    it('should parse sh(wsh(sortedmulti)) descriptor', () => {
      const descriptor = 'sh(wsh(sortedmulti(2,[aabbccdd/49h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvCN/0/*,[eeff0011/49h/1h/0h]tpubDDXfHr8f3LMxNKxfqvjvxH4vDYSvbJQnxZt3qRxfLPJGXMJJgpvZsGJyaZCVQqCLLAKQvHXPF1GYtTNNVZqpZvjxhRAqB4RLmvpH2xHfvDD/0/*)))';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('sh-wsh-sortedmulti');
      expect(result.quorum).toBe(2);
    });

    it('should parse 3-of-5 multisig', () => {
      const descriptor = 'wsh(sortedmulti(3,[a1a1a1a1/84h/0h/0h]xpub1.../0/*,[b2b2b2b2/84h/0h/0h]xpub2.../0/*,[c3c3c3c3/84h/0h/0h]xpub3.../0/*,[d4d4d4d4/84h/0h/0h]xpub4.../0/*,[e5e5e5e5/84h/0h/0h]xpub5.../0/*))';

      const result = parseDescriptor(descriptor);

      expect(result.quorum).toBe(3);
      expect(result.keys?.length).toBe(5);
    });
  });

  describe('Error Cases', () => {
    it('should throw for unsupported descriptor format', () => {
      expect(() => parseDescriptor('wsh(pk([...]xpub...))')).toThrow('Unsupported descriptor format');
    });

    it('should handle descriptor without fingerprint', () => {
      const descriptor = 'wpkh(xpub6ERApfZwUNrhLCkDtcHTcxd75RbzS1ed54G1LkBUHQVHQKqhMkhgbmJbZRkrgZw4koxb5JaHWkY4ALHY2grBGRjaDMzQLcgJvLJuZZvRcEL/0/*)';

      const result = parseDescriptor(descriptor);

      expect(result.type).toBe('wpkh');
      expect(result.xpub).toBeDefined();
      expect(result.fingerprint).toBeUndefined();
    });
  });
});

describe('Address Derivation Service descriptor derivation', () => {
  describe('canonical descriptor-pair coordinates', () => {
    const tpub = bip32.fromSeed(Buffer.alloc(32, 7), bitcoin.networks.testnet)
      .deriveHardened(84)
      .deriveHardened(1)
      .deriveHardened(7)
      .neutered()
      .toBase58();
    const receiveDescriptor = `wpkh([aabbccdd/84'/1'/7']${tpub}/0/*)`;
    const changeDescriptor = `wpkh([aabbccdd/84'/1'/7']${tpub}/1/*)`;

    it('selects the authoritative descriptor and preserves its nonzero account origin', () => {
      const receive = deriveCanonicalAddress(
        { receiveDescriptor, changeDescriptor },
        { branch: 0, index: 3, network: 'testnet' }
      );
      const change = deriveCanonicalAddress(
        { receiveDescriptor, changeDescriptor },
        { branch: 1, index: 3, network: 'testnet' }
      );

      expect(receive.derivationPath).toBe("m/84'/1'/7'/0/3");
      expect(change.derivationPath).toBe("m/84'/1'/7'/1/3");
      expect(receive.address).not.toBe(change.address);
      expect(receive.scriptPubKey).toMatch(/^[0-9a-f]+$/);
      expect(receive.signerOrigins).toEqual([{
        fingerprint: 'aabbccdd',
        accountPath: "m/84'/1'/7'",
        branch: 0,
        index: 3,
      }]);
    });

    it('rejects a selected descriptor whose explicit branch contradicts the coordinate', () => {
      expect(() => deriveCanonicalAddress(
        { receiveDescriptor, changeDescriptor: receiveDescriptor },
        { branch: 1, index: 0, network: 'testnet' }
      )).toThrow('descriptor branch 0 does not match coordinate branch 1');
    });

    it('rejects noncanonical descriptor suffixes instead of interpreting them', () => {
      const fixedChild = `wpkh([aabbccdd/84'/1'/7']${tpub}/0/7)`;

      expect(() => deriveCanonicalAddress(
        { receiveDescriptor: fixedChild, changeDescriptor },
        { branch: 0, index: 0, network: 'testnet' }
      )).toThrow('Unsupported canonical descriptor suffix: 0/7');
    });

    it('rejects missing or zero signer fingerprints for canonical writes', () => {
      const bareReceive = `wpkh(${tpub}/0/*)`;
      const bareChange = `wpkh(${tpub}/1/*)`;
      expect(() => deriveCanonicalAddress(
        { receiveDescriptor: bareReceive, changeDescriptor: bareChange },
        { branch: 0, index: 0, network: 'testnet' }
      )).toThrow('Canonical descriptor requires signer fingerprint and account origin');

      const zeroReceive = `wpkh([00000000/84'/1'/7']${tpub}/0/*)`;
      const zeroChange = `wpkh([00000000/84'/1'/7']${tpub}/1/*)`;
      expect(() => deriveCanonicalAddress(
        { receiveDescriptor: zeroReceive, changeDescriptor: zeroChange },
        { branch: 0, index: 0, network: 'testnet' }
      )).toThrow('Canonical descriptor requires a nonzero signer fingerprint');
    });

    it('preserves every multisig signer origin in descriptor order', () => {
      const vector = VERIFIED_MULTISIG_VECTORS.find(({ network, scriptType, change }) =>
        network === 'testnet' && scriptType === 'p2wsh' && !change
      )!;
      const fingerprints = ['aabbccdd', 'eeff0011', '22334455'];
      const keys = vector.xpubs.slice(0, 3).map((xpub, signerIndex) =>
        `[${fingerprints[signerIndex]}/48'/1'/0'/2']${xpub}/0/*`
      );
      const multisigReceive = `wsh(sortedmulti(2,${keys.join(',')}))`;
      const multisigChange = multisigReceive.replaceAll('/0/*', '/1/*');

      const result = deriveCanonicalAddress(
        { receiveDescriptor: multisigReceive, changeDescriptor: multisigChange },
        { branch: 1, index: 9, network: 'testnet' }
      );

      expect(result.derivationPath).toBe("m/48'/1'/0'/2'/1/9");
      expect(result.signerOrigins).toEqual([
        { fingerprint: 'aabbccdd', accountPath: "m/48'/1'/0'/2'", branch: 1, index: 9 },
        { fingerprint: 'eeff0011', accountPath: "m/48'/1'/0'/2'", branch: 1, index: 9 },
        { fingerprint: '22334455', accountPath: "m/48'/1'/0'/2'", branch: 1, index: 9 },
      ]);
    });

    it('rejects mixed multisig branches instead of overriding one cosigner', () => {
      const vector = VERIFIED_MULTISIG_VECTORS.find(({ network, scriptType, change }) =>
        network === 'testnet' && scriptType === 'p2wsh' && !change
      )!;
      const receive = `wsh(sortedmulti(2,${vector.xpubs.slice(0, 3).map((xpub, signerIndex) =>
        `[${['aabbccdd', 'eeff0011', '22334455'][signerIndex]}/48'/1'/0'/2']${xpub}/0/*`
      ).join(',')}))`;
      const mixedChange = receive
        .replace('/0/*', '/1/*')
        .replace('/0/*', '/1/*');

      expect(() => deriveCanonicalAddress(
        { receiveDescriptor: receive, changeDescriptor: mixedChange },
        { branch: 1, index: 0, network: 'testnet' }
      )).toThrow('descriptor branch 0 does not match coordinate branch 1');
    });

    it.each([
      { branch: -1, index: 0 },
      { branch: 2, index: 0 },
      { branch: 0, index: -1 },
      { branch: 0, index: 0x80000000 },
      { branch: 0, index: 1.5 },
    ])('rejects invalid canonical coordinate $branch/$index', ({ branch, index }) => {
      expect(() => deriveCanonicalAddress(
        { receiveDescriptor, changeDescriptor },
        { branch: branch as 0 | 1, index, network: 'testnet' }
      )).toThrow('Invalid canonical address coordinate');
    });
  });

  it('should derive address from wpkh descriptor', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;

    const result = deriveAddressFromDescriptor(descriptor, 0, {
      network: 'testnet',
    });

    expect(result.address).toMatch(/^tb1q/);
    expect(result.derivationPath).toBeDefined();
  });

  it('should derive address from sh-wpkh descriptor', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `sh(wpkh([aabbccdd/49'/1'/0']${tpub}/0/*))`;

    const result = deriveAddressFromDescriptor(descriptor, 0, {
      network: 'testnet',
    });

    expect(result.address).toMatch(/^2/);
  });

  it('should derive change address from descriptor', () => {
    const tpub = testXpubs.testnet.bip84;
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;

    const receive = deriveAddressFromDescriptor(descriptor, 0, {
      network: 'testnet',
      change: false,
    });

    const change = deriveAddressFromDescriptor(descriptor, 0, {
      network: 'testnet',
      change: true,
    });

    expect(receive.address).not.toBe(change.address);
  });

  it('throws when parsed single-sig descriptor is missing xpub', () => {
    expect(() =>
      deriveAddressFromParsedDescriptor(
        { type: 'wpkh', path: '0/*' } as any,
        0,
        { network: 'testnet' }
      )
    ).toThrow('No xpub found in descriptor');
  });

  it('throws when parsed multisig descriptor has no keys', () => {
    expect(() =>
      deriveAddressFromParsedDescriptor(
        { type: 'wsh-sortedmulti', quorum: 1, keys: [] } as any,
        0,
        { network: 'testnet' }
      )
    ).toThrow('No keys found in multisig descriptor');
  });

  it('throws when parsed multisig descriptor has no quorum', () => {
    expect(() =>
      deriveAddressFromParsedDescriptor(
        {
          type: 'wsh-sortedmulti',
          keys: [{
            fingerprint: 'aabbccdd',
            accountPath: "84'/1'/0'",
            xpub: testXpubs.testnet.bip84,
            derivationPath: '0/*',
          }],
        } as any,
        0,
        { network: 'testnet' }
      )
    ).toThrow('No quorum found in multisig descriptor');
  });

  it('throws when parsed multisig derivation yields no public key', () => {
    const fakeNode: any = {
      publicKey: undefined,
      derive: vi.fn(() => fakeNode),
    };

    expect(() =>
      deriveAddressFromParsedDescriptor(
        {
          type: 'wsh-sortedmulti',
          quorum: 1,
          keys: [{
            fingerprint: 'aabbccdd',
            accountPath: "84'/1'/0'",
            xpub: testXpubs.testnet.bip84,
            derivationPath: '0/*',
          }],
        } as any,
        0,
        { network: 'testnet' },
        { fromBase58: () => fakeNode }
      )
    ).toThrow('Failed to derive public key from xpub');
  });
});
