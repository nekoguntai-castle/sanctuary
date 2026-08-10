/**
 * BIP21 Parser Tests
 *
 * Tests for Bitcoin payment URI parsing according to BIP21 specification.
 * This is security-critical as it handles payment requests.
 */

import { describe,expect,it } from 'vitest';
import { isBip21Uri,parseBip21Uri } from '../../src/utils/bip21Parser';

describe('BIP21 Parser', () => {
  describe('parseBip21Uri', () => {
    describe('basic address parsing', () => {
      it('should parse simple bitcoin URI', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

        expect(result).not.toBeNull();
        expect(result?.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      });

      it('should parse native segwit address', () => {
        const result = parseBip21Uri('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');

        expect(result?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
      });

      it('should parse taproot address', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
        );

        expect(result?.address).toBe(
          'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297'
        );
      });

      it('should parse testnet address', () => {
        const result = parseBip21Uri('bitcoin:tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');

        expect(result?.address).toBe('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx');
      });

      it('should handle uppercase BITCOIN prefix', () => {
        const result = parseBip21Uri('BITCOIN:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

        expect(result).not.toBeNull();
        expect(result?.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      });

      it('should handle mixed case Bitcoin prefix', () => {
        const result = parseBip21Uri('Bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');

        expect(result).not.toBeNull();
      });
    });

    describe('amount parsing', () => {
      it('should parse amount in BTC and convert to satoshis', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=1');

        expect(result?.amount).toBe(100000000); // 1 BTC = 100,000,000 sats
      });

      it('should parse fractional amounts correctly', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.001');

        expect(result?.amount).toBe(100000); // 0.001 BTC = 100,000 sats
      });

      it('should handle precision edge case (0.1 BTC)', () => {
        // This tests floating point precision handling
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.1');

        expect(result?.amount).toBe(10000000); // Exactly 10,000,000 sats
      });

      it('should handle very small amounts', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0.00000001');

        expect(result?.amount).toBe(1); // 1 satoshi
      });

      it('should handle amounts with trailing zeros', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=1.00000000');

        expect(result?.amount).toBe(100000000);
      });

      it('should handle amounts without decimal', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=21');

        expect(result?.amount).toBe(2100000000);
      });

      it('should reject zero amount', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=0');

        expect(result).toBeNull();
      });

      it.each(['0.000000006', '90071992.54740992'])(
        'should reject inexact or unsafe amount %s',
        (amount) => {
          expect(parseBip21Uri(
            `bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=${amount}`,
          )).toBeNull();
        },
      );

      it('should handle whitespace in amount', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount= 0.5 ');

        expect(result?.amount).toBe(50000000);
      });
    });

    describe('payjoin parsing', () => {
      it('should parse payjoin URL', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?pj=https://payjoin.example.com/pj'
        );

        expect(result?.payjoinUrl).toBe('https://payjoin.example.com/pj');
      });

      it('should decode URL-encoded payjoin URL', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?pj=https%3A%2F%2Fpayjoin.example.com%2Fpj'
        );

        expect(result?.payjoinUrl).toBe('https://payjoin.example.com/pj');
      });

      it('decodes an outer-encoded nested URL exactly once', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qrecipient?pj=https%3A%2F%2Fexample.com%2Fpj%3Fnext%3D%252Fcallback'
        );

        expect(result?.payjoinUrl).toBe('https://example.com/pj?next=%2Fcallback');
      });

      it('should parse amount with payjoin', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.1&pj=https://example.com/pj'
        );

        expect(result?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
        expect(result?.amount).toBe(10000000);
        expect(result?.payjoinUrl).toBe('https://example.com/pj');
      });
    });

    describe('label and message parsing', () => {
      it('should parse label parameter', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?label=Donation'
        );

        expect(result?.label).toBe('Donation');
      });

      it('should decode URL-encoded label', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?label=My%20Wallet%20Address'
        );

        expect(result?.label).toBe('My Wallet Address');
      });

      it('should parse message parameter', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?message=Payment%20for%20invoice%20123'
        );

        expect(result?.message).toBe('Payment for invoice 123');
      });

      it('should parse all parameters together', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=0.5&label=Shop&message=Order%20456&pj=https://shop.com/pj'
        );

        expect(result?.address).toBe('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
        expect(result?.amount).toBe(50000000);
        expect(result?.label).toBe('Shop');
        expect(result?.message).toBe('Order 456');
        expect(result?.payjoinUrl).toBe('https://shop.com/pj');
      });

      it('preserves an encoded literal percent and decodes UTF-8 once', () => {
        const result = parseBip21Uri(
          'bitcoin:bc1qrecipient?label=Save%2520%25&message=%E2%98%95%20invoice'
        );

        expect(result?.label).toBe('Save%20%');
        expect(result?.message).toBe('☕ invoice');
      });
    });

    describe('edge cases and invalid input', () => {
      it('should return null for non-bitcoin URI', () => {
        expect(parseBip21Uri('https://example.com')).toBeNull();
        expect(parseBip21Uri('ethereum:0x123')).toBeNull();
        expect(parseBip21Uri('lightning:lnbc...')).toBeNull();
      });

      it('should return null for plain address', () => {
        expect(parseBip21Uri('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBeNull();
        expect(parseBip21Uri('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBeNull();
      });

      it('should return null for empty string', () => {
        expect(parseBip21Uri('')).toBeNull();
      });

      it('should handle URI with empty parameters', () => {
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?');

        expect(result).not.toBeNull();
        expect(result?.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
      });

      it('should handle unknown parameters gracefully', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?unknown=value&amount=1'
        );

        expect(result?.address).toBe('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
        expect(result?.amount).toBe(100000000);
        // Unknown params should be ignored, not cause errors
      });

      it.each(['req-extra=value', '%72eq-extra=value'])(
        'rejects unsupported required parameter %s',
        (parameter) => {
          expect(parseBip21Uri(`bitcoin:bc1qrecipient?amount=1&${parameter}`)).toBeNull();
        },
      );

      it.each(['amount=1&amount=2', 'pj=a&pj=b', 'label=a&label=b', 'message=a&message=b'])(
        'rejects duplicate singleton parameters %s',
        (parameters) => {
          expect(parseBip21Uri(`bitcoin:bc1qrecipient?${parameters}`)).toBeNull();
        },
      );

      it.each(['label=100%', 'message=%2', 'pj=%GG'])(
        'rejects malformed percent escape %s',
        (parameter) => {
          expect(parseBip21Uri(`bitcoin:bc1qrecipient?${parameter}`)).toBeNull();
        },
      );

      it('should handle malformed amount gracefully', () => {
        // Leading zeros should be handled
        const result = parseBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?amount=00.5');

        expect(result?.amount).toBe(50000000);
      });

      it('should return null when parameter decoding throws', () => {
        const result = parseBip21Uri(
          'bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa?label=%E0%A4%A'
        );

        expect(result).toBeNull();
      });
    });
  });

  describe('isBip21Uri', () => {
    it('should return true for valid bitcoin URIs', () => {
      expect(isBip21Uri('bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
      expect(isBip21Uri('bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh?amount=1')).toBe(true);
      expect(isBip21Uri('BITCOIN:address')).toBe(true);
      expect(isBip21Uri('Bitcoin:address')).toBe(true);
    });

    it('should return false for non-bitcoin URIs', () => {
      expect(isBip21Uri('https://example.com')).toBe(false);
      expect(isBip21Uri('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
      expect(isBip21Uri('')).toBe(false);
      expect(isBip21Uri('lightning:lnbc...')).toBe(false);
    });

    it('should return false for bitcoin-like but invalid prefix', () => {
      expect(isBip21Uri('bitcoins:address')).toBe(false);
      expect(isBip21Uri('bitcoin-address')).toBe(false);
      expect(isBip21Uri('bitcoinaddress')).toBe(false);
    });
  });
});
