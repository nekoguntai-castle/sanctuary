import { describe, expect, it, vi } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';

import {
  deriveCanonicalAddress,
  deriveAddressFromDescriptor,
} from '../../../../src/services/bitcoin/addressDerivation';
import { deriveAddressFromParsedDescriptor } from
  '../../../../src/services/bitcoin/addressDerivation/descriptorDerivation';
import bip32 from '../../../../src/services/bitcoin/bip32';
import { testXpubs } from '../../../fixtures/bitcoin';
import { VERIFIED_MULTISIG_VECTORS } from '../../../fixtures/verified-address-vectors';

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
      )).toThrow('Descriptor key paths must end');
    });

    it('rejects missing or zero signer fingerprints for canonical writes', () => {
      const bareReceive = `wpkh(${tpub}/0/*)`;
      const bareChange = `wpkh(${tpub}/1/*)`;
      expect(() => deriveCanonicalAddress(
        { receiveDescriptor: bareReceive, changeDescriptor: bareChange },
        { branch: 0, index: 0, network: 'testnet' }
      )).toThrow('Invalid descriptor key expression');

      const zeroReceive = `wpkh([00000000/84'/1'/7']${tpub}/0/*)`;
      const zeroChange = `wpkh([00000000/84'/1'/7']${tpub}/1/*)`;
      expect(() => deriveCanonicalAddress(
        { receiveDescriptor: zeroReceive, changeDescriptor: zeroChange },
        { branch: 0, index: 0, network: 'testnet' }
      )).toThrow('Descriptor fingerprint must be nonzero');
    });

    it('preserves every multisig signer origin in descriptor order', () => {
      const vector = VERIFIED_MULTISIG_VECTORS.find(({ network, scriptType, change }) =>
        network === 'testnet3' && scriptType === 'p2wsh' && !change
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
        network === 'testnet3' && scriptType === 'p2wsh' && !change
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
      )).toThrow('Descriptor key paths must use one identical branch policy');
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
    const receiveDescriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/0/*)`;
    const changeDescriptor = `wpkh([aabbccdd/84'/1'/0']${tpub}/1/*)`;

    const receive = deriveAddressFromDescriptor(receiveDescriptor, 0, {
      network: 'testnet',
      change: false,
    });

    const change = deriveAddressFromDescriptor(changeDescriptor, 0, {
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

  it('rejects a parsed multisig descriptor with no explicit branch evidence', () => {
    expect(() =>
      deriveAddressFromParsedDescriptor(
        { type: 'wsh-sortedmulti', quorum: 1, keys: [] } as any,
        0,
        { network: 'testnet' }
      )
    ).toThrow('Descriptor requires an explicit fixed branch wildcard');
  });

  it('throws when parsed multisig descriptor has no quorum', () => {
    const xpub = VERIFIED_MULTISIG_VECTORS.find(({ network, scriptType }) =>
      network === 'testnet3' && scriptType === 'p2wsh'
    )!.xpubs[0];
    expect(() =>
      deriveAddressFromParsedDescriptor(
        {
          type: 'wsh-sortedmulti',
          keys: [{
            fingerprint: 'aabbccdd',
            accountPath: "48'/1'/0'/2'",
            xpub,
            derivationPath: '0/*',
          }],
        } as any,
        0,
        { network: 'testnet' }
      )
    ).toThrow('No quorum found in multisig descriptor');
  });

  it('throws when parsed multisig derivation yields no public key', () => {
    const xpub = VERIFIED_MULTISIG_VECTORS.find(({ network, scriptType }) =>
      network === 'testnet3' && scriptType === 'p2wsh'
    )!.xpubs[0];
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
            accountPath: "48'/1'/0'/2'",
            xpub,
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
