import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { CoinGeckoPriceProvider } from '../../../../src/services/price/providers/coingecko';
import { HistoricalPriceUnavailableError } from '../../../../src/services/price/historicalLookup';

/** Kolkata local wall-clock view (UTC+05:30) of a UTC instant. */
const KOLKATA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
function kolkataView(date: Date): Date {
  return new Date(date.getTime() + KOLKATA_OFFSET_MS);
}

/** Simulate a UTC+05:30 process zone through the local Date getters. */
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
}

function requestedHistoryDate(): unknown {
  return (vi.mocked(axios.get).mock.calls[0]?.[1] as { params?: { date?: string } })?.params?.date;
}

describe('CoinGeckoPriceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches current price with rounded 24h change', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        bitcoin: {
          usd: 50123.45,
          usd_24h_change: 1.2399,
        },
      },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    const result = await provider.getPrice('usd');

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'coingecko',
        price: 50123.45,
        currency: 'USD',
        change24h: 1.24,
      })
    );
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/simple/price',
      expect.objectContaining({
        params: expect.objectContaining({
          ids: 'bitcoin',
          vs_currencies: 'usd',
          include_24hr_change: true,
        }),
      })
    );
  });

  it('throws when current price for requested currency is missing', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { bitcoin: { eur: 42000 } },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    await expect(provider.getPrice('USD')).rejects.toThrow(
      'Currency USD not available from CoinGecko'
    );
  });

  it('fetches historical price with CoinGecko date format', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        market_data: {
          current_price: { usd: 42001.2 },
        },
      },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    const date = new Date('2025-01-05T12:00:00.000Z');
    const result = await provider.getHistoricalPrice(date, 'usd');

    expect(result).toEqual(
      expect.objectContaining({
        provider: 'coingecko',
        price: 42001.2,
        currency: 'USD',
        timestamp: date,
      })
    );
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/coins/bitcoin/history',
      expect.objectContaining({
        params: { date: '05-01-2025' },
      })
    );
  });

  it('throws when historical price is missing', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { market_data: { current_price: {} } },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    const date = new Date('2025-01-05T12:00:00.000Z');
    await expect(provider.getHistoricalPrice(date, 'usd')).rejects.toThrow(
      'Historical price not available for usd on 05-01-2025'
    );
  });

  it('fetches market chart history and maps timestamps', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        prices: [
          [1700000000000, 43000],
          [1700003600000, 43100],
        ],
      },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    const history = await provider.getPriceHistory(1, 'USD');

    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({
      timestamp: new Date(1700000000000),
      price: 43000,
    });
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart',
      expect.objectContaining({
        params: expect.objectContaining({
          vs_currency: 'usd',
          days: 1,
          interval: 'hourly',
        }),
      })
    );
  });

  it('uses daily interval for multi-day history and throws on invalid format', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        prices: [[1700000000000, 43000]],
      },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    await provider.getPriceHistory(30, 'USD');
    expect(axios.get).toHaveBeenCalledWith(
      'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart',
      expect.objectContaining({
        params: expect.objectContaining({
          interval: 'daily',
        }),
      })
    );

    vi.mocked(axios.get).mockResolvedValueOnce({
      data: {
        prices: undefined,
      },
    } as any);
    await expect(provider.getPriceHistory(7, 'USD')).rejects.toThrow(
      'Invalid response format from CoinGecko'
    );
  });

  it('returns the whole current_price map for a day', async () => {
    const currentPrice = { usd: 42001.2, eur: 39000, brl: 210000 };
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { market_data: { current_price: currentPrice } },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    await expect(
      provider.getHistoricalPriceMap(new Date('2025-01-05T12:00:00.000Z'))
    ).resolves.toEqual(currentPrice);
    expect(requestedHistoryDate()).toBe('05-01-2025');
  });

  it.each([
    ['without market_data', {}],
    ['with an empty current_price', { market_data: { current_price: {} } }],
  ])('reports a day map response %s as not available', async (_label, data) => {
    vi.mocked(axios.get).mockResolvedValueOnce({ data } as any);

    const provider = new CoinGeckoPriceProvider();
    const result = provider.getHistoricalPriceMap(new Date('2025-01-05T12:00:00.000Z'));
    await expect(result).rejects.toBeInstanceOf(HistoricalPriceUnavailableError);
    await expect(result).rejects.toThrow('not available on 2025-01-05');
  });

  it('requests the UTC day for an instant that is the next local day in UTC+05:30', async () => {
    simulateKolkataZone();
    vi.mocked(axios.get).mockResolvedValue({
      data: { market_data: { current_price: { usd: 90000 } } },
    } as any);

    const provider = new CoinGeckoPriceProvider();
    // Local midnight 2026-01-02 in Asia/Kolkata is 2026-01-01 18:30 UTC.
    await provider.getHistoricalPrice(new Date('2026-01-01T18:30:00.000Z'), 'usd');

    expect(requestedHistoryDate()).toBe('01-01-2026');
  });
});
