import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * PriceService historical lookups (getHistoricalPrice / getPriceHistory).
 *
 * Unsupported currencies must never reach CoinGecko or its circuit breaker,
 * historical maps are single-flighted and cached per UTC day, and typed
 * validation errors reach callers unwrapped.
 */

import axios from 'axios';

vi.mock('axios');
const mockedAxios = vi.mocked(axios);

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
    delete: vi.fn(async (key: string): Promise<boolean> => mockCacheStore.delete(`price:${key}`)),
    deletePattern: vi.fn(async (): Promise<number> => 0),
    has: vi.fn(async (key: string): Promise<boolean> => mockCacheStore.has(`price:${key}`)),
    clear: vi.fn(async (): Promise<void> => {
      mockCacheStore.clear();
    }),
    getStats: vi.fn(() => ({ hits: 0, misses: 0, sets: 0, deletes: 0, size: mockCacheStore.size })),
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
  mockProviderSettingsState: { enabled: ['coingecko'] as string[] },
}));

vi.mock('../../../src/services/price/providerSettings', () => ({
  readPriceProviderConfig: vi.fn(async () => ({
    version: 1,
    enabled: mockProviderSettingsState.enabled,
    updatedAt: '2026-04-29T00:00:00.000Z',
    updatedBy: null,
  })),
  setPriceProviderEnabled: vi.fn(),
}));

import PriceService from '../../../src/services/price/index';
import { circuitBreakerRegistry } from '../../../src/services/circuitBreaker';
import { InvalidInputError } from '../../../src/errors/ApiError';
import { HistoricalPriceMapUnsupportedError } from '../../../src/services/price/historicalLookup';

const HISTORY_URL = '/coins/bitcoin/history';
const CHART_URL = '/coins/bitcoin/market_chart';
const DAY = new Date('2024-03-10T15:00:00.000Z');
const PRICE_MAP = { usd: 70000, eur: 64000, brl: 350000 };

type AxiosResponse = { data: unknown };
let historyResponse: () => Promise<AxiosResponse>;

function routeAxios(url: string, config?: unknown): Promise<AxiosResponse> {
  if (url.includes(HISTORY_URL)) return historyResponse();
  if (url.includes(CHART_URL)) {
    // CoinGecko answers an unknown vs_currency with HTTP 400
    const params = (config as { params?: { vs_currency?: string } })?.params;
    if (params?.vs_currency === 'zzz') return Promise.reject(new Error('Request failed with status code 400'));
    return Promise.resolve({ data: { prices: [[1710000000000, 70000]] } });
  }
  return Promise.resolve({ data: { bitcoin: { usd: 70000, usd_24h_change: 1 } } });
}

function callsTo(fragment: string): number {
  return mockedAxios.get.mock.calls.filter(([url]) => String(url).includes(fragment)).length;
}

function historyDatesRequested(): unknown[] {
  return mockedAxios.get.mock.calls
    .filter(([url]) => String(url).includes(HISTORY_URL))
    .map(([, config]) => (config as { params?: { date?: string } })?.params?.date);
}

function gate(): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  return { wait, release };
}

/** Kolkata local wall-clock view (UTC+05:30) of a UTC instant. */
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function kolkataView(date: Date): Date {
  return new Date(date.getTime() + KOLKATA_OFFSET_MS);
}

/** Simulate a UTC+05:30 process zone through the local Date getters/setter. */
function simulateKolkataZone(): void {
  vi.spyOn(Date.prototype, 'getDate').mockImplementation(function (this: Date) {
    return kolkataView(this).getUTCDate();
  });
  vi.spyOn(Date.prototype, 'getMonth').mockImplementation(function (this: Date) {
    return kolkataView(this).getUTCMonth();
  });
  vi.spyOn(Date.prototype, 'getFullYear').mockImplementation(function (this: Date) {
    return kolkataView(this).getUTCFullYear();
  });
  vi.spyOn(Date.prototype, 'setHours').mockImplementation(function (this: Date) {
    const local = kolkataView(this);
    local.setUTCHours(0, 0, 0, 0);
    return this.setTime(local.getTime() - KOLKATA_OFFSET_MS);
  });
}

function inFlightMaps(service: PriceService): Map<string, Promise<unknown>>[] {
  const internals = service as unknown as {
    historicalPriceRequests: Map<string, Promise<unknown>>;
    priceHistoryRequests: Map<string, Promise<unknown>>;
  };
  return [internals.historicalPriceRequests, internals.priceHistoryRequests];
}

