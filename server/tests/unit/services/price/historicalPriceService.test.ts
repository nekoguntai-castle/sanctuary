/**
 * Historical Price Service Tests
 *
 * Tests for historical price lookups and price-history range retrieval.
 */

import { vi } from 'vitest';

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const { mockGetCacheEntry, mockSetCacheEntry } = vi.hoisted(() => ({
  mockGetCacheEntry: vi.fn<any>(),
  mockSetCacheEntry: vi.fn<any>(),
}));

vi.mock('../../../../src/services/price/priceCacheManager', () => ({
  getCacheEntry: mockGetCacheEntry,
  setCacheEntry: mockSetCacheEntry,
}));

vi.mock('../../../../src/services/cache', () => ({
  priceCache: {},
  CacheTTL: {
    btcPrice: 60,
    priceHistory: 3600,
  },
}));

import {
  getHistoricalProvider,
  getHistoricalPrice,
  getPriceHistory,
} from '../../../../src/services/price/historicalPriceService';
import type { ProviderRegistry } from '../../../../src/providers';
import type { IPriceProvider, IPriceProviderWithHistory } from '../../../../src/services/price/types';

function createMockProvider(
  overrides: Partial<IPriceProvider> = {}
): IPriceProvider {
  return {
    name: 'test-provider',
    priority: 1,
    healthCheck: vi.fn<any>().mockResolvedValue(true),
    supportedCurrencies: ['USD'],
    getPrice: vi.fn<any>(),
    supportsCurrency: vi.fn<any>(),
    ...overrides,
  };
}

function createMockHistoricalProvider(
  overrides: Partial<IPriceProviderWithHistory> = {}
): IPriceProviderWithHistory {
  return {
    ...createMockProvider(),
    getHistoricalPrice: vi.fn<any>().mockResolvedValue({
      provider: 'test-provider',
      price: 42000,
      currency: 'USD',
      timestamp: new Date('2025-01-15'),
    }),
    getPriceHistory: vi.fn<any>().mockResolvedValue([
      { timestamp: new Date('2025-01-01'), price: 40000 },
      { timestamp: new Date('2025-01-02'), price: 41000 },
    ]),
    ...overrides,
  };
}

function createMockRegistry(
  providers: IPriceProvider[]
): ProviderRegistry<IPriceProvider> {
  return {
    getAll: () => providers,
    get: vi.fn<any>(),
    register: vi.fn<any>(),
    remove: vi.fn<any>(),
    has: vi.fn<any>(),
  } as unknown as ProviderRegistry<IPriceProvider>;
}

