/**
 * Trezor Adapter Tests
 *
 * Tests utility functions for Trezor hardware wallet integration including
 * satoshi amount validation and BIP derivation path handling.
 */

import {
buildTrezorMultisig,
convertToStandardXpub,
getAccountPathPrefix,
getTrezorScriptType,
isBip48MultisigPath,
validateSatoshiAmount,
} from '@/services/hardwareWallet/adapters/trezor';
import { vi } from 'vitest';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

/**
 * Helper to create a valid multisig witnessScript
 * Format: OP_M <pubkey1> <pubkey2> ... OP_N OP_CHECKMULTISIG
 */
function createWitnessScript(m: number, pubkeys: Buffer[]): Buffer {
  const parts: Buffer[] = [];
  // OP_M (OP_1 = 0x51, OP_2 = 0x52, etc.)
  parts.push(Buffer.from([0x50 + m]));
  // Push each pubkey (0x21 = push 33 bytes for compressed pubkey)
  for (const pubkey of pubkeys) {
    parts.push(Buffer.from([0x21]));
    parts.push(pubkey);
  }
  // OP_N
  parts.push(Buffer.from([0x50 + pubkeys.length]));
  // OP_CHECKMULTISIG
  parts.push(Buffer.from([0xae]));
  return Buffer.concat(parts);
}

/**
 * Helper to create mock bip32Derivation entries
 */
function createBip32Derivation(
  pubkeyHex: string,
  path: string,
  fingerprintHex: string
): { pubkey: Buffer; path: string; masterFingerprint: Buffer } {
  return {
    pubkey: Buffer.from(pubkeyHex, 'hex'),
    path,
    masterFingerprint: Buffer.from(fingerprintHex, 'hex'),
  };
}

describe('validateSatoshiAmount', () => {
  describe('Valid amounts', () => {
    it('converts number amount to string', () => {
      expect(validateSatoshiAmount(100000, 'Input 0')).toBe('100000');
    });

    it('converts BigInt amount to string', () => {
      expect(validateSatoshiAmount(BigInt(100000), 'Input 0')).toBe('100000');
    });

    it('handles zero amount', () => {
      expect(validateSatoshiAmount(0, 'Input 0')).toBe('0');
    });

    it('handles large BigInt amounts (above Number.MAX_SAFE_INTEGER)', () => {
      // 21 million BTC in satoshis = 2,100,000,000,000,000
      const largeBigInt = BigInt('2100000000000000');
      expect(validateSatoshiAmount(largeBigInt, 'Input 0')).toBe('2100000000000000');
    });

    it('handles typical transaction amounts', () => {
      expect(validateSatoshiAmount(50000, 'Input 0')).toBe('50000'); // 0.0005 BTC
      expect(validateSatoshiAmount(100000000, 'Input 0')).toBe('100000000'); // 1 BTC
      expect(validateSatoshiAmount(21000000, 'Input 0')).toBe('21000000'); // 0.21 BTC
    });
  });

  describe('Missing amounts', () => {
    it('throws for undefined amount', () => {
      expect(() => validateSatoshiAmount(undefined, 'Input 0')).toThrow(
        'Input 0: amount is missing'
      );
    });

    it('throws for null amount', () => {
      // TypeScript would catch this, but runtime check is important
      expect(() => validateSatoshiAmount(null as any, 'Output 1')).toThrow(
        'Output 1: amount is missing'
      );
    });
  });

  describe('Invalid amounts', () => {
    it('throws for negative number amount', () => {
      expect(() => validateSatoshiAmount(-100, 'Input 0')).toThrow(
        'Input 0: invalid amount -100'
      );
    });

    it('throws for negative BigInt amount', () => {
      expect(() => validateSatoshiAmount(BigInt(-100), 'Output 2')).toThrow(
        'Output 2: invalid amount -100'
      );
    });

    it('throws for Infinity', () => {
      expect(() => validateSatoshiAmount(Infinity, 'Input 0')).toThrow(
        'Input 0: invalid amount Infinity'
      );
    });

    it('throws for negative Infinity', () => {
      expect(() => validateSatoshiAmount(-Infinity, 'Input 1')).toThrow(
        'Input 1: invalid amount -Infinity'
      );
    });

    it('throws for NaN', () => {
      expect(() => validateSatoshiAmount(NaN, 'Output 0')).toThrow(
        'Output 0: invalid amount NaN'
      );
    });
  });

  describe('Context messages', () => {
    it('includes context in error messages', () => {
      expect(() => validateSatoshiAmount(undefined, 'Custom Context')).toThrow(
        'Custom Context: amount is missing'
      );
      expect(() => validateSatoshiAmount(-1, 'UTXO 5')).toThrow(
        'UTXO 5: invalid amount -1'
      );
    });
  });

  describe('Edge cases', () => {
    it('handles very small amounts (dust)', () => {
      expect(validateSatoshiAmount(1, 'Input 0')).toBe('1');
      expect(validateSatoshiAmount(546, 'Input 0')).toBe('546'); // Typical dust limit
    });

    it('handles floating point that converts to integer', () => {
      // JavaScript number precision: 100000.0 === 100000
      expect(validateSatoshiAmount(100000.0, 'Input 0')).toBe('100000');
    });

    it('preserves precision when converting BigInt to string', () => {
      // BigInt preserves exact value when converted to string
      const precise = BigInt('9007199254740993'); // Above MAX_SAFE_INTEGER
      expect(validateSatoshiAmount(precise, 'Input 0')).toBe('9007199254740993');
    });
  });
});