describe('PriceService historical lookups', () => {
  let priceService: PriceService;

  beforeEach(async () => {
    mockCacheStore.clear();
    circuitBreakerRegistry.resetAll();
    vi.clearAllMocks();
    mockProviderSettingsState.enabled = ['coingecko'];
    historyResponse = () => Promise.resolve({ data: { market_data: { current_price: PRICE_MAP } } });
    mockedAxios.get.mockImplementation((url: string, config?: unknown) => routeAxios(url, config));
    priceService = new PriceService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('getPriceHistory currency validation', () => {
    it('rejects an unsupported currency without any upstream request', async () => {
      await priceService.initialize();
      mockedAxios.get.mockClear();

      const result = priceService.getPriceHistory('zzz', 30);

      await expect(result).rejects.toBeInstanceOf(InvalidInputError);
      await expect(result).rejects.toThrow('Unsupported currency: ZZZ');
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('validates against the registered provider on a cold service', async () => {
      await expect(priceService.getPriceHistory('USD', 30)).resolves.toHaveLength(1);

      const cold = new PriceService();
      await expect(cold.getPriceHistory('zzz', 30)).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('reports the missing provider, not the currency, when no history provider is enabled', async () => {
      mockProviderSettingsState.enabled = ['mempool'];
      const service = new PriceService();

      const result = service.getPriceHistory('USD', 30);

      await expect(result).rejects.not.toBeInstanceOf(InvalidInputError);
      await expect(result).rejects.toThrow('No provider available with price history support');
      expect(callsTo(CHART_URL)).toBe(0);
    });

    it('normalises the currency so usd and USD share one cache entry', async () => {
      await priceService.getPriceHistory(' usd ', 30);
      await priceService.getPriceHistory('USD', 30);

      expect(callsTo(CHART_URL)).toBe(1);
    });

    it('shares one market_chart request between concurrent identical lookups', async () => {
      await priceService.initialize();

      await Promise.all([
        priceService.getPriceHistory('USD', 7),
        priceService.getPriceHistory('USD', 7),
      ]);

      expect(callsTo(CHART_URL)).toBe(1);
    });
  });

  describe('getHistoricalPrice per-day map', () => {
    it('rejects a code absent from the upstream map after exactly one upstream call', async () => {
      const result = priceService.getHistoricalPrice('ZZZ', DAY);

      await expect(result).rejects.toBeInstanceOf(InvalidInputError);
      await expect(result).rejects.toThrow('Unsupported currency: ZZZ');
      expect(callsTo(HISTORY_URL)).toBe(1);
    });

    it('serves other currencies for the same day from the date cache', async () => {
      await priceService.getHistoricalPrice('ZZZ', DAY).catch(() => undefined);

      await expect(priceService.getHistoricalPrice('EUR', DAY)).resolves.toBe(64000);
      await expect(priceService.getHistoricalPrice('usd', DAY)).resolves.toBe(70000);
      expect(callsTo(HISTORY_URL)).toBe(1);
    });

    it('keeps resolving codes outside the vs_currency allowlist that are in the map', async () => {
      await expect(priceService.getHistoricalPrice('BRL', DAY)).resolves.toBe(350000);
    });

    it('shares one history request between concurrent identical lookups', async () => {
      await priceService.initialize();

      await Promise.all([
        priceService.getHistoricalPrice('USD', DAY),
        priceService.getHistoricalPrice('USD', DAY),
      ]);

      expect(callsTo(HISTORY_URL)).toBe(1);
    });

    it('resolves each concurrent caller against its own currency', async () => {
      const [usd, eur, zzz] = await Promise.allSettled([
        priceService.getHistoricalPrice('USD', DAY),
        priceService.getHistoricalPrice('EUR', DAY),
        priceService.getHistoricalPrice('ZZZ', DAY),
      ]);

      expect(callsTo(HISTORY_URL)).toBe(1);
      expect(usd).toEqual({ status: 'fulfilled', value: 70000 });
      expect(eur).toEqual({ status: 'fulfilled', value: 64000 });
      expect(zzz.status).toBe('rejected');
      expect((zzz as PromiseRejectedResult).reason).toBeInstanceOf(InvalidInputError);
    });

    it.each([
      ['without market_data', {}],
      ['with an empty current_price', { market_data: { current_price: {} } }],
    ])('neither caches nor reports a response %s as an unsupported currency', async (_label, data) => {
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-06-01T00:00:00.000Z') });
      historyResponse = () => Promise.resolve({ data });

      const first = priceService.getHistoricalPrice('USD', DAY);
      await expect(first).rejects.toThrow('not available');
      await expect(first).rejects.not.toBeInstanceOf(InvalidInputError);
      await expect(priceService.getHistoricalPrice('USD', DAY)).rejects.toThrow('not available');
      expect(callsTo(HISTORY_URL)).toBe(1);

      vi.setSystemTime(new Date('2026-06-01T01:00:00.000Z'));
      historyResponse = () => Promise.resolve({ data: { market_data: { current_price: PRICE_MAP } } });

      await expect(priceService.getHistoricalPrice('USD', DAY)).resolves.toBe(70000);
      expect(callsTo(HISTORY_URL)).toBe(2);
    });

    it('passes the typed error through when the provider has no map support', async () => {
      await priceService.initialize();
      const internals = priceService as unknown as {
        registry: { get(name: string): Record<string, unknown> | undefined };
      };
      const provider = internals.registry.get('coingecko');
      expect(provider).toBeDefined();
      provider!.getHistoricalPriceMap = undefined;

      await expect(priceService.getHistoricalPrice('USD', DAY)).rejects.toBeInstanceOf(
        HistoricalPriceMapUnsupportedError,
      );
      expect(callsTo(HISTORY_URL)).toBe(0);
    });

    it('drops the in-flight entry when the upstream call rejects', async () => {
      historyResponse = () => Promise.reject(new Error('network down'));

      await expect(priceService.getHistoricalPrice('USD', DAY)).rejects.toThrow(
        'Failed to fetch historical price: network down',
      );
      expect(inFlightMaps(priceService)[0].size).toBe(0);

      historyResponse = () => Promise.resolve({ data: { market_data: { current_price: PRICE_MAP } } });
      await expect(priceService.getHistoricalPrice('USD', DAY)).resolves.toBe(70000);
      expect(callsTo(HISTORY_URL)).toBe(2);
    });
  });

  describe('getHistoricalPrice date handling', () => {
    it('rejects dates before CoinGecko history begins without an upstream call', async () => {
      await priceService.initialize();
      mockedAxios.get.mockClear();

      const result = priceService.getHistoricalPrice('USD', new Date('2013-04-27T12:00:00.000Z'));

      await expect(result).rejects.toBeInstanceOf(InvalidInputError);
      expect(mockedAxios.get).not.toHaveBeenCalled();
      await expect(
        priceService.getHistoricalPrice('USD', new Date('2013-04-28T00:00:00.000Z')),
      ).resolves.toBe(70000);
    });

    it('rejects an Invalid Date with a typed error', async () => {
      await expect(
        priceService.getHistoricalPrice('USD', new Date('not a date')),
      ).rejects.toBeInstanceOf(InvalidInputError);
    });

    it('maps local midnight in a positive UTC offset to its UTC day', async () => {
      await priceService.initialize();
      simulateKolkataZone();

      // Local midnight 2026-01-02 in Asia/Kolkata is 2026-01-01 18:30 UTC.
      await priceService.getHistoricalPrice('USD', new Date('2026-01-01T18:30:00.000Z'));

      expect(historyDatesRequested()).toEqual(['01-01-2026']);
    });
  });

  describe('in-flight cleanup', () => {
    async function startPendingLookups(service: PriceService): Promise<() => void> {
      await service.initialize();
      const history = gate();
      historyResponse = async () => {
        await history.wait;
        return { data: { market_data: { current_price: PRICE_MAP } } };
      };
      const chart = gate();
      mockedAxios.get.mockImplementation(async (url: string, config?: unknown) => {
        if (url.includes(CHART_URL)) await chart.wait;
        return routeAxios(url, config);
      });
      void service.getHistoricalPrice('USD', DAY).catch(() => undefined);
      void service.getPriceHistory('USD', 30).catch(() => undefined);
      await vi.waitFor(() => {
        expect(inFlightMaps(service).map((map) => map.size)).toEqual([1, 1]);
      });
      return () => {
        history.release();
        chart.release();
      };
    }

    it('clears both historical in-flight maps when providers are reloaded', async () => {
      const release = await startPendingLookups(priceService);

      await priceService.reloadProviders(['coingecko']);

      expect(inFlightMaps(priceService).map((map) => map.size)).toEqual([0, 0]);
      release();
    });

    it('clears both historical in-flight maps on shutdown', async () => {
      const release = await startPendingLookups(priceService);

      await priceService.shutdown();

      expect(inFlightMaps(priceService).map((map) => map.size)).toEqual([0, 0]);
      release();
    });
  });
});
