/**
 * Shared Bitcoin Utilities Tests
 *
 * Tests for shared bitcoin conversion and formatting functions.
 */
import { describe, it, expect } from 'vitest';
import {
  satsToBTC,
  btcToSats,
  formatSats,
  formatBTC,
  formatBTCFromSats,
  isValidAddressFormat,
  detectAddressType,
  isMainnetAddress,
  isTestnetAddress,
  normalizeDerivationPath,
  formatPathForDescriptor,
  extractChangeAndAddressIndex,
  SATS_PER_BTC,
} from '@shared/utils/bitcoin';

describe('Shared Bitcoin Utilities', () => {
  describe('SATS_PER_BTC constant', () => {
    it('should equal 100 million', () => {
      expect(SATS_PER_BTC).toBe(100_000_000);
    });
  });

  describe('satsToBTC', () => {
    it('should convert whole BTC amounts', () => {
      expect(satsToBTC(100_000_000)).toBe(1);
      expect(satsToBTC(200_000_000)).toBe(2);
    });

    it('should convert fractional BTC amounts', () => {
      expect(satsToBTC(50_000_000)).toBe(0.5);
      expect(satsToBTC(12_500_000)).toBe(0.125);
    });

    it('should convert single satoshi', () => {
      expect(satsToBTC(1)).toBe(0.00000001);
    });

    it('should handle zero', () => {
      expect(satsToBTC(0)).toBe(0);
    });

    it('should handle large amounts', () => {
      expect(satsToBTC(2_100_000_000_000_000)).toBe(21_000_000);
    });
  });

  describe('btcToSats', () => {
    it('should convert whole BTC amounts', () => {
      expect(btcToSats(1)).toBe(100_000_000);
      expect(btcToSats(2)).toBe(200_000_000);
    });

    it('should convert fractional BTC amounts', () => {
      expect(btcToSats(0.5)).toBe(50_000_000);
      expect(btcToSats(0.125)).toBe(12_500_000);
    });

    it('should convert smallest BTC amount', () => {
      expect(btcToSats(0.00000001)).toBe(1);
    });

    it('should handle zero', () => {
      expect(btcToSats(0)).toBe(0);
    });

    it('should round to nearest satoshi', () => {
      expect(btcToSats(0.000000016)).toBe(2);
      expect(btcToSats(0.000000014)).toBe(1);
    });
  });

  describe('formatSats', () => {
    it('should format with thousand separators', () => {
      expect(formatSats(1_000)).toBe('1,000');
      expect(formatSats(1_000_000)).toBe('1,000,000');
      expect(formatSats(100_000_000)).toBe('100,000,000');
    });

    it('should handle small values', () => {
      expect(formatSats(1)).toBe('1');
      expect(formatSats(100)).toBe('100');
    });

    it('should handle zero', () => {
      expect(formatSats(0)).toBe('0');
    });

    it('should respect decimals parameter', () => {
      expect(formatSats(1000, 2)).toBe('1,000.00');
    });
  });

  describe('formatBTC', () => {
    it('should trim trailing zeros by default', () => {
      expect(formatBTC(1.5)).toBe('1.5');
      expect(formatBTC(1.0)).toBe('1');
      expect(formatBTC(0.001)).toBe('0.001');
    });

    it('should preserve trailing zeros when trimZeros is false', () => {
      expect(formatBTC(1.5, 8, false)).toBe('1.50000000');
      expect(formatBTC(1.0, 8, false)).toBe('1.00000000');
    });

    it('should respect decimals parameter', () => {
      expect(formatBTC(1.123456789, 4)).toBe('1.1235');
      expect(formatBTC(1.123456789, 2)).toBe('1.12');
    });

    it('should handle zero', () => {
      expect(formatBTC(0)).toBe('0');
    });
  });

  describe('formatBTCFromSats', () => {
    it('should convert and format', () => {
      expect(formatBTCFromSats(100_000_000)).toBe('1.00000000');
      expect(formatBTCFromSats(50_000_000)).toBe('0.50000000');
    });

    it('should respect decimals parameter', () => {
      expect(formatBTCFromSats(123_456_789, 4)).toBe('1.2346');
    });
  });

  describe('isValidAddressFormat', () => {
    describe('mainnet addresses', () => {
      it('should validate legacy addresses (P2PKH)', () => {
        expect(isValidAddressFormat('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
        expect(isValidAddressFormat('1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toBe(true);
      });

      it('should validate P2SH addresses', () => {
        expect(isValidAddressFormat('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(true);
      });

      it('should validate native SegWit addresses (bc1q)', () => {
        expect(isValidAddressFormat('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
      });

      it('should validate Taproot addresses (bc1p)', () => {
        expect(isValidAddressFormat('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
      });
    });

    describe('testnet addresses', () => {
      it('should validate testnet legacy addresses (m/n)', () => {
        expect(isValidAddressFormat('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(true);
        expect(isValidAddressFormat('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe(true);
      });

      it('should validate testnet P2SH addresses (2)', () => {
        expect(isValidAddressFormat('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(true);
      });

      it('should validate testnet SegWit addresses (tb1)', () => {
        expect(isValidAddressFormat('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
      });
    });

    describe('invalid addresses', () => {
      it('should reject empty string', () => {
        expect(isValidAddressFormat('')).toBe(false);
      });

      it('should reject short addresses', () => {
        expect(isValidAddressFormat('1A1zP1')).toBe(false);
      });

      it('should reject invalid prefixes', () => {
        expect(isValidAddressFormat('5A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
      });

      it('should reject random strings', () => {
        expect(isValidAddressFormat('not-a-bitcoin-address')).toBe(false);
      });

      it('should handle null/undefined', () => {
        expect(isValidAddressFormat(null as any)).toBe(false);
        expect(isValidAddressFormat(undefined as any)).toBe(false);
      });
    });

    describe('whitespace handling', () => {
      it('should trim whitespace', () => {
        expect(isValidAddressFormat('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe(true);
      });
    });
  });

  describe('detectAddressType', () => {
    it('should detect legacy addresses', () => {
      expect(detectAddressType('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe('legacy');
    });

    it('should detect P2SH addresses', () => {
      expect(detectAddressType('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe('p2sh');
    });

    it('should detect native SegWit addresses', () => {
      expect(detectAddressType('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe('native_segwit');
    });

    it('should detect Taproot addresses', () => {
      expect(detectAddressType('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe('taproot');
    });

    it('should detect testnet legacy addresses', () => {
      expect(detectAddressType('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe('testnet_legacy');
      expect(detectAddressType('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe('testnet_legacy');
    });

    it('should detect testnet P2SH addresses', () => {
      expect(detectAddressType('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe('testnet_p2sh');
    });

    it('should detect testnet SegWit addresses', () => {
      expect(detectAddressType('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe('testnet_segwit');
    });

    it('should return null for invalid addresses', () => {
      expect(detectAddressType('invalid')).toBeNull();
      expect(detectAddressType('')).toBeNull();
      expect(detectAddressType(null as any)).toBeNull();
    });

    it('should trim whitespace', () => {
      expect(detectAddressType('  bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4  ')).toBe('native_segwit');
    });
  });

  describe('isMainnetAddress', () => {
    it('should return true for mainnet addresses', () => {
      expect(isMainnetAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(true);
      expect(isMainnetAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(true);
      expect(isMainnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(true);
      expect(isMainnetAddress('bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297')).toBe(true);
    });

    it('should return false for testnet addresses', () => {
      expect(isMainnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(false);
      expect(isMainnetAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(false);
      expect(isMainnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(false);
    });

    it('should return false for invalid addresses', () => {
      expect(isMainnetAddress('invalid')).toBe(false);
      expect(isMainnetAddress('')).toBe(false);
    });
  });

  describe('isTestnetAddress', () => {
    it('should return true for testnet addresses', () => {
      expect(isTestnetAddress('mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn')).toBe(true);
      expect(isTestnetAddress('n1ZCYg9YXtB5XCZazLxSmPDa8iwJRZHhGx')).toBe(true);
      expect(isTestnetAddress('2MzQwSSnBHWHqSAqtTVQ6v47XtaisrJa1Vc')).toBe(true);
      expect(isTestnetAddress('tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx')).toBe(true);
    });

    it('should return false for mainnet addresses', () => {
      expect(isTestnetAddress('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa')).toBe(false);
      expect(isTestnetAddress('3J98t1WpEZ73CNmYviecrnyiWrnqRhWNLy')).toBe(false);
      expect(isTestnetAddress('bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toBe(false);
    });

    it('should return false for invalid addresses', () => {
      expect(isTestnetAddress('invalid')).toBe(false);
      expect(isTestnetAddress('')).toBe(false);
    });
  });

  describe('derivation path helpers', () => {
    it('normalizes derivation path prefixes and hardening notation', () => {
      expect(normalizeDerivationPath("m/48h/0H/0h/2H")).toBe("m/48'/0'/0'/2'");
      expect(normalizeDerivationPath("84h/0H/0h")).toBe("m/84'/0'/0'");
      expect(normalizeDerivationPath("m/84'/0'/0'")).toBe("m/84'/0'/0'");
    });

    it('formats derivation paths for descriptor notation', () => {
      expect(formatPathForDescriptor("m/48'/0'/0'/2'")).toBe('48h/0h/0h/2h');
      expect(formatPathForDescriptor("84'/0'/0'")).toBe('84h/0h/0h');
    });

    it('extracts change/index and falls back to zero when path parts are missing', () => {
      expect(extractChangeAndAddressIndex("m/48'/0'/0'/2'/0/5")).toEqual({
        changeIdx: 0,
        addressIdx: 5,
      });
      expect(extractChangeAndAddressIndex("m/84'/0'/0'/7")).toEqual({
        changeIdx: 0,
        addressIdx: 7,
      });
      expect(extractChangeAndAddressIndex('m/')).toEqual({
        changeIdx: 0,
        addressIdx: 0,
      });
    });
  });
});
