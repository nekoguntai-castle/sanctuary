/**
 * BIP-21 Official Test Vector Verification (URI Scheme)
 *
 * Tests Bitcoin payment URI parsing against the BIP-21 specification:
 * https://github.com/bitcoin/bips/blob/master/bip-0021.mediawiki
 *
 * These vectors verify that:
 * - Standard BIP-21 URIs are correctly parsed
 * - Address, amount, label, and message fields are extracted
 * - Amount conversion from BTC to satoshis is correct
 * - URL-encoded characters are properly decoded
 * - URI generation round-trips correctly
 */

import { describe, it, expect } from 'vitest';
import { parseBip21Uri, generateBip21Uri } from '@/services/payjoin/bip21';
import {
  BIP21_VALID_VECTORS,
  BIP21_EXTENDED_VALID_VECTORS,
  BIP21_AMOUNT_VECTORS,
} from '@fixtures/bip21-test-vectors';

describe('BIP-21 Official Test Vectors', () => {
  describe('Valid BIP-21 URIs from specification', () => {
    BIP21_VALID_VECTORS.forEach((vector) => {
      describe(vector.comment, () => {
        it('should extract correct address', () => {
          const result = parseBip21Uri(vector.uri);
          expect(result.address).toBe(vector.expectedAddress);
        });

        if (vector.expectedAmount !== undefined) {
          it('should extract correct amount (converted to satoshis)', () => {
            const result = parseBip21Uri(vector.uri);
            const expectedSatoshis = Math.round(vector.expectedAmount! * 100000000);
            expect(Math.round(result.amount!)).toBe(expectedSatoshis);
          });
        }

        if (vector.expectedLabel !== undefined) {
          it('should extract correct label', () => {
            const result = parseBip21Uri(vector.uri);
            expect(result.label).toBe(vector.expectedLabel);
          });
        }

        if (vector.expectedMessage !== undefined) {
          it('should extract correct message', () => {
            const result = parseBip21Uri(vector.uri);
            expect(result.message).toBe(vector.expectedMessage);
          });
        }
      });
    });
  });

  describe('Extended valid vectors (SegWit, Taproot, edge cases)', () => {
    BIP21_EXTENDED_VALID_VECTORS.forEach((vector) => {
      it(`should parse: ${vector.comment}`, () => {
        const result = parseBip21Uri(vector.uri);
        expect(result.address).toBe(vector.expectedAddress);

        if (vector.expectedAmount !== undefined) {
          const expectedSatoshis = Math.round(vector.expectedAmount * 100000000);
          expect(Math.round(result.amount!)).toBe(expectedSatoshis);
        }

        if (vector.expectedLabel !== undefined) {
          expect(result.label).toBe(vector.expectedLabel);
        }

        if (vector.expectedMessage !== undefined) {
          expect(result.message).toBe(vector.expectedMessage);
        }
      });
    });
  });

  describe('BTC to satoshi conversion precision', () => {
    BIP21_AMOUNT_VECTORS.forEach((vector) => {
      it(`should correctly convert ${vector.btc} BTC to ${vector.expectedSatoshis} satoshis`, () => {
        const uri = `bitcoin:175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W?amount=${vector.btc}`;
        const result = parseBip21Uri(uri);
        expect(Math.round(result.amount!)).toBe(vector.expectedSatoshis);
      });
    });
  });

  describe('URI generation round-trip', () => {
    it('should generate valid URI with all parameters', () => {
      const uri = generateBip21Uri('175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W', {
        amount: 2030000000, // 20.3 BTC in satoshis
        label: 'Luke-Jr',
        message: 'Donation for project xyz',
      });

      // Parse the generated URI back
      const parsed = parseBip21Uri(uri);
      expect(parsed.address).toBe('175tWpb8K1S7NmH4Zx6rewF9WQrcZv245W');
      expect(parsed.label).toBe('Luke-Jr');
      expect(parsed.message).toBe('Donation for project xyz');
      // Amount should round-trip through BTC conversion
      expect(Math.round(parsed.amount!)).toBe(2030000000);
    });

    it('should generate valid URI with just address', () => {
      const uri = generateBip21Uri('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
      expect(uri).toBe('bitcoin:bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');

      const parsed = parseBip21Uri(uri);
      expect(parsed.address).toBe('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4');
    });

    it('should handle payjoin URL in round-trip', () => {
      const uri = generateBip21Uri('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh', {
        amount: 10000000, // 0.1 BTC
        payjoinUrl: 'https://example.com/pj',
      });

      const parsed = parseBip21Uri(uri);
      expect(parsed.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      expect(parsed.payjoinUrl).toBe('https://example.com/pj');
    });
  });
});
