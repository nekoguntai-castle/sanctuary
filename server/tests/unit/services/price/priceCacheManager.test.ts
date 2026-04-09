import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  STALE_TTL_MULTIPLIER,
  STALE_PREFIX,
  getCacheEntry,
  getStaleCacheEntry,
  setCacheEntry,
  getCacheStats,
  clearCache,
} from '../../../../src/services/price/priceCacheManager';

// Mock the cache module
const mockGet = vi.fn();
const mockSet = vi.fn();
const mockClear = vi.fn();
const mockGetStats = vi.fn();

vi.mock('../../../../src/services/cache', () => ({
  priceCache: {
    get: (...args: unknown[]) => mockGet(...args),
    set: (...args: unknown[]) => mockSet(...args),
    clear: (...args: unknown[]) => mockClear(...args),
    getStats: (...args: unknown[]) => mockGetStats(...args),
  },
}));

describe('priceCacheManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    mockClear.mockResolvedValue(undefined);
    mockGetStats.mockReturnValue({ size: 0 });
  });

  describe('constants', () => {
    it('STALE_TTL_MULTIPLIER is 10', () => {
      expect(STALE_TTL_MULTIPLIER).toBe(10);
    });

    it('STALE_PREFIX is "stale:"', () => {
      expect(STALE_PREFIX).toBe('stale:');
    });
  });

  describe('getCacheEntry', () => {
    it('delegates to priceCache.get with the given key', async () => {
      mockGet.mockResolvedValue({ price: 50000 });

      const result = await getCacheEntry('btcPrice:USD');

      expect(mockGet).toHaveBeenCalledWith('btcPrice:USD');
      expect(result).toEqual({ price: 50000 });
    });

    it('returns null when the key is not found', async () => {
      const result = await getCacheEntry('missing');
      expect(result).toBeNull();
    });
  });

  describe('getStaleCacheEntry', () => {
    it('prefixes the key with STALE_PREFIX', async () => {
      mockGet.mockResolvedValue({ price: 49000 });

      const result = await getStaleCacheEntry('btcPrice:USD');

      expect(mockGet).toHaveBeenCalledWith('stale:btcPrice:USD');
      expect(result).toEqual({ price: 49000 });
    });
  });

  describe('setCacheEntry', () => {
    it('dual-writes fresh and stale entries', async () => {
      await setCacheEntry('btcPrice:USD', { price: 50000 }, 60);

      expect(mockSet).toHaveBeenCalledTimes(2);
      expect(mockSet).toHaveBeenCalledWith('btcPrice:USD', { price: 50000 }, 60);
      expect(mockSet).toHaveBeenCalledWith('stale:btcPrice:USD', { price: 50000 }, 600);
    });

    it('stale TTL is fresh TTL times the multiplier', async () => {
      await setCacheEntry('priceHistory:USD', { prices: [] }, 3600);

      expect(mockSet).toHaveBeenCalledWith(
        'stale:priceHistory:USD',
        { prices: [] },
        3600 * STALE_TTL_MULTIPLIER
      );
    });
  });

  describe('getCacheStats', () => {
    it('returns size and empty entries array', () => {
      mockGetStats.mockReturnValue({ size: 5 });

      const stats = getCacheStats();

      expect(stats).toEqual({ size: 5, entries: [] });
    });
  });

  describe('clearCache', () => {
    it('delegates to priceCache.clear', async () => {
      await clearCache();
      expect(mockClear).toHaveBeenCalledOnce();
    });
  });
});
