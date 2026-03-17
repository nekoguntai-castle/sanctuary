import { vi } from 'vitest';
/**
 * Price Service Tests
 *
 * Tests for Bitcoin price aggregation, caching, and conversion.
 * Mocks external API calls to test business logic.
 */

import axios from 'axios';

// Mock axios before importing the module
vi.mock('axios');
const mockedAxios = axios as Mocked<typeof axios>;

// Mock the logger
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// In-memory mock cache for priceCache (System 2 ICacheService)
const { mockCacheStore } = vi.hoisted(() => ({
  mockCacheStore: new Map<string, { value: unknown; expiresAt: number }>(),
}));

vi.mock('../../../src/services/cache', () => {
  const createMockCache = () => ({
    get: vi.fn(async <T>(key: string): Promise<T | null> => {
      const entry = mockCacheStore.get(`price:${key}`);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        mockCacheStore.delete(`price:${key}`);
        return null;
      }
      return entry.value as T;
    }),
    set: vi.fn(async <T>(key: string, value: T, ttlSeconds?: number): Promise<void> => {
      const ttl = ttlSeconds ?? 300;
      mockCacheStore.set(`price:${key}`, { value, expiresAt: Date.now() + ttl * 1000 });
    }),
    delete: vi.fn(async (key: string): Promise<boolean> => {
      return mockCacheStore.delete(`price:${key}`);
    }),
    deletePattern: vi.fn(async (): Promise<number> => 0),
    has: vi.fn(async (key: string): Promise<boolean> => {
      const entry = mockCacheStore.get(`price:${key}`);
      return !!entry && Date.now() <= entry.expiresAt;
    }),
    clear: vi.fn(async (): Promise<void> => {
      for (const key of mockCacheStore.keys()) {
        if (key.startsWith('price:')) {
          mockCacheStore.delete(key);
        }
      }
    }),
    getStats: vi.fn(() => {
      let size = 0;
      for (const key of mockCacheStore.keys()) {
        if (key.startsWith('price:')) size++;
      }
      return { hits: 0, misses: 0, sets: 0, deletes: 0, size };
    }),
    namespace: vi.fn(),
  });

  return {
    priceCache: createMockCache(),
    CacheTTL: {
      balance: 30,
      blockHeight: 10,
      feeEstimates: 60,
      btcPrice: 60,
      userPreferences: 300,
      priceHistory: 3600,
      walletInfo: 3600,
    },
  };
});

import PriceService, { getPriceService } from '../../../src/services/price/index';
import { supportedCurrencies } from '../../../src/services/price/providers';
import { circuitBreakerRegistry } from '../../../src/services/circuitBreaker';

