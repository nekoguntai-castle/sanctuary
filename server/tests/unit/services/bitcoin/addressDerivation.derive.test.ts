import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';

import {
  deriveRelativeAddress,
  deriveRelativeAddresses,
  deriveAddressesFromDescriptor,
} from '../../../../src/services/bitcoin/addressDerivation';
import { testXpubs } from '../../../fixtures/bitcoin';

bitcoin.initEccLib(ecc);

describe('Address Derivation Service deriveRelativeAddress', () => {
  const testTpub = testXpubs.testnet.bip84;

  describe('Native SegWit (P2WPKH)', () => {
    it('should derive native segwit address at index 0', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet3',
        change: false,
      });

      expect(result.address).toMatch(/^tb1q[a-z0-9]{38,42}$/);
      expect(result).toMatchObject({ branch: 0, index: 0 });
      expect(result).not.toHaveProperty('derivationPath');
      expect(result.publicKey).toBeDefined();
      expect(result.publicKey.length).toBe(33);
    });

    it('should derive different addresses at different indices', () => {
      const addr0 = deriveRelativeAddress(testTpub, 0, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });
      const addr1 = deriveRelativeAddress(testTpub, 1, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });
      const addr2 = deriveRelativeAddress(testTpub, 2, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });

      expect(addr0.address).not.toBe(addr1.address);
      expect(addr1.address).not.toBe(addr2.address);
      expect(addr0.address).not.toBe(addr2.address);
    });

    it('should derive change addresses when change=true', () => {
      const receive = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet3',
        change: false,
      });
      const change = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet3',
        change: true,
      });

      expect(receive.address).not.toBe(change.address);
      expect(receive).toMatchObject({ branch: 0, index: 0 });
      expect(change).toMatchObject({ branch: 1, index: 0 });
    });
  });

  describe('Nested SegWit (P2SH-P2WPKH)', () => {
    it('should derive nested segwit address', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'nested_segwit',
        network: 'testnet3',
        change: false,
      });

      expect(result.address).toMatch(/^2[a-zA-Z0-9]{33,34}$/);
    });
  });

  describe('Legacy (P2PKH)', () => {
    it('should derive legacy address', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'legacy',
        network: 'testnet3',
        change: false,
      });

      expect(result.address).toMatch(/^[mn][a-zA-Z0-9]{25,34}$/);
    });
  });

  describe('Taproot (P2TR)', () => {
    it('should derive taproot address for testnet', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'taproot',
        network: 'testnet3',
        change: false,
      });

      expect(result.address).toMatch(/^tb1p[a-z0-9]{58}$/);
      expect(result).toMatchObject({ branch: 0, index: 0 });
      expect(result.publicKey).toBeDefined();
    });

    it('should derive different taproot addresses at different indices', () => {
      const addr0 = deriveRelativeAddress(testTpub, 0, { scriptType: 'taproot', network: 'testnet3', branch: 0 });
      const addr1 = deriveRelativeAddress(testTpub, 1, { scriptType: 'taproot', network: 'testnet3', branch: 0 });
      const addr2 = deriveRelativeAddress(testTpub, 2, { scriptType: 'taproot', network: 'testnet3', branch: 0 });

      expect(addr0.address).not.toBe(addr1.address);
      expect(addr1.address).not.toBe(addr2.address);
      expect(addr0.address).not.toBe(addr2.address);
    });

    it('should derive taproot change addresses', () => {
      const receive = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'taproot',
        network: 'testnet3',
        change: false,
      });
      const change = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'taproot',
        network: 'testnet3',
        change: true,
      });

      expect(receive.address).not.toBe(change.address);
      expect(receive).toMatchObject({ branch: 0, index: 0 });
      expect(change).toMatchObject({ branch: 1, index: 0 });
    });

    it('should derive mainnet taproot address', () => {
      const mainnetXpub = testXpubs.mainnet.bip44;
      const result = deriveRelativeAddress(mainnetXpub, 0, {
        scriptType: 'taproot',
        network: 'mainnet',
        branch: 0,
      });

      expect(result.address).toMatch(/^bc1p[a-z0-9]{58}$/);
    });
  });

  describe('Network Handling', () => {
    it('should derive mainnet addresses from mainnet xpub', () => {
      const mainnetXpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

      const result = deriveRelativeAddress(mainnetXpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        branch: 0,
      });

      expect(result.address).toMatch(/^bc1q[a-z0-9]{38,42}$/);
    });

    it('should handle regtest network', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'regtest',
        branch: 0,
      });

      expect(result.address).toMatch(/^bcrt1q[a-z0-9]{38,42}$/);
    });

    it('should handle signet with testnet address parameters and coin type 1 paths', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'signet',
        branch: 0,
      });

      expect(result.address).toMatch(/^tb1q[a-z0-9]{38,42}$/);
      expect(result).toMatchObject({ branch: 0, index: 0 });
    });

    it('should throw error for invalid network type', () => {
      expect(() =>
        deriveRelativeAddress(testTpub, 0, {
          scriptType: 'native_segwit',
          network: 'invalid' as any,
          branch: 0,
        })
      ).toThrow(/Unsupported network.*invalid/);
    });

    it('should reject an omitted network rather than defaulting it', () => {
      expect(() =>
        deriveRelativeAddress(testTpub, 0, {
          scriptType: 'native_segwit',
          network: undefined as any,
          branch: 0,
        })
      ).toThrow(/Unsupported network.*undefined/);
    });
  });

  describe('SLIP-132 Format Conversion', () => {
    it('should handle zpub format (mainnet native segwit)', () => {
      const zpub = testXpubs.mainnet.bip84;
      expect(zpub).toMatch(/^zpub/);

      const result = deriveRelativeAddress(zpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        branch: 0,
      });

      expect(result.address).toMatch(/^bc1q/);
      expect(result).not.toHaveProperty('derivationPath');
      expect(result.publicKey).toBeDefined();
    });

    it('should derive different addresses from zpub at different indices', () => {
      const zpub = testXpubs.mainnet.bip84;
      const addr0 = deriveRelativeAddress(zpub, 0, { scriptType: 'native_segwit', network: 'mainnet', branch: 0 });
      const addr1 = deriveRelativeAddress(zpub, 1, { scriptType: 'native_segwit', network: 'mainnet', branch: 0 });

      expect(addr0.address).not.toBe(addr1.address);
      expect(addr0.address).toMatch(/^bc1q/);
      expect(addr1.address).toMatch(/^bc1q/);
    });

    it('should handle ypub format', () => {
      const ypub = testXpubs.mainnet.bip49;

      const result = deriveRelativeAddress(ypub, 0, {
        scriptType: 'nested_segwit',
        network: 'mainnet',
        branch: 0,
      });

      expect(result.address).toMatch(/^3/);
    });

    it('should handle vpub format (testnet native segwit)', () => {
      const result = deriveRelativeAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet3',
        branch: 0,
      });

      expect(result.address).toMatch(/^tb1q/);
    });
  });
});

