/**
 * CoinGecko Price Provider
 *
 * Fetches Bitcoin price from CoinGecko API.
 * Free tier with good coverage of fiat currencies.
 * Includes 24h change data and historical prices.
 */

import { createCircuitBreaker, CircuitBreaker } from '../../circuitBreaker';
import { singleFlight } from '../../../utils/async';
import { BasePriceProvider } from './base';
import type { PriceProviderRuntimeOptions } from './base';
import type { IPriceProviderWithHistory, PriceData, PriceHistoryPoint } from '../types';
import { assertNonEmptyPriceMap, coinGeckoUtcDate, utcDayLabel } from '../historicalLookup';

interface CoinGeckoPriceResponse {
  bitcoin: {
    [currency: string]: number;
  };
}

/**
 * How long one batched simple/price response serves every currency. CoinGecko's
 * keyless tier allows only a few requests per minute per IP, so all currencies
 * and the registry health probe share a single request per window.
 */
const SPOT_BATCH_TTL_MS = 60_000;

interface SpotBatch {
  data: CoinGeckoPriceResponse;
  fetchedAt: number;
}

interface CoinGeckoHistoryResponse {
  market_data?: {
    current_price?: {
      [currency: string]: number;
    };
  };
}

interface CoinGeckoMarketChartResponse {
  prices: Array<[number, number]>;
}

export class CoinGeckoPriceProvider extends BasePriceProvider implements IPriceProviderWithHistory {
  private marketChartCircuit: CircuitBreaker<PriceHistoryPoint[]>;
  private spotBatch: SpotBatch | null = null;
  private spotBatchRequests = new Map<string, Promise<SpotBatch>>();
  private readonly vsCurrencies: string;

  constructor(options: PriceProviderRuntimeOptions = {}) {
    super({
      name: 'coingecko',
      priority: 90, // Second priority
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY', 'CNY', 'KRW', 'INR'],
      registerCircuitBreaker: options.registerCircuitBreaker,
    });
    this.vsCurrencies = this.supportedCurrencies.map((c) => c.toLowerCase()).join(',');

    const marketChartCircuitConfig = {
      name: 'price-coingecko-chart',
      failureThreshold: 3,
      recoveryTimeout: 60000,
    };

    this.marketChartCircuit = options.registerCircuitBreaker === false
      ? new CircuitBreaker<PriceHistoryPoint[]>(marketChartCircuitConfig)
      : createCircuitBreaker<PriceHistoryPoint[]>(marketChartCircuitConfig);
  }

  protected async fetchPrice(currency: string): Promise<PriceData> {
    const currencyLower = currency.toLowerCase();

    const { data, fetchedAt } = await this.getSpotBatch();

    const price = data.bitcoin?.[currencyLower];
    const change24hKey = `${currencyLower}_24h_change` as keyof typeof data.bitcoin;
    const change24h = data.bitcoin?.[change24hKey] as number | undefined;

    if (!price) {
      throw new Error(`Currency ${currency} not available from CoinGecko`);
    }

    return {
      provider: this.name,
      price,
      currency,
      timestamp: new Date(fetchedAt),
      change24h: change24h !== undefined ? parseFloat(change24h.toFixed(2)) : undefined,
    };
  }

  /**
   * Spot prices for every supported currency from one simple/price request,
   * reused for SPOT_BATCH_TTL_MS and shared by concurrent callers.
   */
  private async getSpotBatch(): Promise<SpotBatch> {
    if (this.spotBatch && Date.now() - this.spotBatch.fetchedAt < SPOT_BATCH_TTL_MS) {
      return this.spotBatch;
    }

    return singleFlight(this.spotBatchRequests, 'spot', async () => {
      const data = await this.httpGet<CoinGeckoPriceResponse>(
        'https://api.coingecko.com/api/v3/simple/price',
        {
          ids: 'bitcoin',
          vs_currencies: this.vsCurrencies,
          include_24hr_change: true,
        }
      );
      this.spotBatch = { data, fetchedAt: Date.now() };
      return this.spotBatch;
    });
  }

  /**
   * Get historical price for a specific date
   */
  async getHistoricalPrice(date: Date, currency: string): Promise<PriceData> {
    const currencyLower = currency.toLowerCase();

    // DD-MM-YYYY (CoinGecko format) of the UTC day
    const dateStr = coinGeckoUtcDate(date);
    const data = await this.fetchHistory(dateStr);

    const price = data.market_data?.current_price?.[currencyLower];

    if (!price) {
      throw new Error(`Historical price not available for ${currency} on ${dateStr}`);
    }

    return {
      provider: this.name,
      price,
      currency: currency.toUpperCase(),
      timestamp: date,
    };
  }

  /**
   * Get the whole per-currency price map (lower-case keys) for the UTC day of
   * a date. A missing or empty map is reported as not available.
   */
  async getHistoricalPriceMap(date: Date): Promise<Record<string, number>> {
    const data = await this.fetchHistory(coinGeckoUtcDate(date));
    return assertNonEmptyPriceMap(data.market_data?.current_price, utcDayLabel(date));
  }

  private fetchHistory(dateStr: string): Promise<CoinGeckoHistoryResponse> {
    return this.httpGet<CoinGeckoHistoryResponse>(
      'https://api.coingecko.com/api/v3/coins/bitcoin/history',
      { date: dateStr }
    );
  }

  /**
   * Get price history over a date range
   */
  async getPriceHistory(days: number, currency: string): Promise<PriceHistoryPoint[]> {
    this.assertNotRateLimited();
    return this.marketChartCircuit.execute(async () => {
      const currencyLower = currency.toLowerCase();

      const data = await this.httpGet<CoinGeckoMarketChartResponse>(
        'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart',
        {
          vs_currency: currencyLower,
          days,
          interval: days <= 1 ? 'hourly' : 'daily',
        }
      );

      if (!data.prices || !Array.isArray(data.prices)) {
        throw new Error('Invalid response format from CoinGecko');
      }

      return data.prices.map(([timestamp, price]) => ({
        timestamp: new Date(timestamp),
        price,
      }));
    });
  }
}
