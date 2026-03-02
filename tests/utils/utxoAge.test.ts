/**
 * Tests for utxoAge utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  calculateUTXOAge,
  getAgeRecommendation,
  getAgeCategoryColor,
  type UTXOAge,
} from '../../utils/utxoAge';

describe('utxoAge utilities', () => {
  describe('calculateUTXOAge', () => {
    const BLOCKS_PER_DAY = 144;

    describe('with confirmations', () => {
      it('calculates age from confirmations correctly', () => {
        const result = calculateUTXOAge({ confirmations: 144 });

        expect(result.days).toBe(1);
        expect(result.displayText).toBe('1 day');
        expect(result.shortText).toBe('1d');
      });

      it('returns Unknown for 0 confirmations without date', () => {
        // 0 confirmations without a date returns Unknown (treated as no data)
        const result = calculateUTXOAge({ confirmations: 0 });

        expect(result.days).toBe(0);
        expect(result.displayText).toBe('Unknown');
        expect(result.shortText).toBe('?');
        expect(result.category).toBe('fresh');
      });

      it('returns fresh category for less than 1 day', () => {
        const result = calculateUTXOAge({ confirmations: 100 });

        // 100 confirmations = ~16.7 hours = 0.69 days
        expect(result.days).toBeGreaterThan(0);
        expect(result.days).toBeLessThan(1);
        expect(result.category).toBe('fresh');
      });

      it('formats sub-hour ages in minutes (singular and plural)', () => {
        const tenMinutes = calculateUTXOAge({ confirmations: 1 });
        expect(tenMinutes.displayText).toBe('10 mins');
        expect(tenMinutes.shortText).toBe('10m');

        const oneMinute = calculateUTXOAge({ confirmations: 0.1 as any });
        expect(oneMinute.displayText).toBe('1 min');
        expect(oneMinute.shortText).toBe('1m');
      });

      it('formats exactly one hour with singular hour text', () => {
        const oneHour = calculateUTXOAge({ confirmations: 6 });
        expect(oneHour.displayText).toBe('1 hour');
        expect(oneHour.shortText).toBe('1h');
      });

      it('returns young category for 1-6 days', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 3 });

        expect(result.days).toBe(3);
        expect(result.category).toBe('young');
      });

      it('returns young category for 7-29 days', () => {
        // Implementation: young = 1-30 days
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 14 });

        expect(result.days).toBe(14);
        expect(result.category).toBe('young');
      });

      it('returns mature category for 30-365 days', () => {
        // Implementation: mature = 30-365 days
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 60 });

        expect(result.days).toBe(60);
        expect(result.category).toBe('mature');
      });

      it('formats plural days correctly', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 5 });

        expect(result.displayText).toBe('5 days');
        expect(result.shortText).toBe('5d');
      });

      it('formats weeks for 7-29 days', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 21 });

        expect(result.days).toBe(21);
        expect(result.displayText).toBe('3 weeks');
        expect(result.shortText).toBe('3w');
      });

      it('formats months for 30+ days', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 90 });

        expect(result.days).toBe(90);
        expect(result.displayText).toBe('3 months');
        expect(result.shortText).toBe('3mo');
      });

      it('formats singular month when rounded month value is below 1.5', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 40 });

        expect(result.days).toBe(40);
        expect(result.displayText).toBe('1 month');
        expect(result.shortText).toBe('1mo');
      });

      it('formats years for 365+ days', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 730 });

        expect(result.days).toBe(730);
        expect(result.displayText).toBe('2 years');
        expect(result.shortText).toBe('2y');
      });

      it('formats singular year when rounded year value is below 1.5', () => {
        const result = calculateUTXOAge({ confirmations: BLOCKS_PER_DAY * 400 });

        expect(result.days).toBe(400);
        expect(result.displayText).toBe('1 year');
        expect(result.shortText).toBe('1y');
      });
    });

    describe('with date', () => {
      const NOW = new Date('2024-06-15T12:00:00Z').getTime();

      beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('calculates age from date string correctly', () => {
        const threeDaysAgo = new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString();
        const result = calculateUTXOAge({ date: threeDaysAgo });

        expect(result.days).toBeCloseTo(3, 0);
        expect(result.category).toBe('young');
      });

      it('handles date provided as numeric timestamp', () => {
        const twoDaysAgoTs = NOW - 2 * 24 * 60 * 60 * 1000;
        const result = calculateUTXOAge({ date: twoDaysAgoTs });
        expect(result.days).toBeCloseTo(2, 0);
      });

      it('handles date as Date object', () => {
        const fiveDaysAgo = new Date(NOW - 5 * 24 * 60 * 60 * 1000);
        const result = calculateUTXOAge({ date: fiveDaysAgo });

        expect(result.days).toBeCloseTo(5, 0);
      });

      it('returns fresh for very recent dates', () => {
        const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000);
        const result = calculateUTXOAge({ date: twoHoursAgo });

        expect(result.days).toBeLessThan(1);
        expect(result.category).toBe('fresh');
      });
    });

    describe('with both confirmations and date', () => {
      it('prefers confirmations over date', () => {
        // 10 days by confirmations
        const result = calculateUTXOAge({
          confirmations: 144 * 10,
          date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
        });

        expect(result.days).toBe(10);
      });
    });

    describe('with neither confirmations nor date', () => {
      it('returns unknown age info', () => {
        const result = calculateUTXOAge({});

        expect(result.days).toBe(0);
        expect(result.displayText).toBe('Unknown');
        expect(result.shortText).toBe('?');
        expect(result.category).toBe('fresh');
      });
    });

    describe('edge cases', () => {
      it('handles negative confirmations', () => {
        const result = calculateUTXOAge({ confirmations: -5 });

        expect(result.days).toBe(0);
        expect(result.category).toBe('fresh');
      });

      it('handles very large confirmation counts', () => {
        const result = calculateUTXOAge({ confirmations: 144 * 365 * 10 }); // 10 years

        expect(result.days).toBe(3650);
        expect(result.displayText).toBe('10 years');
        expect(result.category).toBe('ancient');
      });
    });
  });

  describe('getAgeRecommendation', () => {
    it('returns recommendation for very fresh UTXOs', () => {
      // Only UTXOs with days < 0.1 (< 2.4 hours) get fresh recommendation
      const ageInfo: UTXOAge = {
        days: 0.05,
        displayText: '1 hour',
        shortText: '1h',
        category: 'fresh',
        confirmationsApproximate: 6,
      };

      const recommendation = getAgeRecommendation(ageInfo);

      expect(recommendation).toBe('Consider waiting for more confirmations');
    });

    it('returns null for fresh UTXOs with more confirmations', () => {
      // UTXOs with days >= 0.1 return null even if fresh
      const ageInfo: UTXOAge = {
        days: 0.5,
        displayText: '12 hours',
        shortText: '12h',
        category: 'fresh',
        confirmationsApproximate: 72,
      };

      const recommendation = getAgeRecommendation(ageInfo);

      expect(recommendation).toBeNull();
    });

    it('returns null for young UTXOs', () => {
      const ageInfo: UTXOAge = {
        days: 3,
        displayText: '3 days',
        shortText: '3d',
        category: 'young',
        confirmationsApproximate: 432,
      };

      const recommendation = getAgeRecommendation(ageInfo);

      expect(recommendation).toBeNull();
    });

    it('returns null for mature UTXOs', () => {
      const ageInfo: UTXOAge = {
        days: 60,
        displayText: '2 months',
        shortText: '2mo',
        category: 'mature',
        confirmationsApproximate: 8640,
      };

      const recommendation = getAgeRecommendation(ageInfo);

      expect(recommendation).toBeNull();
    });

    it('returns recommendation for ancient UTXOs', () => {
      const ageInfo: UTXOAge = {
        days: 400,
        displayText: '1.1 years',
        shortText: '1y',
        category: 'ancient',
        confirmationsApproximate: 57600,
      };

      const recommendation = getAgeRecommendation(ageInfo);

      expect(recommendation).toBe('Older UTXOs are better for privacy');
    });
  });

  describe('getAgeCategoryColor', () => {
    it('returns color for fresh category', () => {
      const color = getAgeCategoryColor('fresh');

      expect(color).toBeDefined();
      expect(typeof color).toBe('string');
    });

    it('returns color for young category', () => {
      const color = getAgeCategoryColor('young');

      expect(color).toBeDefined();
    });

    it('returns color for mature category', () => {
      const color = getAgeCategoryColor('mature');

      expect(color).toBeDefined();
    });

    it('returns color for ancient category', () => {
      const color = getAgeCategoryColor('ancient');

      expect(color).toBeDefined();
    });

    it('returns different colors for different categories', () => {
      const freshColor = getAgeCategoryColor('fresh');
      const ancientColor = getAgeCategoryColor('ancient');

      expect(freshColor).not.toBe(ancientColor);
    });

    it('falls back to default color for unexpected category values', () => {
      const color = getAgeCategoryColor('unexpected' as never);
      expect(color).toBe('text-sanctuary-500');
    });
  });
});
