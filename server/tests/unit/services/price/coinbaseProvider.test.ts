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

import { CoinbasePriceProvider } from '../../../../src/services/price/providers/coinbase';
import { supportedCurrencies } from '../../../../src/services/price/providers/config';

describe('CoinbasePriceProvider', () => {
  const mockedAxios = vi.mocked(axios, { deep: true });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(['CNY', 'KRW', 'INR', 'JPY', 'CHF', 'AUD'])(
    'serves %s from the Coinbase spot price endpoint',
    async (currency) => {
      mockedAxios.get.mockResolvedValue({
        data: { data: { amount: '123456.78', base: 'BTC', currency } },
      } as any);

      const provider = new CoinbasePriceProvider();
      const result = await provider.getPrice(currency.toLowerCase());

      expect(mockedAxios.get).toHaveBeenCalledWith(
        `https://api.coinbase.com/v2/prices/BTC-${currency}/spot`,
        expect.anything(),
      );
      expect(result).toMatchObject({ provider: 'coinbase', currency, price: 123456.78 });
    },
  );

  it('advertises the same currencies in the provider config', () => {
    expect(new CoinbasePriceProvider().supportedCurrencies).toEqual(supportedCurrencies.coinbase);
  });
});