describe('Address Derivation Service batch derivation', () => {
  const testTpub = testXpubs.testnet.bip84;

  it('should derive multiple addresses at once', () => {
    const results = deriveRelativeAddresses(testTpub, 0, 5, {
      scriptType: 'native_segwit',
      network: 'testnet3',
      branch: 0,
    });

    expect(results.length).toBe(5);

    const addresses = results.map((r) => r.address);
    const unique = new Set(addresses);
    expect(unique.size).toBe(5);
    expect(results[0].index).toBe(0);
    expect(results[4].index).toBe(4);
  });

  it('should start from specified index', () => {
    const results = deriveRelativeAddresses(testTpub, 10, 3, {
      scriptType: 'native_segwit',
      network: 'testnet3',
      branch: 0,
    });

    expect(results.length).toBe(3);
    expect(results[0].index).toBe(10);
    expect(results[1].index).toBe(11);
    expect(results[2].index).toBe(12);
  });

  it('should derive change addresses in batch', () => {
    const receive = deriveRelativeAddresses(testTpub, 0, 3, {
      scriptType: 'native_segwit',
      network: 'testnet3',
      change: false,
    });
    const change = deriveRelativeAddresses(testTpub, 0, 3, {
      scriptType: 'native_segwit',
      network: 'testnet3',
      change: true,
    });

    const receiveSet = new Set(receive.map((r) => r.address));
    const hasOverlap = change.some((c) => receiveSet.has(c.address));
    expect(hasOverlap).toBe(false);
  });

  it('validates the entire range before deriving its first child', () => {
    expect(() => deriveRelativeAddresses(testTpub, 0x7fffffff, 1, {
      scriptType: 'native_segwit',
      network: 'testnet3',
      branch: 0,
    })).not.toThrow();
    for (const [startIndex, count] of [
      [-1, 1], [0.5, 1], [0, -1], [0, 0.5], [0x7fffffff, 2],
      [Number.NaN, 1], [0, Number.NaN],
    ]) {
      expect(() => deriveRelativeAddresses(testTpub, startIndex, count, {
        scriptType: 'native_segwit',
        network: 'testnet3',
        branch: 0,
      })).toThrow(/derivation range/i);
    }
    expect(() => deriveRelativeAddresses(testTpub, 0, 1001, {
      scriptType: 'native_segwit',
      network: 'testnet3',
      branch: 0,
    })).toThrow(/batch exceeds 1000/i);
  });

  it('should derive multiple addresses from descriptor', () => {
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${testTpub}/0/*)`;

    const results = deriveAddressesFromDescriptor(descriptor, 0, 5, {
      network: 'testnet3',
    });

    expect(results.length).toBe(5);

    results.forEach((r, i) => {
      expect(r.address).toMatch(/^tb1q/);
      expect(r.index).toBe(i);
    });
  });

  it('rejects an overflowing descriptor range before parsing or deriving', () => {
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${testTpub}/0/*)`;
    expect(() => deriveAddressesFromDescriptor(descriptor, 0x7fffffff, 2, {
      network: 'testnet3',
    })).toThrow(/derivation range/i);
    expect(() => deriveAddressesFromDescriptor(descriptor, 0, -1, {
      network: 'testnet3',
    })).toThrow(/derivation range/i);
    expect(() => deriveAddressesFromDescriptor(descriptor, 0, 1001, {
      network: 'testnet3',
    })).toThrow(/batch exceeds 1000/i);
  });

  it('should derive signet addresses from descriptor using testnet address parameters', () => {
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${testTpub}/0/*)`;

    const results = deriveAddressesFromDescriptor(descriptor, 0, 2, {
      network: 'signet',
    });

    expect(results).toHaveLength(2);
    expect(results[0].address).toMatch(/^tb1q/);
    expect(results[0].derivationPath).toBe("m/84'/1'/0'/0/0");
    expect(results[1].index).toBe(1);
  });
});

describe('Address Derivation Service determinism', () => {
  const testTpub = testXpubs.testnet.bip84;

  it('should produce same address for same inputs', () => {
    const addr1 = deriveRelativeAddress(testTpub, 0, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });
    const addr2 = deriveRelativeAddress(testTpub, 0, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });

    expect(addr1.address).toBe(addr2.address);
    expect(addr1).toMatchObject({ branch: addr2.branch, index: addr2.index });
  });

  it('should produce same public key for same inputs', () => {
    const result1 = deriveRelativeAddress(testTpub, 5, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });
    const result2 = deriveRelativeAddress(testTpub, 5, { scriptType: 'native_segwit', network: 'testnet3', branch: 0 });

    expect(Buffer.from(result1.publicKey).equals(Buffer.from(result2.publicKey))).toBe(true);
  });
});