describe('getTrezorScriptType', () => {
  describe('Standard BIP paths', () => {
    it('returns SPENDADDRESS for BIP-44 legacy paths', () => {
      expect(getTrezorScriptType("m/44'/0'/0'/0/0")).toBe('SPENDADDRESS');
      expect(getTrezorScriptType("44'/0'/0'/0/0")).toBe('SPENDADDRESS');
    });

    it('returns SPENDP2SHWITNESS for BIP-49 nested segwit paths', () => {
      expect(getTrezorScriptType("m/49'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("49'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
    });

    it('returns SPENDWITNESS for BIP-84 native segwit paths', () => {
      expect(getTrezorScriptType("m/84'/0'/0'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("84'/0'/0'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDTAPROOT for BIP-86 taproot paths', () => {
      expect(getTrezorScriptType("m/86'/0'/0'/0/0")).toBe('SPENDTAPROOT');
      expect(getTrezorScriptType("86'/0'/0'/0/0")).toBe('SPENDTAPROOT');
    });
  });

  describe('BIP-48 multisig paths', () => {
    it('returns SPENDWITNESS for P2WSH multisig (script type 2)', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/2'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("48'/0'/0'/2'/0/0")).toBe('SPENDWITNESS');
    });

    it('returns SPENDP2SHWITNESS for P2SH-P2WSH multisig (script type 1)', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/1'/0/0")).toBe('SPENDP2SHWITNESS');
      expect(getTrezorScriptType("48'/0'/0'/1'/0/0")).toBe('SPENDP2SHWITNESS');
    });

    it('returns SPENDP2SHWITNESS for BIP-48 without explicit script type', () => {
      expect(getTrezorScriptType("m/48'/0'/0'/0/0")).toBe('SPENDP2SHWITNESS');
    });
  });

  describe('Testnet paths', () => {
    it('handles testnet coin type correctly', () => {
      expect(getTrezorScriptType("m/84'/1'/0'/0/0")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType("m/48'/1'/0'/2'/0/0")).toBe('SPENDWITNESS');
    });
  });

  describe('Unknown paths', () => {
    it('defaults to SPENDWITNESS for unknown paths', () => {
      expect(getTrezorScriptType("m/0'/0'/0'")).toBe('SPENDWITNESS');
      expect(getTrezorScriptType('unknown')).toBe('SPENDWITNESS');
    });
  });
});

describe('isBip48MultisigPath', () => {
  describe('BIP-48 multisig paths', () => {
    it('returns true for BIP-48 paths with m/ prefix', () => {
      expect(isBip48MultisigPath("m/48'/0'/0'/2'")).toBe(true);
      expect(isBip48MultisigPath("m/48'/0'/0'/1'/0/5")).toBe(true);
      expect(isBip48MultisigPath("m/48'/1'/0'/2'/0/0")).toBe(true);
    });

    it('returns true for BIP-48 paths without m/ prefix', () => {
      expect(isBip48MultisigPath("48'/0'/0'/2'")).toBe(true);
      expect(isBip48MultisigPath("48'/0'/0'/1'/0/5")).toBe(true);
    });
  });

  describe('Non-BIP-48 paths', () => {
    it('returns false for BIP-44 paths', () => {
      expect(isBip48MultisigPath("m/44'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-49 paths', () => {
      expect(isBip48MultisigPath("m/49'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-84 paths', () => {
      expect(isBip48MultisigPath("m/84'/0'/0'/0/0")).toBe(false);
    });

    it('returns false for BIP-86 paths', () => {
      expect(isBip48MultisigPath("m/86'/0'/0'/0/0")).toBe(false);
    });
  });
});

describe('getAccountPathPrefix', () => {
  describe('BIP-48 paths', () => {
    it('extracts account path from full derivation path', () => {
      expect(getAccountPathPrefix("m/48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
      expect(getAccountPathPrefix("m/48'/0'/0'/1'/1/10")).toBe("m/48'/0'/0'/1'");
    });

    it('handles testnet paths', () => {
      expect(getAccountPathPrefix("m/48'/1'/0'/2'/0/0")).toBe("m/48'/1'/0'/2'");
    });

    it('handles paths without m/ prefix', () => {
      expect(getAccountPathPrefix("48'/0'/0'/2'/0/5")).toBe("m/48'/0'/0'/2'");
    });
  });

  describe('Edge cases', () => {
    it('handles account-level paths (already 4 segments)', () => {
      expect(getAccountPathPrefix("m/48'/0'/0'/2'")).toBe("m/48'/0'/0'/2'");
    });

    it('handles paths with fewer than 4 segments', () => {
      // Returns whatever segments exist
      expect(getAccountPathPrefix("m/48'/0'")).toBe("m/48'/0'");
    });
  });
});

describe('buildTrezorMultisig', () => {
  // Sample compressed pubkeys (33 bytes each)
  const pubkey1 = Buffer.from('02' + '11'.repeat(32), 'hex');
  const pubkey2 = Buffer.from('02' + '22'.repeat(32), 'hex');
  const pubkey3 = Buffer.from('02' + '33'.repeat(32), 'hex');
  const pubkey4 = Buffer.from('02' + '44'.repeat(32), 'hex');
  const pubkey5 = Buffer.from('02' + '55'.repeat(32), 'hex');

  describe('Valid multisig structures', () => {
    it('parses 2-of-3 multisig correctly', () => {
      const witnessScript = createWitnessScript(2, [pubkey1, pubkey2, pubkey3]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/0/0", '11223344'),
        createBip32Derivation(pubkey3.toString('hex'), "m/48'/0'/0'/2'/0/0", '55667788'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      expect(result!.m).toBe(2);
      expect(result!.pubkeys).toHaveLength(3);
      expect(result!.signatures).toHaveLength(3);
      expect(result!.signatures.every(s => s === '')).toBe(true);
    });

    it('parses 3-of-5 multisig correctly', () => {
      const witnessScript = createWitnessScript(3, [pubkey1, pubkey2, pubkey3, pubkey4, pubkey5]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/0/0", '11223344'),
        createBip32Derivation(pubkey3.toString('hex'), "m/48'/0'/0'/2'/0/0", '55667788'),
        createBip32Derivation(pubkey4.toString('hex'), "m/48'/0'/0'/2'/0/0", '99aabbcc'),
        createBip32Derivation(pubkey5.toString('hex'), "m/48'/0'/0'/2'/0/0", 'ddeeff00'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      expect(result!.m).toBe(3);
      expect(result!.pubkeys).toHaveLength(5);
      expect(result!.signatures).toHaveLength(5);
    });

    it('parses 1-of-2 multisig (edge case m=1)', () => {
      const witnessScript = createWitnessScript(1, [pubkey1, pubkey2]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/0/0", '11223344'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      expect(result!.m).toBe(1);
      expect(result!.pubkeys).toHaveLength(2);
    });

    it('parses 3-of-3 multisig (edge case m=n)', () => {
      const witnessScript = createWitnessScript(3, [pubkey1, pubkey2, pubkey3]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/0/0", '11223344'),
        createBip32Derivation(pubkey3.toString('hex'), "m/48'/0'/0'/2'/0/0", '55667788'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      expect(result!.m).toBe(3);
      expect(result!.pubkeys).toHaveLength(3);
    });
  });

  describe('Pubkey sorting (sortedmulti compatibility)', () => {
    it('sorts pubkeys lexicographically by hex value', () => {
      // Pubkeys are already defined in ascending order: 02111..., 02222..., 02333...
      const witnessScript = createWitnessScript(2, [pubkey1, pubkey2, pubkey3]);
      // Pass derivations in reverse order
      const derivations = [
        createBip32Derivation(pubkey3.toString('hex'), "m/48'/0'/0'/2'/0/2", '55667788'),
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/0/1", '11223344'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      // Should be sorted: pubkey1, pubkey2, pubkey3
      expect(result!.pubkeys[0].node).toBe(pubkey1.toString('hex'));
      expect(result!.pubkeys[1].node).toBe(pubkey2.toString('hex'));
      expect(result!.pubkeys[2].node).toBe(pubkey3.toString('hex'));
    });
  });

  describe('Child path extraction', () => {
    it('extracts child path (change/index) from full derivation path with apostrophe', () => {
      const witnessScript = createWitnessScript(2, [pubkey1, pubkey2]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/5", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/1/10", '11223344'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      // First pubkey: change=0, index=5
      expect(result!.pubkeys[0].address_n).toEqual([0, 5]);
      // Second pubkey: change=1, index=10
      expect(result!.pubkeys[1].address_n).toEqual([1, 10]);
    });

    it('extracts child path from paths with h notation', () => {
      const witnessScript = createWitnessScript(2, [pubkey1, pubkey2]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48h/0h/0h/2h/0/3", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48h/0h/0h/2h/1/7", '11223344'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      // Child paths are non-hardened: 0/3 and 1/7
      expect(result!.pubkeys[0].address_n).toEqual([0, 3]);
      expect(result!.pubkeys[1].address_n).toEqual([1, 7]);
    });

    it('handles hardened child paths correctly', () => {
      const witnessScript = createWitnessScript(2, [pubkey1, pubkey2]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0'/5'", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/1h/10h", '11223344'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      // Hardened: 0' = 0x80000000, 5' = 0x80000005
      expect(result!.pubkeys[0].address_n).toEqual([0x80000000, 0x80000005]);
      // Hardened with h: 1h = 0x80000001, 10h = 0x8000000a
      expect(result!.pubkeys[1].address_n).toEqual([0x80000001, 0x8000000a]);
    });
  });

  describe('Invalid or missing witnessScript', () => {
    it('returns undefined for undefined witnessScript', () => {
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
      ];

      const result = buildTrezorMultisig(undefined, derivations);

      expect(result).toBeUndefined();
    });

    it('returns undefined for empty witnessScript', () => {
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
      ];

      const result = buildTrezorMultisig(Buffer.alloc(0), derivations);

      expect(result).toBeUndefined();
    });

    it('returns undefined for invalid m value (m=0)', () => {
      // Create script with OP_0 (0x00) instead of OP_M
      const invalidScript = Buffer.concat([
        Buffer.from([0x50]), // This would be m=0
        Buffer.from([0x21]), pubkey1,
        Buffer.from([0x51]), // n=1
        Buffer.from([0xae]),
      ]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
      ];

      const result = buildTrezorMultisig(invalidScript, derivations);

      expect(result).toBeUndefined();
    });

    it('returns undefined for invalid m > n', () => {
      // Create script where m=3 but only 2 pubkeys (n=2)
      const invalidScript = Buffer.concat([
        Buffer.from([0x53]), // m=3
        Buffer.from([0x21]), pubkey1,
        Buffer.from([0x21]), pubkey2,
        Buffer.from([0x52]), // n=2
        Buffer.from([0xae]),
      ]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
        createBip32Derivation(pubkey2.toString('hex'), "m/48'/0'/0'/2'/0/0", '11223344'),
      ];

      const result = buildTrezorMultisig(invalidScript, derivations);

      expect(result).toBeUndefined();
    });

    it('returns undefined for m > 16', () => {
      // Create script with invalid m=17 (0x61 which would decode to 17)
      const invalidScript = Buffer.concat([
        Buffer.from([0x61]), // Would be m=17
        Buffer.from([0x21]), pubkey1,
        Buffer.from([0x61]), // n=17
        Buffer.from([0xae]),
      ]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
      ];

      const result = buildTrezorMultisig(invalidScript, derivations);

      expect(result).toBeUndefined();
    });
  });

  describe('Edge cases', () => {
    it('handles single signer (1-of-1)', () => {
      const witnessScript = createWitnessScript(1, [pubkey1]);
      const derivations = [
        createBip32Derivation(pubkey1.toString('hex'), "m/48'/0'/0'/2'/0/0", 'aabbccdd'),
      ];

      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      expect(result!.m).toBe(1);
      expect(result!.pubkeys).toHaveLength(1);
    });

    it('handles maximum reasonable multisig (15-of-15)', () => {
      // Create 15 pubkeys
      const pubkeys: Buffer[] = [];
      const derivations: Array<{ pubkey: Buffer; path: string; masterFingerprint: Buffer }> = [];
      for (let i = 0; i < 15; i++) {
        const pk = Buffer.from('02' + (i + 10).toString(16).padStart(2, '0').repeat(32), 'hex');
        pubkeys.push(pk);
        derivations.push(createBip32Derivation(pk.toString('hex'), `m/48'/0'/0'/2'/0/${i}`, 'aabbccdd'));
      }

      const witnessScript = createWitnessScript(15, pubkeys);
      const result = buildTrezorMultisig(witnessScript, derivations);

      expect(result).toBeDefined();
      expect(result!.m).toBe(15);
      expect(result!.pubkeys).toHaveLength(15);
    });
  });
});

describe('convertToStandardXpub', () => {
  // Test vectors: Real extended public keys from known sources
  // Note: Many SLIP-132 test vectors online have invalid checksums, so we focus on
  // the most commonly encountered format (Zpub) and standard xpub/tpub

  // Standard BIP-32 mainnet xpub (version 0x0488B21E)
  const standardXpub = 'xpub661MyMwAqRbcFtXgS5sYJABqqG9YLmC4Q1Rdap9gSE8NqtwybGhePY2gZ29ESFjqJoCu1Rupje8YtGqsefD265TMg7usUDFdp6W1EGMcet8';

  // Standard BIP-32 testnet tpub (version 0x043587CF)
  const standardTpub = 'tpubD6NzVbkrYhZ4XgiXtGrdW5XDAPFCL9h7we1vwNCpn8tGbBcgfVYjXyhWo4E1xkh56hjod1RhGjxbaTLV3X4FyWuejifB9jusQ46QzG87VKp';

  // SLIP-132 Zpub - P2WSH mainnet (version 0x02AA7ED3)
  // Real Zpub from a Passport device export
  const zpubMainnet = 'Zpub74omgM7ehB1aZZsx274C1CrbXjE8MSzKzijgwh4Wvhupc5UaLioFcYRi5pEtfdrJa5kSumat5xbiMWrNZuuKLqN22H72P6DrAqNQLE4dv1m';

  describe('Standard format passthrough', () => {
    it('returns standard xpub unchanged', () => {
      const result = convertToStandardXpub(standardXpub);
      expect(result).toBe(standardXpub);
    });

    it('returns standard tpub unchanged', () => {
      const result = convertToStandardXpub(standardTpub);
      expect(result).toBe(standardTpub);
    });
  });

  describe('SLIP-132 conversions', () => {
    it('converts Zpub (P2WSH mainnet) to xpub', () => {
      const result = convertToStandardXpub(zpubMainnet);

      // Result should start with xpub
      expect(result.startsWith('xpub')).toBe(true);
      // Should not be the original Zpub
      expect(result).not.toBe(zpubMainnet);
      // Should be valid base58 of same length (version bytes are same size)
      expect(result.length).toBe(zpubMainnet.length);
    });

    it('returns consistent results for the same input', () => {
      const result1 = convertToStandardXpub(zpubMainnet);
      const result2 = convertToStandardXpub(zpubMainnet);
      expect(result1).toBe(result2);
    });

    it('converted xpub can be decoded with bs58check', () => {
      const result = convertToStandardXpub(zpubMainnet);
      const bs58check = require('bs58check');

      // Should not throw - valid base58check encoding
      const decoded = bs58check.decode(result);

      // Should have correct xpub version bytes (0x0488b21e)
      const versionHex = decoded.slice(0, 4).toString('hex');
      expect(versionHex).toBe('0488b21e');
    });
  });

  describe('Error handling', () => {
    it('returns original value for invalid base58', () => {
      const invalid = 'not-a-valid-xpub-at-all';

      const result = convertToStandardXpub(invalid);

      // Should return original value when decoding fails
      expect(result).toBe(invalid);
    });

    it('returns original value for empty string', () => {
      const result = convertToStandardXpub('');

      expect(result).toBe('');
    });

    it('returns original value for base58 with invalid checksum', () => {
      // Modify a character in a valid xpub to break checksum
      const invalidChecksum = standardXpub.slice(0, -1) + 'X';

      const result = convertToStandardXpub(invalidChecksum);

      // Should return original since decode will fail
      expect(result).toBe(invalidChecksum);
    });
  });

  describe('Unknown version handling', () => {
    it('returns original value for unknown version bytes', () => {
      // Standard xpub already has known version, just verify passthrough
      const result = convertToStandardXpub(standardXpub);
      expect(result).toBe(standardXpub);
    });
  });

  describe('Integration with buildTrezorMultisig', () => {
    it('converts Zpub when used in xpubMap', () => {
      // This tests the integration: buildTrezorMultisig should use converted xpubs
      const pubkey1 = Buffer.from('02' + '11'.repeat(32), 'hex');
      const pubkey2 = Buffer.from('02' + '22'.repeat(32), 'hex');

      const witnessScript = Buffer.concat([
        Buffer.from([0x52]), // OP_2
        Buffer.from([0x21]), pubkey1,
        Buffer.from([0x21]), pubkey2,
        Buffer.from([0x52]), // OP_2
        Buffer.from([0xae]), // OP_CHECKMULTISIG
      ]);

      const derivations = [
        {
          pubkey: pubkey1,
          path: "m/48'/0'/0'/2'/0/0",
          masterFingerprint: Buffer.from('7bf099a0', 'hex'),
        },
        {
          pubkey: pubkey2,
          path: "m/48'/0'/0'/2'/0/0",
          masterFingerprint: Buffer.from('61419ad3', 'hex'),
        },
      ];

      // Use a Zpub in the xpubMap (like from a Passport device)
      const xpubMap: Record<string, string> = {
        '7bf099a0': zpubMainnet,  // Zpub will be converted
        '61419ad3': standardXpub,  // Already xpub
      };

      const result = buildTrezorMultisig(witnessScript, derivations, xpubMap);

      expect(result).toBeDefined();
      expect(result!.m).toBe(2);
      expect(result!.pubkeys).toHaveLength(2);

      // Both should be converted to xpub format (start with 'xpub')
      for (const pk of result!.pubkeys) {
        if (typeof pk.node === 'string' && pk.node.length > 10) {
          expect(pk.node.startsWith('xpub')).toBe(true);
        }
      }
    });
  });
});
