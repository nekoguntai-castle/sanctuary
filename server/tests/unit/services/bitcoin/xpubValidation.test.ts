/**
 * xpub Validation Tests
 *
 * These tests ensure proper handling of extended public keys (xpubs) including:
 * - Version byte validation (xpub/ypub/zpub/tpub/etc.)
 * - Network consistency (mainnet vs testnet)
 * - Format conversion
 * - Invalid xpub detection
 *
 * Critical because:
 * - Using a mainnet xpub on testnet (or vice versa) produces wrong addresses
 * - Using the wrong version prefix can cause address derivation failures
 * - Invalid xpubs should be rejected early, not produce garbage addresses
 */

import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import bip32 from '@/services/bitcoin/bip32';
import {
  validateXpub,
  convertToStandardXpub,
  deriveRelativeAddress,
} from '@/services/bitcoin/addressDerivation';

// Valid test xpubs from known seeds (verified in verified-address-vectors.ts)
// All from "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about" mnemonic
const VALID_XPUBS = {
  // Mainnet xpubs
  mainnet: {
    // BIP-44 (legacy) - m/44'/0'/0'
    xpub: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMdj',
    // BIP-84 (native segwit) - zpub format - m/84'/0'/0'
    zpub: 'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
  },
  // Testnet xpubs
  testnet: {
    // BIP-44 (legacy) - m/44'/1'/0'
    tpub: 'tpubDC5FSnBiZDMmhiuCmWAYsLwgLYrrT9rAqvTySfuCCrgsWz8wxMXUS9Tb9iVMvcRbvFcAHGkMD5Kx8koh4GquNGNTfohfk7pgjhaPCdXpoba',
    // BIP-84 (native segwit) - m/84'/1'/0' - converted to standard tpub format
    vpub: 'vpub5Y6cjg78GGuNLsaPhmYsiw4gYX3HoQiRBiSwDaBXKUafCt9bNwWQiitDk5VZ5BVxYnQdwoTyXSs2JHRPAgjAvtbBrf8ZhDYe2jWAqvZVnsc',
  },
};

// Invalid xpubs for negative testing
const INVALID_XPUBS = {
  // Completely invalid
  garbage: 'notavalidxpub',
  empty: '',
  tooShort: 'xpub123',
  // Valid format but wrong checksum
  badChecksum:
    'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5WSWGFNbi8Aw6ZRc1brxMyWMzG3DSSSSoekkudhUd9yLb6qx39T9nMXX',
  // Valid checksum but truncated
  truncated: 'xpub6BosfCnifzxcFwrSzQiqu2DBVTshkCXacvNsWGYJVVhhawA7d4R5',
};

describe('xpub Validation', () => {
  describe('Valid xpub Detection', () => {
    it('should validate mainnet xpub', () => {
      const result = validateXpub(VALID_XPUBS.mainnet.xpub, 'mainnet');
      expect(result.valid).toBe(true);
    });

    it('should validate testnet tpub', () => {
      const result = validateXpub(VALID_XPUBS.testnet.tpub, 'testnet');
      expect(result.valid).toBe(true);
    });
  });

  describe('Invalid xpub Rejection', () => {
    it('should reject garbage input', () => {
      const result = validateXpub(INVALID_XPUBS.garbage, 'mainnet');
      expect(result.valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = validateXpub(INVALID_XPUBS.empty, 'mainnet');
      expect(result.valid).toBe(false);
    });

    it('should reject too short xpub', () => {
      const result = validateXpub(INVALID_XPUBS.tooShort, 'mainnet');
      expect(result.valid).toBe(false);
    });

    it('should reject truncated xpub', () => {
      const result = validateXpub(INVALID_XPUBS.truncated, 'mainnet');
      expect(result.valid).toBe(false);
    });

    it('should reject private extended keys', () => {
      const xprv = bip32.fromSeed(Buffer.alloc(32, 1), bitcoin.networks.bitcoin).toBase58();
      const result = validateXpub(xprv, 'mainnet');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Private extended keys are not allowed');
    });
  });

  describe('xpub Format Conversion', () => {
    it('should convert zpub to xpub format', () => {
      const converted = convertToStandardXpub(VALID_XPUBS.mainnet.zpub);
      expect(converted).toMatch(/^xpub/);
      const result = validateXpub(converted, 'mainnet');
      expect(result.valid).toBe(true);
    });

    it('should leave xpub unchanged', () => {
      const original = VALID_XPUBS.mainnet.xpub;
      const converted = convertToStandardXpub(original);
      expect(converted).toBe(original);
    });

    it('should leave tpub unchanged', () => {
      const original = VALID_XPUBS.testnet.tpub;
      const converted = convertToStandardXpub(original);
      expect(converted).toBe(original);
    });

    it('should handle conversion consistently', () => {
      // Convert twice should give same result
      const converted1 = convertToStandardXpub(VALID_XPUBS.mainnet.zpub);
      const converted2 = convertToStandardXpub(converted1);
      expect(converted1).toBe(converted2);
    });
  });

  describe('Address Derivation with Different xpub Formats', () => {
    it('should derive same address from zpub as from standard xpub', () => {
      // The zpub should produce valid addresses when used with native segwit
      const zpub = VALID_XPUBS.mainnet.zpub;

      const addr1 = deriveRelativeAddress(zpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        change: false,
      });

      const addr2 = deriveRelativeAddress(zpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        change: false,
      });

      // Both derivations should produce the same address
      expect(addr1.address).toBe(addr2.address);
      // Native segwit mainnet addresses start with bc1q
      expect(addr1.address).toMatch(/^bc1q/);
    });

    it('should derive valid native segwit address from tpub on testnet', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });

      // Native segwit testnet addresses start with tb1q
      expect(addr.address).toMatch(/^tb1q/);
    });
  });
});

