/**
 * Mempool.space Price Provider
 *
 * Fetches Bitcoin price from mempool.space API.
 * Good reliability and includes major fiat currencies.
 */

import { BasePriceProvider } from './base';
import type { PriceProviderRuntimeOptions } from './base';
import type { PriceData } from '../types';

interface MempoolPriceResponse {
  [currency: string]: number;
}

export class MempoolPriceProvider extends BasePriceProvider {
  constructor(options: PriceProviderRuntimeOptions = {}) {
    super({
      name: 'mempool',
      priority: 100, // Highest priority - most reliable
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
      registerCircuitBreaker: options.registerCircuitBreaker,
    });
  }

  protected async fetchPrice(currency: string): Promise<PriceData> {
    const data = await this.httpGet<MempoolPriceResponse>(
      'https://mempool.space/api/v1/prices'
    );

    const price = data[currency];

    if (!price) {
      throw new Error(`Currency ${currency} not available from Mempool`);
    }

    return {
      provider: this.name,
      price,
      currency,
      timestamp: new Date(),
    };
  }
}
