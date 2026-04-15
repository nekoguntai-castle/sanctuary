import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { describe, expect, it } from 'vitest';

import {
  deriveAddress,
  deriveAddresses,
  deriveAddressesFromDescriptor,
} from '../../../../src/services/bitcoin/addressDerivation';
import { testXpubs } from '../../../fixtures/bitcoin';

bitcoin.initEccLib(ecc);

describe('Address Derivation Service deriveAddress', () => {
  const testTpub = testXpubs.testnet.bip84;

  describe('Native SegWit (P2WPKH)', () => {
    it('should derive native segwit address at index 0', () => {
      const result = deriveAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });

      expect(result.address).toMatch(/^tb1q[a-z0-9]{38,42}$/);
      expect(result.derivationPath).toContain('/0/0');
      expect(result.publicKey).toBeDefined();
      expect(result.publicKey.length).toBe(33);
    });

    it('should derive different addresses at different indices', () => {
      const addr0 = deriveAddress(testTpub, 0, { network: 'testnet' });
      const addr1 = deriveAddress(testTpub, 1, { network: 'testnet' });
      const addr2 = deriveAddress(testTpub, 2, { network: 'testnet' });

      expect(addr0.address).not.toBe(addr1.address);
      expect(addr1.address).not.toBe(addr2.address);
      expect(addr0.address).not.toBe(addr2.address);
    });

    it('should derive change addresses when change=true', () => {
      const receive = deriveAddress(testTpub, 0, {
        network: 'testnet',
        change: false,
      });
      const change = deriveAddress(testTpub, 0, {
        network: 'testnet',
        change: true,
      });

      expect(receive.address).not.toBe(change.address);
      expect(receive.derivationPath).toContain('/0/');
      expect(change.derivationPath).toContain('/1/');
    });
  });

  describe('Nested SegWit (P2SH-P2WPKH)', () => {
    it('should derive nested segwit address', () => {
      const result = deriveAddress(testTpub, 0, {
        scriptType: 'nested_segwit',
        network: 'testnet',
        change: false,
      });

      expect(result.address).toMatch(/^2[a-zA-Z0-9]{33,34}$/);
    });
  });

  describe('Legacy (P2PKH)', () => {
    it('should derive legacy address', () => {
      const result = deriveAddress(testTpub, 0, {
        scriptType: 'legacy',
        network: 'testnet',
        change: false,
      });

      expect(result.address).toMatch(/^[mn][a-zA-Z0-9]{25,34}$/);
    });
  });

  describe('Taproot (P2TR)', () => {
    it('should derive taproot address for testnet', () => {
      const result = deriveAddress(testTpub, 0, {
        scriptType: 'taproot',
        network: 'testnet',
        change: false,
      });

      expect(result.address).toMatch(/^tb1p[a-z0-9]{58}$/);
      expect(result.derivationPath).toContain('/0/0');
      expect(result.publicKey).toBeDefined();
    });

    it('should derive different taproot addresses at different indices', () => {
      const addr0 = deriveAddress(testTpub, 0, { scriptType: 'taproot', network: 'testnet' });
      const addr1 = deriveAddress(testTpub, 1, { scriptType: 'taproot', network: 'testnet' });
      const addr2 = deriveAddress(testTpub, 2, { scriptType: 'taproot', network: 'testnet' });

      expect(addr0.address).not.toBe(addr1.address);
      expect(addr1.address).not.toBe(addr2.address);
      expect(addr0.address).not.toBe(addr2.address);
    });

    it('should derive taproot change addresses', () => {
      const receive = deriveAddress(testTpub, 0, {
        scriptType: 'taproot',
        network: 'testnet',
        change: false,
      });
      const change = deriveAddress(testTpub, 0, {
        scriptType: 'taproot',
        network: 'testnet',
        change: true,
      });

      expect(receive.address).not.toBe(change.address);
      expect(receive.derivationPath).toContain('/0/');
      expect(change.derivationPath).toContain('/1/');
    });

    it('should derive mainnet taproot address', () => {
      const mainnetXpub = testXpubs.mainnet.bip44;
      const result = deriveAddress(mainnetXpub, 0, {
        scriptType: 'taproot',
        network: 'mainnet',
      });

      expect(result.address).toMatch(/^bc1p[a-z0-9]{58}$/);
    });
  });

  describe('Network Handling', () => {
    it('should derive mainnet addresses from mainnet xpub', () => {
      const mainnetXpub = 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj';

      const result = deriveAddress(mainnetXpub, 0, {
        network: 'mainnet',
      });

      expect(result.address).toMatch(/^bc1q[a-z0-9]{38,42}$/);
    });

    it('should handle regtest network', () => {
      const result = deriveAddress(testTpub, 0, {
        network: 'regtest',
      });

      expect(result.address).toMatch(/^bcrt1q[a-z0-9]{38,42}$/);
    });

    it('should throw error for invalid network type', () => {
      expect(() =>
        deriveAddress(testTpub, 0, {
          network: 'invalid' as any,
        })
      ).toThrow(/Unsupported network.*invalid/);
    });

    it('should default to mainnet when network is undefined', () => {
      expect(() =>
        deriveAddress(testTpub, 0, {
          network: undefined as any,
        })
      ).toThrow(/Invalid network version/);
    });
  });

  describe('SLIP-132 Format Conversion', () => {
    it('should handle zpub format (mainnet native segwit)', () => {
      const zpub = testXpubs.mainnet.bip84;
      expect(zpub).toMatch(/^zpub/);

      const result = deriveAddress(zpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
      });

      expect(result.address).toMatch(/^bc1q/);
      expect(result.derivationPath).toBeDefined();
      expect(result.publicKey).toBeDefined();
    });

    it('should derive different addresses from zpub at different indices', () => {
      const zpub = testXpubs.mainnet.bip84;
      const addr0 = deriveAddress(zpub, 0, { network: 'mainnet' });
      const addr1 = deriveAddress(zpub, 1, { network: 'mainnet' });

      expect(addr0.address).not.toBe(addr1.address);
      expect(addr0.address).toMatch(/^bc1q/);
      expect(addr1.address).toMatch(/^bc1q/);
    });

    it('should handle ypub format', () => {
      const ypub = testXpubs.mainnet.bip49;

      const result = deriveAddress(ypub, 0, {
        scriptType: 'nested_segwit',
        network: 'mainnet',
      });

      expect(result.address).toMatch(/^3/);
    });

    it('should handle vpub format (testnet native segwit)', () => {
      const result = deriveAddress(testTpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
      });

      expect(result.address).toMatch(/^tb1q/);
    });
  });
});

