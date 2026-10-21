/**
 * Price Service health tests
 *
 * The public /price/health route calls PriceService.healthCheck. It must be served
 * from the registry's bounded health cache: at most one upstream probe per provider
 * per cache TTL, no matter how many requests arrive.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

// Mock axios before importing the module
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

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

const { mockProviderSettingsState } = vi.hoisted(() => ({
  mockProviderSettingsState: {
    enabled: ["mempool", "coingecko", "kraken", "coinbase"] as string[],
  },
}));

vi.mock('../../../src/services/price/providerSettings', () => ({
  readPriceProviderConfig: vi.fn(async () => ({
    version: 1,
    enabled: mockProviderSettingsState.enabled,
    updatedAt: '2026-04-29T00:00:00.000Z',
    updatedBy: null,
  })),
  setPriceProviderEnabled: vi.fn(
    async (providerName: string, enabled: boolean, updatedBy?: string) => {
      const providers = new Set(mockProviderSettingsState.enabled);
      if (enabled) providers.add(providerName);
      else providers.delete(providerName);
      mockProviderSettingsState.enabled = [
        "mempool",
        "coingecko",
        "kraken",
        "coinbase",
        "binance",
      ].filter((provider) => providers.has(provider));
      return {
        version: 1,
        enabled: mockProviderSettingsState.enabled,
        updatedAt: '2026-04-29T00:00:00.000Z',
        updatedBy: updatedBy ?? null,
      };
    },
  ),
}));

import PriceService from '../../../src/services/price/index';
import { circuitBreakerRegistry } from '../../../src/services/circuitBreaker';

const ENABLED = ['mempool', 'coingecko'];
const HEALTH_CACHE_TTL_MS = 30_000;

function respondWithPrices(url: string) {
  if (url.includes('mempool.space')) {
    return Promise.resolve({ data: { USD: 50000 } });
  }
  if (url.includes('coingecko')) {
    return Promise.resolve({ data: { bitcoin: { usd: 50000 } } });
  }
  return Promise.reject(new Error(`unexpected url ${url}`));
}

function fireConcurrentHealthChecks(service: PriceService, count: number) {
  return Promise.all(Array.from({ length: count }, () => service.healthCheck()));
}

describe('PriceService.healthCheck (bounded public probe)', () => {
  let service: PriceService;

  beforeEach(async () => {
    mockCacheStore.clear();
    circuitBreakerRegistry.resetAll();
    vi.clearAllMocks();
    mockProviderSettingsState.enabled = [...ENABLED];
    mockedAxios.get.mockImplementation(respondWithPrices as typeof mockedAxios.get);
    service = new PriceService();
    await service.initialize();
    mockedAxios.get.mockClear();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await service.shutdown();
  });

  it('serves concurrent health checks from the registration probe without upstream calls', async () => {
    const results = await fireConcurrentHealthChecks(service, 5);

    expect(mockedAxios.get).not.toHaveBeenCalled();
    for (const result of results) {
      expect(result).toEqual({ healthy: true, providers: { mempool: true, coingecko: true } });
    }
  });

  it('refreshes a stale cache with one upstream call per provider for concurrent callers', async () => {
    const realNow = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(realNow + HEALTH_CACHE_TTL_MS + 1);

    const results = await fireConcurrentHealthChecks(service, 5);

    expect(mockedAxios.get).toHaveBeenCalledTimes(ENABLED.length);
    const urls = mockedAxios.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes('mempool.space'))).toHaveLength(1);
    expect(urls.filter((url) => url.includes('coingecko'))).toHaveLength(1);
    for (const result of results) {
      expect(result).toEqual({ healthy: true, providers: { mempool: true, coingecko: true } });
    }
  });
});
