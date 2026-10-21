import { beforeEach, describe, expect, it, vi } from 'vitest';
/**
 * GET /price/historical against the real PriceService (no route harness).
 *
 * A currency absent from CoinGecko's per-day map is a client error: the
 * service's InvalidInputError must reach the error handler unwrapped (400).
 */

import axios from 'axios';
import express from 'express';
import request from 'supertest';

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

import priceRouter from '../../../src/api/price';
import { errorHandler } from '../../../src/errors/errorHandler';
import { circuitBreakerRegistry } from '../../../src/services/circuitBreaker';

function createApp(): express.Express {
  const app = express();
  app.use('/api/v1/price', priceRouter);
  app.use(errorHandler);
  return app;
}

describe('GET /price/historical service errors', () => {
  const app = createApp();

  beforeEach(() => {
    mockCacheStore.clear();
    circuitBreakerRegistry.resetAll();
    vi.clearAllMocks();
    mockedAxios.get.mockImplementation(async (url: string) => {
      if (url.includes('/coins/bitcoin/history')) {
        return { data: { market_data: { current_price: { usd: 70000, eur: 64000 } } } };
      }
      return { data: { bitcoin: { usd: 70000, usd_24h_change: 1 } } };
    });
  });

  it('returns 400 for a currency absent from the upstream map', async () => {
    const response = await request(app).get('/api/v1/price/historical?date=2024-03-10&currency=zzz');

    expect(response.status).toBe(400);
    expect(response.body.message).toBe('Unsupported currency: ZZZ');
  });

  it('returns 400 for a date before CoinGecko history begins', async () => {
    const response = await request(app).get('/api/v1/price/historical?date=2013-04-27');

    expect(response.status).toBe(400);
  });

  it('serves a currency present in the upstream map', async () => {
    const response = await request(app).get('/api/v1/price/historical?date=2024-03-10&currency=eur');

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ currency: 'EUR', price: 64000 }));
  });
});
