import { describe, expect, it, vi } from 'vitest';
import { calculateMedian, fetchFromProviders } from '../../../../src/services/price/priceAggregator';
import type { IPriceProvider, PriceData } from '../../../../src/services/price/types';

function createMockProvider(
  name: string,
  price: number,
  opts: { shouldFail?: boolean } = {}
): IPriceProvider {
  return {
    name,
    priority: 1,
    healthCheck: async () => true,
    supportedCurrencies: ['USD'],
    getPrice: opts.shouldFail
      ? vi.fn().mockRejectedValue(new Error('provider down'))
      : vi.fn().mockResolvedValue({
          provider: name,
          price,
          currency: 'USD',
          timestamp: new Date('2026-01-01T00:00:00.000Z'),
        } satisfies PriceData),
    supportsCurrency: (currency: string) => currency === 'USD',
  };
}

describe('priceAggregator', () => {
  describe('calculateMedian', () => {
    it('returns 0 for an empty array', () => {
      expect(calculateMedian([])).toBe(0);
    });

    it('returns the single value for a one-element array', () => {
      expect(calculateMedian([42000])).toBe(42000);
    });

    it('returns the middle value for an odd-length array', () => {
      expect(calculateMedian([10, 30, 20])).toBe(20);
    });

    it('returns the average of two middle values for an even-length array', () => {
      expect(calculateMedian([10, 20, 30, 40])).toBe(25);
    });

    it('handles unsorted input correctly', () => {
      expect(calculateMedian([50, 10, 40, 20, 30])).toBe(30);
    });

    it('does not mutate the input array', () => {
      const input = [30, 10, 20];
      calculateMedian(input);
      expect(input).toEqual([30, 10, 20]);
    });
  });

  describe('fetchFromProviders', () => {
    it('returns results from all successful providers', async () => {
      const providers = [
        createMockProvider('provider-a', 50000),
        createMockProvider('provider-b', 51000),
      ];

      const results = await fetchFromProviders(providers, 'USD');

      expect(results).toHaveLength(2);
      expect(results[0].provider).toBe('provider-a');
      expect(results[1].provider).toBe('provider-b');
    });

    it('filters out failed providers without throwing', async () => {
      const providers = [
        createMockProvider('good', 50000),
        createMockProvider('bad', 0, { shouldFail: true }),
      ];

      const results = await fetchFromProviders(providers, 'USD');

      expect(results).toHaveLength(1);
      expect(results[0].provider).toBe('good');
    });

    it('returns an empty array when all providers fail', async () => {
      const providers = [
        createMockProvider('bad1', 0, { shouldFail: true }),
        createMockProvider('bad2', 0, { shouldFail: true }),
      ];

      const results = await fetchFromProviders(providers, 'USD');

      expect(results).toHaveLength(0);
    });

    it('returns an empty array when given no providers', async () => {
      const results = await fetchFromProviders([], 'USD');
      expect(results).toHaveLength(0);
    });
  });
});
