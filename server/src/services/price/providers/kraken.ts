/**
 * Kraken Price Provider
 *
 * Fetches Bitcoin price from Kraken exchange API.
 * Reliable exchange with good uptime.
 */

import { BasePriceProvider } from './base';
import type { PriceProviderRuntimeOptions } from './base';
import type { PriceData } from '../types';

interface KrakenTickerResponse {
  error: string[];
  result: {
    [pair: string]: {
      c: [string, string]; // Last trade closed [price, lot volume]
      o: string;           // Today's opening price
    };
  };
}

export class KrakenPriceProvider extends BasePriceProvider {
  constructor(options: PriceProviderRuntimeOptions = {}) {
    super({
      name: 'kraken',
      priority: 80, // Third priority
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
      registerCircuitBreaker: options.registerCircuitBreaker,
    });
  }

  protected async fetchPrice(currency: string): Promise<PriceData> {
    const pair = `XXBTZ${currency}`;

    const data = await this.httpGet<KrakenTickerResponse>(
      'https://api.kraken.com/0/public/Ticker',
      { pair }
    );

    if (data.error?.length > 0) {
      throw new Error(data.error[0]);
    }

    // Kraken returns data with a dynamic key
    const pairData = Object.values(data.result)[0];
    if (!pairData) {
      throw new Error(`No data returned for pair ${pair}`);
    }

    const price = parseFloat(pairData.c[0]);
    const openPrice = parseFloat(pairData.o);
    const change24h = openPrice > 0
      ? parseFloat(((price - openPrice) / openPrice * 100).toFixed(2))
      : undefined;

    return {
      provider: this.name,
      price,
      currency,
      timestamp: new Date(),
      change24h,
    };
  }
}