describe('Address Derivation Service batch derivation', () => {
  const testTpub = testXpubs.testnet.bip84;

  it('should derive multiple addresses at once', () => {
    const results = deriveAddresses(testTpub, 0, 5, {
      network: 'testnet',
    });

    expect(results.length).toBe(5);

    const addresses = results.map((r) => r.address);
    const unique = new Set(addresses);
    expect(unique.size).toBe(5);
    expect(results[0].index).toBe(0);
    expect(results[4].index).toBe(4);
  });

  it('should start from specified index', () => {
    const results = deriveAddresses(testTpub, 10, 3, {
      network: 'testnet',
    });

    expect(results.length).toBe(3);
    expect(results[0].index).toBe(10);
    expect(results[1].index).toBe(11);
    expect(results[2].index).toBe(12);
  });

  it('should derive change addresses in batch', () => {
    const receive = deriveAddresses(testTpub, 0, 3, {
      network: 'testnet',
      change: false,
    });
    const change = deriveAddresses(testTpub, 0, 3, {
      network: 'testnet',
      change: true,
    });

    const receiveSet = new Set(receive.map((r) => r.address));
    const hasOverlap = change.some((c) => receiveSet.has(c.address));
    expect(hasOverlap).toBe(false);
  });

  it('should derive multiple addresses from descriptor', () => {
    const descriptor = `wpkh([aabbccdd/84'/1'/0']${testTpub}/0/*)`;

    const results = deriveAddressesFromDescriptor(descriptor, 0, 5, {
      network: 'testnet',
    });

    expect(results.length).toBe(5);

    results.forEach((r, i) => {
      expect(r.address).toMatch(/^tb1q/);
      expect(r.index).toBe(i);
    });
  });
});

describe('Address Derivation Service determinism', () => {
  const testTpub = testXpubs.testnet.bip84;

  it('should produce same address for same inputs', () => {
    const addr1 = deriveAddress(testTpub, 0, { network: 'testnet' });
    const addr2 = deriveAddress(testTpub, 0, { network: 'testnet' });

    expect(addr1.address).toBe(addr2.address);
    expect(addr1.derivationPath).toBe(addr2.derivationPath);
  });

  it('should produce same public key for same inputs', () => {
    const result1 = deriveAddress(testTpub, 5, { network: 'testnet' });
    const result2 = deriveAddress(testTpub, 5, { network: 'testnet' });

    expect(Buffer.from(result1.publicKey).equals(Buffer.from(result2.publicKey))).toBe(true);
  });
});