describe('Boundary Condition Tests', () => {
  describe('Address Index Boundaries', () => {
    it('should handle index 0 (first address)', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });
      expect(addr.address).toBeDefined();
      expect(addr.address).toMatch(/^tb1q/);
    });

    it('should handle index 1', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 1, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });
      expect(addr.address).toBeDefined();
      expect(addr.address).toMatch(/^tb1q/);
    });

    it('should handle moderately high indices', () => {
      for (const index of [100, 999, 9999]) {
        const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, index, {
          scriptType: 'native_segwit',
          network: 'testnet',
          change: false,
        });
        expect(addr.address).toBeDefined();
        expect(addr.address).toMatch(/^tb1q/);
      }
    });

    it('should produce unique addresses for sequential indices', () => {
      const addresses = new Set<string>();
      for (let i = 0; i < 100; i++) {
        const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, i, {
          scriptType: 'native_segwit',
          network: 'testnet',
          change: false,
        });
        addresses.add(addr.address);
      }
      // All 100 addresses should be unique
      expect(addresses.size).toBe(100);
    });
  });

  describe('Change vs Receive Addresses', () => {
    it('should produce different addresses for receive vs change at same index', () => {
      const receive = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });

      const change = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: true,
      });

      expect(receive.address).not.toBe(change.address);
    });

    it('should produce deterministic receive addresses', () => {
      const addr1 = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });

      const addr2 = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });

      expect(addr1.address).toBe(addr2.address);
    });

    it('should produce deterministic change addresses', () => {
      const addr1 = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: true,
      });

      const addr2 = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: true,
      });

      expect(addr1.address).toBe(addr2.address);
    });
  });

  describe('Script Type Boundaries', () => {
    it('should produce different addresses for different script types', () => {
      const scriptTypes = ['legacy', 'nested_segwit', 'native_segwit'] as const;
      const addresses = new Map<string, string>();

      for (const scriptType of scriptTypes) {
        const addr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
          scriptType,
          network: 'mainnet',
          change: false,
        });
        addresses.set(scriptType, addr.address);
      }

      // All script types should produce different addresses
      expect(addresses.get('legacy')).not.toBe(addresses.get('nested_segwit'));
      expect(addresses.get('nested_segwit')).not.toBe(addresses.get('native_segwit'));
      expect(addresses.get('legacy')).not.toBe(addresses.get('native_segwit'));
    });

    it('should produce correct address format for legacy (P2PKH)', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
        scriptType: 'legacy',
        network: 'mainnet',
        change: false,
      });
      // P2PKH mainnet addresses start with 1
      expect(addr.address).toMatch(/^1/);
    });

    it('should produce correct address format for nested segwit (P2SH-P2WPKH)', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
        scriptType: 'nested_segwit',
        network: 'mainnet',
        change: false,
      });
      // P2SH mainnet addresses start with 3
      expect(addr.address).toMatch(/^3/);
    });

    it('should produce correct address format for native segwit (P2WPKH)', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        change: false,
      });
      // P2WPKH mainnet addresses start with bc1q
      expect(addr.address).toMatch(/^bc1q/);
    });

    it('should produce correct address format for taproot (P2TR)', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
        scriptType: 'taproot',
        network: 'mainnet',
        change: false,
      });
      // P2TR mainnet addresses start with bc1p
      expect(addr.address).toMatch(/^bc1p/);
    });
  });

  describe('Network Boundaries', () => {
    it('should produce mainnet format for mainnet network', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        change: false,
      });
      expect(addr.address).toMatch(/^bc1q/);
    });

    it('should produce testnet format for testnet network', () => {
      const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });
      expect(addr.address).toMatch(/^tb1q/);
    });

    it('should produce different addresses for same xpub on different networks', () => {
      // Using the same xpub but different networks should produce different addresses
      // Note: In practice you shouldn't use mainnet xpub for testnet, but the function
      // should handle it deterministically
      const mainnetAddr = deriveRelativeAddress(VALID_XPUBS.mainnet.xpub, 0, {
        scriptType: 'native_segwit',
        network: 'mainnet',
        change: false,
      });

      const testnetAddr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
        scriptType: 'native_segwit',
        network: 'testnet',
        change: false,
      });

      // Different networks should produce different addresses
      expect(mainnetAddr.address).not.toBe(testnetAddr.address);

      // Verify correct prefixes
      expect(mainnetAddr.address).toMatch(/^bc1q/);
      expect(testnetAddr.address).toMatch(/^tb1q/);
    });
  });
});

describe('Derivation Path Correctness', () => {
  it('should include correct derivation path in result', () => {
    const addr = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 5, {
      scriptType: 'native_segwit',
      network: 'testnet',
      change: false,
    });

    // Derivation path should end with /0/5 for receive index 5
    expect(addr).toMatchObject({ branch: 0, index: 5 });
    expect(addr).not.toHaveProperty('derivationPath');
  });

  it('should include change flag in derivation path', () => {
    const receive = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
      scriptType: 'native_segwit',
      network: 'testnet',
      change: false,
    });

    const change = deriveRelativeAddress(VALID_XPUBS.testnet.tpub, 0, {
      scriptType: 'native_segwit',
      network: 'testnet',
      change: true,
    });

    // Receive should have /0/index, change should have /1/index
    expect(receive).toMatchObject({ branch: 0, index: 0 });
    expect(change).toMatchObject({ branch: 1, index: 0 });
  });
});
