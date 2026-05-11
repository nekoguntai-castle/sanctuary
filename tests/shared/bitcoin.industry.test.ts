/**
 * Bitcoin Industry Edge Case Tests — Shared Utilities
 *
 * Tests for common Bitcoin implementation pitfalls in value conversion,
 * precision handling, and supply limit enforcement.
 *
 * Covers:
 * - Floating-point precision in sats/BTC conversion
 * - MAX_MONEY (21M BTC) enforcement
 * - Round-trip conversion fidelity
 * - Integer boundary safety
 */

import {
  btcToSats,
  satsToBTC,
  formatBTC,
  formatBTCFromSats,
  formatSats,
  SATS_PER_BTC,
} from '@sanctuary/shared/utils/bitcoin';
import { describe, expect, it } from 'vitest';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum supply in satoshis (21 million BTC) */
const MAX_MONEY_SATS = 2_100_000_000_000_000;
/** Maximum supply in BTC */
const MAX_MONEY_BTC = 21_000_000;
/** JavaScript Number.MAX_SAFE_INTEGER */
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 9007199254740991

describe('Bitcoin Industry Edge Cases — Shared Utilities', () => {
  // ==========================================================================
  // FLOATING-POINT PRECISION
  // ==========================================================================
  describe('Floating-point precision', () => {
    it('should handle the classic 0.1 + 0.2 problem in BTC context', () => {
      // 0.1 BTC + 0.2 BTC should equal exactly 30,000,000 sats
      const a = btcToSats(0.1);
      const b = btcToSats(0.2);
      expect(a + b).toBe(30_000_000);
    });

    it('should handle 0.3 BTC without precision loss', () => {
      // In JS, 0.1 + 0.2 !== 0.3, but btcToSats should handle it
      expect(btcToSats(0.3)).toBe(30_000_000);
    });

    it('should not accumulate rounding errors across multiple conversions', () => {
      // Simulate splitting 1 BTC into 10 equal parts and summing
      const tenthBTC = 0.1;
      let totalSats = 0;
      for (let i = 0; i < 10; i++) {
        totalSats += btcToSats(tenthBTC);
      }
      expect(totalSats).toBe(100_000_000);
    });

    it('should not lose precision with 3 decimal places in BTC', () => {
      // 0.001 BTC = 100,000 sats exactly
      expect(btcToSats(0.001)).toBe(100_000);
      expect(btcToSats(0.999)).toBe(99_900_000);
    });

    it('should handle problematic IEEE 754 values', () => {
      // These values are known to cause precision issues
      expect(btcToSats(0.00000001)).toBe(1); // 1 satoshi
      expect(btcToSats(0.00000002)).toBe(2);
      expect(btcToSats(0.00000003)).toBe(3);
      expect(btcToSats(0.00000007)).toBe(7);
      expect(btcToSats(0.00000009)).toBe(9);
    });

    it('should handle sub-satoshi amounts correctly via rounding', () => {
      // 0.000000005 BTC = 0.5 sats, should round to nearest integer
      expect(btcToSats(0.000000005)).toBe(1); // rounds up
      expect(btcToSats(0.000000004)).toBe(0); // rounds down
    });

    it('should handle BTC amounts with many decimal places', () => {
      // 0.12345678 BTC = 12,345,678 sats
      expect(btcToSats(0.12345678)).toBe(12_345_678);
    });

    it('should handle accumulated rounding in multi-output scenario', () => {
      // Simulate a batch transaction with 100 outputs of 0.00123456 BTC each
      const perOutput = 0.00123456;
      const numOutputs = 100;
      let totalSats = 0;
      for (let i = 0; i < numOutputs; i++) {
        totalSats += btcToSats(perOutput);
      }
      // Expected: 123456 * 100 = 12,345,600
      expect(totalSats).toBe(12_345_600);
    });
  });

  // ==========================================================================
  // ROUND-TRIP CONVERSION FIDELITY
  // ==========================================================================
  describe('Round-trip conversion (sats -> BTC -> sats)', () => {
    it('should preserve value for 1 satoshi', () => {
      expect(btcToSats(satsToBTC(1))).toBe(1);
    });

    it('should preserve value for common amounts', () => {
      const testAmounts = [
        1, 10, 100, 546, 1000, 10_000, 50_000,
        100_000, 1_000_000, 10_000_000, 50_000_000,
        100_000_000, 500_000_000, 1_000_000_000,
      ];

      for (const sats of testAmounts) {
        expect(btcToSats(satsToBTC(sats))).toBe(sats);
      }
    });

    it('should preserve value for dust threshold amounts', () => {
      // Common dust thresholds per script type
      expect(btcToSats(satsToBTC(294))).toBe(294);  // P2WPKH dust
      expect(btcToSats(satsToBTC(330))).toBe(330);  // P2TR dust
      expect(btcToSats(satsToBTC(546))).toBe(546);  // P2PKH dust (common default)
    });

    it('should preserve value at MAX_MONEY boundary', () => {
      expect(btcToSats(satsToBTC(MAX_MONEY_SATS))).toBe(MAX_MONEY_SATS);
    });

    it('should preserve value for all powers of 10 up to MAX_MONEY', () => {
      let amount = 1;
      while (amount <= MAX_MONEY_SATS) {
        expect(btcToSats(satsToBTC(amount))).toBe(amount);
        amount *= 10;
      }
    });
  });

  // ==========================================================================
  // MAX_MONEY (21M BTC) ENFORCEMENT
  // ==========================================================================
  describe('MAX_MONEY (21M BTC cap)', () => {
    it('should correctly convert the total Bitcoin supply', () => {
      expect(satsToBTC(MAX_MONEY_SATS)).toBe(MAX_MONEY_BTC);
      expect(btcToSats(MAX_MONEY_BTC)).toBe(MAX_MONEY_SATS);
    });

    it('should handle amounts just below MAX_MONEY', () => {
      const justBelow = MAX_MONEY_SATS - 1;
      expect(satsToBTC(justBelow)).toBeCloseTo(20_999_999.99999999, 8);
      expect(btcToSats(satsToBTC(justBelow))).toBe(justBelow);
    });

    it('should handle amounts above MAX_MONEY without crashing', () => {
      // While these amounts are impossible on Bitcoin, the functions should
      // not crash or produce NaN — they just convert mathematically
      const overMax = MAX_MONEY_SATS + 1;
      const result = satsToBTC(overMax);
      expect(Number.isFinite(result)).toBe(true);
      expect(result).toBeGreaterThan(MAX_MONEY_BTC);
    });

    it('should not produce NaN or Infinity for extreme amounts', () => {
      expect(satsToBTC(0)).toBe(0);
      expect(satsToBTC(-1)).toBe(-0.00000001);
      expect(Number.isFinite(satsToBTC(MAX_MONEY_SATS * 10))).toBe(true);
    });
  });

  // ==========================================================================
  // INTEGER BOUNDARY SAFETY
  // ==========================================================================
  describe('Integer boundary safety (Number.MAX_SAFE_INTEGER)', () => {
    it('MAX_MONEY_SATS should be within safe integer range', () => {
      expect(MAX_MONEY_SATS).toBeLessThan(MAX_SAFE_INTEGER);
    });

    it('should handle amounts near MAX_SAFE_INTEGER', () => {
      // MAX_SAFE_INTEGER = 9007199254740991
      // In BTC: ~90,071,992.54740991 BTC (way above 21M but tests Number safety)
      const nearMax = MAX_SAFE_INTEGER;
      const btc = satsToBTC(nearMax);
      expect(Number.isFinite(btc)).toBe(true);
      // Round-trip may lose precision here due to JS Number limits
      // This documents the boundary
    });

    it('should maintain precision up to MAX_MONEY range', () => {
      // Every satoshi amount from 0 to MAX_MONEY_SATS should be representable
      // as a JS Number without precision loss. Let's verify critical boundaries.
      const criticalAmounts = [
        MAX_MONEY_SATS,
        MAX_MONEY_SATS - 1,
        MAX_MONEY_SATS + 1,
        // Half of MAX_MONEY
        Math.floor(MAX_MONEY_SATS / 2),
        // Block reward milestones
        50 * SATS_PER_BTC,  // Original block reward
        25 * SATS_PER_BTC,
        12.5 * SATS_PER_BTC,
        6.25 * SATS_PER_BTC,
        3.125 * SATS_PER_BTC,
      ];

      for (const amount of criticalAmounts) {
        const roundTrip = btcToSats(satsToBTC(amount));
        // Within MAX_MONEY, round-trip should be exact
        if (amount <= MAX_MONEY_SATS) {
          expect(roundTrip).toBe(amount);
        }
      }
    });

    it('should handle negative amounts without unexpected behavior', () => {
      // Negative amounts shouldn't crash (they might represent debits in UI)
      expect(satsToBTC(-100_000_000)).toBe(-1);
      expect(btcToSats(-1)).toBe(-100_000_000);
      expect(formatSats(-1000)).toBe('-1,000');
    });
  });

  // ==========================================================================
  // FORMATTING EDGE CASES
  // ==========================================================================
  describe('Formatting edge cases', () => {
    it('should not lose trailing significant digits in BTC formatting', () => {
      // 1 satoshi = 0.00000001 BTC — all 8 decimal places matter
      expect(formatBTCFromSats(1)).toBe('0.00000001');
      expect(formatBTCFromSats(10)).toBe('0.00000010');
      expect(formatBTCFromSats(100)).toBe('0.00000100');
    });

    it('should format dust threshold amounts correctly', () => {
      expect(formatBTCFromSats(546)).toBe('0.00000546');
      expect(formatBTCFromSats(294)).toBe('0.00000294');
    });

    it('should format MAX_MONEY correctly', () => {
      const formatted = formatBTC(MAX_MONEY_BTC, 8, false);
      expect(formatted).toBe('21000000.00000000');
    });

    it('should handle formatBTC trimming correctly for whole numbers', () => {
      expect(formatBTC(1.0)).toBe('1');
      expect(formatBTC(0.0)).toBe('0');
      expect(formatBTC(21000000.0)).toBe('21000000');
    });
  });
});
