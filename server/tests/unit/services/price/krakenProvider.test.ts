import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios');

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { KrakenPriceProvider } from '../../../../src/services/price/providers/kraken';

describe('KrakenPriceProvider', () => {
  const mockedAxios = vi.mocked(axios, { deep: true });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses ticker result and returns normalized price data with 24h change', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        error: [],
        result: {
          XXBTZUSD: { c: ['50123.45', '0.1'], o: '49000.00' },
        },
      },
    } as any);

    const provider = new KrakenPriceProvider();
    const result = await provider.getPrice('usd');

    expect(result.provider).toBe('kraken');
    expect(result.currency).toBe('USD');
    expect(result.price).toBe(50123.45);
    // change24h = ((50123.45 - 49000) / 49000) * 100 = 2.29
    expect(result.change24h).toBe(2.29);
    expect(result.timestamp).toBeInstanceOf(Date);
  });

  it('throws API-reported errors from Kraken', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        error: ['EGeneral:Invalid arguments'],
        result: {},
      },
    } as any);

    const provider = new KrakenPriceProvider();
    await expect(provider.getPrice('USD')).rejects.toThrow('EGeneral:Invalid arguments');
  });

  it('throws when Kraken response has no pair data', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        error: [],
        result: {},
      },
    } as any);

    const provider = new KrakenPriceProvider();
    await expect(provider.getPrice('USD')).rejects.toThrow('No data returned for pair XXBTZUSD');
  });
});