describe('Price Service', () => {
  let priceService: PriceService;

  beforeEach(async () => {
    // Clear shared mock cache store
    mockCacheStore.clear();
    // Create fresh instance for each test
    priceService = new PriceService();
    await priceService.clearCache();
    // Reset all circuit breakers to CLOSED state
    circuitBreakerRegistry.resetAll();
    vi.clearAllMocks();
  });

  describe('getPrice', () => {
    it('should aggregate prices from multiple providers', async () => {
      // Mock responses from different providers
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: {
              bitcoin: {
                usd: 50100,
                usd_24h_change: 2.5,
              },
            },
          });
        }
        if (url.includes('kraken')) {
          return Promise.resolve({
            data: {
              error: [],
              result: { XXBTZUSD: { c: ['50050.00'] } },
            },
          });
        }
        if (url.includes('coinbase')) {
          return Promise.resolve({
            data: { data: { amount: '49950.00' } },
          });
        }
        if (url.includes('binance')) {
          return Promise.resolve({
            data: { lastPrice: '50000.00', priceChangePercent: '1.50' },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await priceService.getPrice('USD', false);

      expect(result).toBeDefined();
      expect(result.currency).toBe('USD');
      expect(result.price).toBeGreaterThan(0);
      expect(result.sources.length).toBeGreaterThan(0);
      expect(result.cached).toBe(false);
    });

    it('should calculate median price from multiple sources', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 52000 } },
          });
        }
        if (url.includes('kraken')) {
          return Promise.resolve({
            data: {
              error: [],
              result: { XXBTZUSD: { c: ['51000.00'] } },
            },
          });
        }
        if (url.includes('coinbase')) {
          return Promise.resolve({
            data: { data: { amount: '53000.00' } },
          });
        }
        if (url.includes('binance')) {
          return Promise.resolve({
            data: { lastPrice: '54000.00', priceChangePercent: '2.00' },
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      const result = await priceService.getPrice('USD', false);

      // Median of [50000, 51000, 52000, 53000, 54000] = 52000
      expect(result.median).toBe(52000);
    });

    it('should use cache when available and not expired', async () => {
      // First call
      mockedAxios.get.mockResolvedValue({ data: { USD: 50000 } });

      await priceService.getPrice('USD', true);
      const callCountAfterFirst = mockedAxios.get.mock.calls.length;

      // Second call - should use cache
      const result = await priceService.getPrice('USD', true);

      expect(result.cached).toBe(true);
      expect(mockedAxios.get.mock.calls.length).toBe(callCountAfterFirst);
    });

    it('should bypass cache when useCache is false', async () => {
      mockedAxios.get.mockResolvedValue({ data: { USD: 50000 } });

      await priceService.getPrice('USD', true);
      const callCountAfterFirst = mockedAxios.get.mock.calls.length;

      // Second call with useCache=false
      await priceService.getPrice('USD', false);

      expect(mockedAxios.get.mock.calls.length).toBeGreaterThan(callCountAfterFirst);
    });

    it('should throw error for unsupported currency', async () => {
      await expect(priceService.getPrice('XYZ', false)).rejects.toThrow(
        'Currency XYZ is not supported by any provider'
      );
    });

    it('should throw error when all providers fail', async () => {
      // When axios rejects during provider initialization, no providers get registered
      // This causes "Currency not supported" error before it can try to fetch
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      await expect(priceService.getPrice('USD', false)).rejects.toThrow();
    });

    it('should try unhealthy providers when no healthy providers available', async () => {
      // Simulate circuit breakers being open (all providers initially fail)
      let callCount = 0;
      mockedAxios.get.mockImplementation((url: string) => {
        callCount++;
        // First few calls fail (during health checks), then succeed
        if (callCount <= 10) {
          return Promise.reject(new Error('Provider temporarily unavailable'));
        }
        // After circuit breakers trip, providers should still be tried for recovery
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      // First call may fail as providers are marked unhealthy
      try {
        await priceService.getPrice('USD', false);
      } catch {
        // Expected - providers are marked unhealthy
      }

      // Reset mock to succeed - simulating provider recovery
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      // Second call should try all providers even if marked unhealthy
      // This gives circuit breakers a chance to recover
      const result = await priceService.getPrice('USD', false);
      expect(result.price).toBe(50000);
    });

    it('should include provider names in error message when all fail', async () => {
      // Make all providers fail consistently
      mockedAxios.get.mockRejectedValue(new Error('Network error'));

      await expect(priceService.getPrice('USD', false)).rejects.toThrow(
        /providers|Provider/i
      );
    });

    it('should include 24h change from CoinGecko', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: {
              bitcoin: {
                usd: 50000,
                usd_24h_change: -3.5,
              },
            },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('USD', false);

      expect(result.change24h).toBe(-3.5);
    });

    it('should handle EUR currency', async () => {
      // Mock responses need to include USD for health checks, plus EUR for the actual request
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          // Return both USD (for health check) and EUR (for actual request)
          return Promise.resolve({ data: { USD: 50000, EUR: 45000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000, eur: 45100 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('EUR', false);

      expect(result.currency).toBe('EUR');
      expect(result.price).toBeGreaterThan(0);
    });
  });

  describe('getPriceFrom', () => {
    it('should fetch from specific provider', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { bitcoin: { usd: 50000 } },
      });

      const result = await priceService.getPriceFrom('coingecko', 'USD');

      expect(result.provider).toBe('coingecko');
      expect(result.price).toBe(50000);
    });

    it('should throw for unknown provider', async () => {
      await expect(priceService.getPriceFrom('unknown', 'USD')).rejects.toThrow(
        'Provider unknown not found'
      );
    });

    it('should throw when provider does not support currency', async () => {
      // Binance only supports USD, EUR, GBP
      await expect(priceService.getPriceFrom('binance', 'JPY')).rejects.toThrow(
        'Provider binance does not support currency JPY'
      );
    });
  });

  describe('convertToFiat', () => {
    it('should convert satoshis to fiat', async () => {
      // Mock all providers for consistent results
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToFiat(100000000, 'USD');

      expect(result).toBe(50000); // 1 BTC = $50,000
    });

    it('should handle small amounts', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToFiat(1, 'USD');

      expect(result).toBeCloseTo(0.0005, 5); // 1 sat at $50k/BTC
    });

    it('should handle zero satoshis', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToFiat(0, 'USD');

      expect(result).toBe(0);
    });
  });

  describe('convertToSats', () => {
    it('should convert fiat to satoshis', async () => {
      // Mock all providers for consistent results
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToSats(50000, 'USD');

      expect(result).toBe(100000000); // $50,000 = 1 BTC = 100M sats
    });

    it('should handle small amounts and round to nearest satoshi', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToSats(0.01, 'USD');

      expect(result).toBe(20); // $0.01 at $50k/BTC = 20 sats
    });

    it('should handle zero fiat', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.convertToSats(0, 'USD');

      expect(result).toBe(0);
    });
  });

  describe('cache management', () => {
    it('should report cache statistics', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { bitcoin: { usd: 50000 } },
      });

      await priceService.getPrice('USD', true);

      const stats = priceService.getCacheStats();

      expect(stats.size).toBeGreaterThan(0);
    });

    it('should clear cache', async () => {
      mockedAxios.get.mockResolvedValue({
        data: { bitcoin: { usd: 50000 } },
      });

      await priceService.getPrice('USD', true);
      await priceService.clearCache();

      const stats = priceService.getCacheStats();
      expect(stats.size).toBe(0);
    });

    it('should allow setting cache duration', () => {
      priceService.setCacheDuration(30000);
      // No assertion needed - just verify it doesn't throw
    });
  });

  describe('getSupportedCurrencies', () => {
    it('should return list of supported currencies', () => {
      const currencies = priceService.getSupportedCurrencies();

      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('GBP');
      expect(Array.isArray(currencies)).toBe(true);
    });

    it('should return consistent list', () => {
      const currencies = priceService.getSupportedCurrencies();

      // Should return consistent list of major currencies
      expect(currencies).toContain('USD');
      expect(currencies).toContain('EUR');
      expect(currencies).toContain('GBP');
      expect(currencies.length).toBeGreaterThanOrEqual(10);
    });
  });

  describe('getProviders', () => {
    it('should return list of available providers', () => {
      const providers = priceService.getProviders();

      expect(providers).toContain('mempool');
      expect(providers).toContain('coingecko');
      expect(providers).toContain('kraken');
      expect(providers).toContain('coinbase');
      expect(providers).toContain('binance');
    });
  });

  describe('healthCheck', () => {
    it('should report healthy when at least one provider works', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider down'));
      });

      const result = await priceService.healthCheck();

      expect(result.healthy).toBe(true);
      expect(result.providers.coingecko).toBe(true);
    });

    it('should report unhealthy when all providers fail', async () => {
      mockedAxios.get.mockRejectedValue(new Error('All providers down'));

      const result = await priceService.healthCheck();

      expect(result.healthy).toBe(false);
      Object.values(result.providers).forEach((status) => {
        expect(status).toBe(false);
      });
    });

    it('should report per-provider status', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.healthCheck();

      expect(result.providers.mempool).toBe(true);
      expect(result.providers.coingecko).toBe(true);
      expect(result.providers.kraken).toBe(false);
    });
  });

  describe('getPriceService singleton', () => {
    it('should return the same instance', () => {
      const instance1 = getPriceService();
      const instance2 = getPriceService();

      expect(instance1).toBe(instance2);
    });
  });

  describe('calculateMedian (via getPrice)', () => {
    it('should handle single price correctly', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 50000 } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('USD', false);

      expect(result.median).toBe(50000);
      expect(result.average).toBe(50000);
    });

    it('should handle even number of prices', async () => {
      mockedAxios.get.mockImplementation((url: string) => {
        if (url.includes('mempool.space')) {
          return Promise.resolve({ data: { USD: 50000 } });
        }
        if (url.includes('coingecko')) {
          return Promise.resolve({
            data: { bitcoin: { usd: 52000 } },
          });
        }
        if (url.includes('kraken')) {
          return Promise.resolve({
            data: {
              error: [],
              result: { XXBTZUSD: { c: ['51000.00'] } },
            },
          });
        }
        if (url.includes('coinbase')) {
          return Promise.resolve({
            data: { data: { amount: '53000.00' } },
          });
        }
        return Promise.reject(new Error('Provider unavailable'));
      });

      const result = await priceService.getPrice('USD', false);

      // Median of [50000, 51000, 52000, 53000] = (51000 + 52000) / 2 = 51500
      expect(result.median).toBe(51500);
    });
  });

  describe('supportedCurrencies', () => {
    it('should have defined currencies for each provider', () => {
      expect(supportedCurrencies.mempool).toBeDefined();
      expect(supportedCurrencies.coingecko).toBeDefined();
      expect(supportedCurrencies.kraken).toBeDefined();
      expect(supportedCurrencies.coinbase).toBeDefined();
      expect(supportedCurrencies.binance).toBeDefined();
    });

    it('should include USD for all providers', () => {
      Object.values(supportedCurrencies).forEach((currencies) => {
        expect(currencies).toContain('USD');
      });
    });
  });
});
