import axios from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('axios');

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { BinancePriceProvider } from '../../../../src/services/price/providers/binance';

describe('BinancePriceProvider', () => {
  const mockedAxios = vi.mocked(axios, { deep: true });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps currency symbols and parses ticker prices with 24h change', async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        symbol: 'BTCUSDT',
        lastPrice: '50123.45',
        priceChangePercent: '2.50',
      },
    } as any);

    const provider = new BinancePriceProvider();
    const result = await provider.getPrice('usd');

    expect(result.provider).toBe('binance');
    expect(result.currency).toBe('USD');
    expect(result.price).toBe(50123.45);
    expect(result.change24h).toBe(2.5);
    expect(result.timestamp).toBeInstanceOf(Date);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      'https://api.binance.com/api/v3/ticker/24hr',
      expect.objectContaining({
        params: { symbol: 'BTCUSDT' },
      })
    );
  });

  it('throws when fetchPrice is called with unsupported symbols', async () => {
    const provider = new BinancePriceProvider();

    await expect((provider as any).fetchPrice('JPY')).rejects.toThrow(
      'Currency JPY not supported by Binance'
    );
  });
});
