/**
 * Coinbase Price Provider
 *
 * Fetches Bitcoin price from Coinbase API.
 * Reliable exchange source.
 */

import { BasePriceProvider } from './base';
import type { PriceProviderRuntimeOptions } from './base';
import type { PriceData } from '../types';

interface CoinbasePriceResponse {
  data: {
    amount: string;
    currency: string;
    base: string;
  };
}

export class CoinbasePriceProvider extends BasePriceProvider {
  constructor(options: PriceProviderRuntimeOptions = {}) {
    super({
      name: 'coinbase',
      priority: 70, // Fourth priority
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD'],
      registerCircuitBreaker: options.registerCircuitBreaker,
    });
  }

  protected async fetchPrice(currency: string): Promise<PriceData> {
    const pair = `BTC-${currency}`;

    const data = await this.httpGet<CoinbasePriceResponse>(
      `https://api.coinbase.com/v2/prices/${pair}/spot`
    );

    const price = parseFloat(data.data.amount);

    return {
      provider: this.name,
      price,
      currency,
      timestamp: new Date(),
    };
  }
}
