/**
 * Backoff Module Direct Unit Tests
 *
 * Tests the backoff module imported directly (not via barrel)
 * to ensure explicit file-level coverage attribution.
 * Focuses on edge cases not covered by the rateLimit integration tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/config', () => ({
  config: {
    rateLimit: {
      windowMs: 60000,
      maxRequests: 60,
      backoff: {
        baseRetryAfter: 60,
        maxRetryAfter: 3600,
        multiplier: 2,
      },
    },
  },
}));

import {
  backoffTracker,
  calculateBackoff,
  resetBackoff,
  cleanupBackoffTracker,
} from '../../../src/middleware/rateLimit/backoff';

describe('Backoff Module (direct)', () => {
  beforeEach(() => {
    backoffTracker.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('calculateBackoff edge cases', () => {
    it('should return integer values (Math.ceil) for all violation levels', () => {
      for (let i = 0; i < 8; i++) {
        const result = calculateBackoff('ceil-test');
        expect(Number.isInteger(result)).toBe(true);
        vi.advanceTimersByTime(100);
      }
    });

    it('should handle rapid successive violations without exceeding max', () => {
      // Call 20 times rapidly (no time advancement)
      let lastValue = 0;
      for (let i = 0; i < 20; i++) {
        lastValue = calculateBackoff('rapid-client');
      }
      expect(lastValue).toBeLessThanOrEqual(3600);
      expect(backoffTracker.get('rapid-client')?.violations).toBe(20);
    });

    it('should reset correctly at exact boundary of window + retry period', () => {
      // First violation
      calculateBackoff('boundary-test');

      // Advance exactly to window (60000ms) + 1 violation * baseRetryAfter (60) * 1000ms = 120000ms
      vi.advanceTimersByTime(120000);

      // Should NOT reset (not past, exactly at)
      const result = calculateBackoff('boundary-test');
      // At exactly the boundary, Date.now() - lastViolation === 120000 which is NOT > 120000
      expect(backoffTracker.get('boundary-test')?.violations).toBe(2);
      expect(result).toBe(120);
    });

    it('should reset when 1ms past the boundary', () => {
      calculateBackoff('boundary-test-2');

      // 1ms past the boundary
      vi.advanceTimersByTime(120001);

      const result = calculateBackoff('boundary-test-2');
      expect(backoffTracker.get('boundary-test-2')?.violations).toBe(1);
      expect(result).toBe(60);
    });

    it('should update lastViolation timestamp on each violation', () => {
      calculateBackoff('timestamp-test');
      const first = backoffTracker.get('timestamp-test')?.lastViolation;

      vi.advanceTimersByTime(5000);
      calculateBackoff('timestamp-test');
      const second = backoffTracker.get('timestamp-test')?.lastViolation;

      expect(second).toBeGreaterThan(first!);
      expect(second! - first!).toBe(5000);
    });

    it('should handle second violation with higher reset threshold', () => {
      // First violation
      calculateBackoff('multi-reset');
      vi.advanceTimersByTime(1000);
      // Second violation (violations=2)
      calculateBackoff('multi-reset');

      // Reset requires window(60000) + 2 * 60 * 1000 = 180000ms (strict >)
      vi.advanceTimersByTime(180001);

      const result = calculateBackoff('multi-reset');
      expect(result).toBe(60); // Reset to base
      expect(backoffTracker.get('multi-reset')?.violations).toBe(1);
    });
  });

  describe('resetBackoff', () => {
    it('should allow new backoff to start fresh after reset', () => {
      // Build up violations
      calculateBackoff('reset-fresh');
      vi.advanceTimersByTime(100);
      calculateBackoff('reset-fresh');
      vi.advanceTimersByTime(100);
      calculateBackoff('reset-fresh');
      expect(backoffTracker.get('reset-fresh')?.violations).toBe(3);

      // Reset
      resetBackoff('reset-fresh');
      expect(backoffTracker.has('reset-fresh')).toBe(false);

      // New backoff starts at 1
      const result = calculateBackoff('reset-fresh');
      expect(result).toBe(60);
      expect(backoffTracker.get('reset-fresh')?.violations).toBe(1);
    });
  });

  describe('cleanupBackoffTracker', () => {
    it('should handle entries exactly at the maxAge boundary', () => {
      calculateBackoff('exact-age');
      const maxAge = 120000; // 2 * windowMs

      // Advance exactly to maxAge (not past)
      vi.advanceTimersByTime(maxAge);

      cleanupBackoffTracker();
      // At exactly maxAge: now - lastViolation === maxAge, NOT > maxAge
      expect(backoffTracker.has('exact-age')).toBe(true);
    });

    it('should clean up 1ms past the maxAge boundary', () => {
      calculateBackoff('past-age');

      vi.advanceTimersByTime(120001);

      cleanupBackoffTracker();
      expect(backoffTracker.has('past-age')).toBe(false);
    });

    it('should be safe to call multiple times', () => {
      calculateBackoff('multi-cleanup');
      vi.advanceTimersByTime(130000);

      cleanupBackoffTracker();
      cleanupBackoffTracker();
      cleanupBackoffTracker();

      expect(backoffTracker.size).toBe(0);
    });
  });

  describe('backoffTracker', () => {
    it('should be a Map instance', () => {
      expect(backoffTracker).toBeInstanceOf(Map);
    });

    it('should reflect calculateBackoff mutations', () => {
      expect(backoffTracker.size).toBe(0);
      calculateBackoff('a');
      calculateBackoff('b');
      expect(backoffTracker.size).toBe(2);
      resetBackoff('a');
      expect(backoffTracker.size).toBe(1);
    });
  });
});