describe('Historical Price Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCacheEntry.mockResolvedValue(null);
    mockSetCacheEntry.mockResolvedValue(undefined);
  });

  describe('getHistoricalProvider', () => {
    it('returns a healthy provider with historical support', async () => {
      const historicalProvider = createMockHistoricalProvider();
      const registry = createMockRegistry([historicalProvider]);

      const result = await getHistoricalProvider(registry);

      expect(result).toBe(historicalProvider);
    });

    it('returns null when no providers exist', async () => {
      const registry = createMockRegistry([]);

      const result = await getHistoricalProvider(registry);

      expect(result).toBeNull();
    });

    it('skips providers without historical support', async () => {
      const basicProvider = createMockProvider();
      const registry = createMockRegistry([basicProvider]);

      const result = await getHistoricalProvider(registry);

      expect(result).toBeNull();
    });

    it('skips unhealthy providers with historical support', async () => {
      const unhealthyProvider = createMockHistoricalProvider({
        healthCheck: vi.fn<any>().mockResolvedValue(false),
      });
      const registry = createMockRegistry([unhealthyProvider]);

      const result = await getHistoricalProvider(registry);

      expect(result).toBeNull();
    });

    it('returns first healthy historical provider when multiple exist', async () => {
      const unhealthy = createMockHistoricalProvider({
        name: 'unhealthy',
        healthCheck: vi.fn<any>().mockResolvedValue(false),
      });
      const healthy = createMockHistoricalProvider({ name: 'healthy' });
      const registry = createMockRegistry([unhealthy, healthy]);

      const result = await getHistoricalProvider(registry);

      expect(result).toBe(healthy);
    });
  });

  describe('getHistoricalPrice', () => {
    it('returns cached price when available', async () => {
      mockGetCacheEntry.mockResolvedValue({ price: 45000 });
      const registry = createMockRegistry([]);

      const result = await getHistoricalPrice(
        registry,
        'USD',
        new Date('2025-01-15')
      );

      expect(result).toBe(45000);
    });

    it('fetches from provider when cache is empty', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      const result = await getHistoricalPrice(
        registry,
        'USD',
        new Date('2025-01-15')
      );

      expect(result).toBe(42000);
      expect(provider.getHistoricalPrice).toHaveBeenCalled();
      expect(mockSetCacheEntry).toHaveBeenCalled();
    });

    it('throws when no historical provider is available', async () => {
      const registry = createMockRegistry([]);

      await expect(
        getHistoricalPrice(registry, 'USD', new Date('2025-01-15'))
      ).rejects.toThrow('Failed to fetch historical price');
    });

    it('normalizes date to midnight', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      await getHistoricalPrice(
        registry,
        'USD',
        new Date('2025-01-15T14:30:00Z')
      );

      const callArg = (provider.getHistoricalPrice as ReturnType<typeof vi.fn>).mock.calls[0][0] as Date;
      expect(callArg.getHours()).toBe(0);
      expect(callArg.getMinutes()).toBe(0);
    });

    it('uses default currency USD', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      await getHistoricalPrice(registry, undefined, new Date('2025-01-15'));

      // Check cache key uses USD
      expect(mockGetCacheEntry).toHaveBeenCalledWith(
        expect.stringContaining('USD')
      );
    });

    it('caches the fetched price', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      await getHistoricalPrice(registry, 'EUR', new Date('2025-01-15'));

      expect(mockSetCacheEntry).toHaveBeenCalledWith(
        expect.stringContaining('EUR'),
        expect.objectContaining({
          price: 42000,
          provider: 'test-provider',
          currency: 'USD',
        }),
        expect.any(Number)
      );
    });

    it('wraps provider errors with descriptive message', async () => {
      const provider = createMockHistoricalProvider({
        getHistoricalPrice: vi.fn<any>().mockRejectedValue(new Error('API down')),
      });
      const registry = createMockRegistry([provider]);

      await expect(
        getHistoricalPrice(registry, 'USD', new Date('2025-01-15'))
      ).rejects.toThrow('Failed to fetch historical price: API down');
    });

    it('does not return cached entry with undefined price', async () => {
      mockGetCacheEntry.mockResolvedValue({ provider: 'test', currency: 'USD' });
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      const result = await getHistoricalPrice(
        registry,
        'USD',
        new Date('2025-01-15')
      );

      // Should have fetched from provider since cached price was undefined
      expect(result).toBe(42000);
      expect(provider.getHistoricalPrice).toHaveBeenCalled();
    });
  });

  describe('getPriceHistory', () => {
    it('returns cached price history when available', async () => {
      const cachedPrices = [
        { timestamp: new Date('2025-01-01'), price: 40000 },
      ];
      mockGetCacheEntry.mockResolvedValue({ prices: cachedPrices });
      const registry = createMockRegistry([]);

      const result = await getPriceHistory(registry, 'USD', 30);

      expect(result).toEqual(cachedPrices);
    });

    it('fetches from provider when cache is empty', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      const result = await getPriceHistory(registry, 'USD', 30);

      expect(result).toHaveLength(2);
      expect(provider.getPriceHistory).toHaveBeenCalledWith(30, 'USD');
    });

    it('throws when no historical provider is available', async () => {
      const registry = createMockRegistry([]);

      await expect(
        getPriceHistory(registry, 'USD', 30)
      ).rejects.toThrow('Failed to fetch price history');
    });

    it('uses default parameters (USD, 30 days)', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      await getPriceHistory(registry);

      expect(mockGetCacheEntry).toHaveBeenCalledWith('history:USD:30d');
      expect(provider.getPriceHistory).toHaveBeenCalledWith(30, 'USD');
    });

    it('caches fetched price history', async () => {
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      await getPriceHistory(registry, 'USD', 7);

      expect(mockSetCacheEntry).toHaveBeenCalledWith(
        'history:USD:7d',
        expect.objectContaining({
          provider: 'coingecko',
          currency: 'USD',
          prices: expect.any(Array),
        }),
        expect.any(Number)
      );
    });

    it('wraps provider errors with descriptive message', async () => {
      const provider = createMockHistoricalProvider({
        getPriceHistory: vi.fn<any>().mockRejectedValue(new Error('timeout')),
      });
      const registry = createMockRegistry([provider]);

      await expect(
        getPriceHistory(registry, 'USD', 30)
      ).rejects.toThrow('Failed to fetch price history: timeout');
    });

    it('handles empty price history from provider', async () => {
      const provider = createMockHistoricalProvider({
        getPriceHistory: vi.fn<any>().mockResolvedValue([]),
      });
      const registry = createMockRegistry([provider]);

      const result = await getPriceHistory(registry, 'USD', 30);

      expect(result).toEqual([]);
      // Price should be 0 when array is empty
      expect(mockSetCacheEntry).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ price: 0 }),
        expect.any(Number)
      );
    });

    it('does not return cached entry without prices array', async () => {
      mockGetCacheEntry.mockResolvedValue({ price: 42000, provider: 'test' });
      const provider = createMockHistoricalProvider();
      const registry = createMockRegistry([provider]);

      const result = await getPriceHistory(registry, 'USD', 30);

      // Should fetch from provider since cached entry had no prices
      expect(provider.getPriceHistory).toHaveBeenCalled();
      expect(result).toHaveLength(2);
    });
  });
});
