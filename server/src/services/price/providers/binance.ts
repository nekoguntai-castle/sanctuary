/**
 * Binance Price Provider
 *
 * Fetches Bitcoin price from Binance API.
 * High-volume exchange with good uptime.
 */

import { BasePriceProvider } from './base';
import type { PriceProviderRuntimeOptions } from './base';
import type { PriceData } from '../types';

interface BinancePriceResponse {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

export class BinancePriceProvider extends BasePriceProvider {
  private symbolMap: Record<string, string> = {
    USD: 'BTCUSDT', // Binance uses USDT for USD
    EUR: 'BTCEUR',
    GBP: 'BTCGBP',
  };

  constructor(options: PriceProviderRuntimeOptions = {}) {
    super({
      name: 'binance',
      priority: 60, // Fifth priority
      supportedCurrencies: ['USD', 'EUR', 'GBP'],
      registerCircuitBreaker: options.registerCircuitBreaker,
    });
  }

  protected async fetchPrice(currency: string): Promise<PriceData> {
    const symbol = this.symbolMap[currency];

    if (!symbol) {
      throw new Error(`Currency ${currency} not supported by Binance`);
    }

    const data = await this.httpGet<BinancePriceResponse>(
      'https://api.binance.com/api/v3/ticker/24hr',
      { symbol }
    );

    const price = parseFloat(data.lastPrice);
    const change24h = data.priceChangePercent
      ? parseFloat(parseFloat(data.priceChangePercent).toFixed(2))
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
