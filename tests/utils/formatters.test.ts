/**
 * Formatters Utility Tests
 *
 * Tests for UI formatting utilities like address truncation.
 */

import { describe,expect,it } from 'vitest';
import { truncateAddress } from '../../src/utils/formatters';

describe('Formatters', () => {
  describe('truncateAddress', () => {
    it('should truncate a long address with default lengths', () => {
      const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
      const result = truncateAddress(address);

      // Default: 10 chars prefix + ... + 8 chars suffix
      expect(result).toBe('bc1qxy2kgd...fjhx0wlh');
      expect(result.length).toBeLessThan(address.length);
    });

    it('should return full address if shorter than prefix + suffix', () => {
      const shortAddress = 'bc1qshort';
      const result = truncateAddress(shortAddress);

      expect(result).toBe(shortAddress);
    });

    it('should return full address if equal to prefix + suffix length', () => {
      const exactAddress = 'bc1qxy2kgdygjrsqtz'; // 18 chars = 10 + 8 (not truncated)
      const result = truncateAddress(exactAddress);

      expect(result).toBe(exactAddress);
    });

    it('should use custom prefix length', () => {
      const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
      const result = truncateAddress(address, 6, 8);

      expect(result).toBe('bc1qxy...fjhx0wlh');
    });

    it('should use custom suffix length', () => {
      const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
      const result = truncateAddress(address, 10, 4);

      expect(result).toBe('bc1qxy2kgd...0wlh');
    });

    it('should handle empty string', () => {
      const result = truncateAddress('');

      expect(result).toBe('');
    });

    it('should handle null/undefined gracefully', () => {
      // TypeScript would catch this, but runtime safety matters
      const result = truncateAddress(null as unknown as string);

      expect(result).toBeNull();
    });

    it('should work with legacy P2PKH addresses', () => {
      const address = '1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa';
      const result = truncateAddress(address);

      expect(result).toBe('1A1zP1eP5Q...v7DivfNa');
    });

    it('should work with P2SH addresses', () => {
      const address = '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy';
      const result = truncateAddress(address);

      expect(result).toBe('3J98t1WpEZ...nqRhWNLy');
    });

    it('should work with taproot addresses', () => {
      const address = 'bc1p5d7rjq7g6rdk2yhzks9smlaqtedr4dekq08ge8ztwac72sfr9rusxg3297';
      const result = truncateAddress(address);

      expect(result).toBe('bc1p5d7rjq...usxg3297');
    });

    it('should work with testnet addresses', () => {
      const address = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
      const result = truncateAddress(address);

      expect(result).toBe('tb1qw508d6...7kxpjzsx');
    });

    it('should preserve case sensitivity', () => {
      const address = 'BC1QXY2KGDYGJRSQTZQ2N0YRF2493P83KKFJHX0WLH';
      const result = truncateAddress(address);

      expect(result).toMatch(/^BC1QXY2KGD\.\.\.[A-Z0-9]{8}$/);
    });

    it('should handle very short prefix and suffix', () => {
      const address = 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh';
      const result = truncateAddress(address, 3, 3);

      expect(result).toBe('bc1...wlh');
    });

    it('should handle prefix longer than address', () => {
      const address = 'bc1qshort';
      const result = truncateAddress(address, 20, 8);

      // Address is shorter than prefix, so return full address
      expect(result).toBe(address);
    });
  });
});
