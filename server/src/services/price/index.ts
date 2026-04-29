/**
 * Price Feed Service
 *
 * Aggregates Bitcoin price data from multiple sources using the
 * ProviderRegistry pattern with caching and fallback mechanisms.
 *
 * Uses the System 2 priceCache (ICacheService) for all caching.
 * Stale fallback is implemented via a separate long-TTL cache entry
 * that persists even after the primary entry expires.
 */

import { ProviderRegistry } from "../../providers";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import { priceCache, CacheTTL } from "../cache";
import {
  createPriceProviderRegistry,
  initializePriceProviders,
  getAllSupportedCurrencies,
  getProvidersForCurrency,
  createKnownPriceProvider,
  getKnownPriceProviderInfos,
  resolveEnabledPriceProviderNames,
} from "./providers";
import type {
  IPriceProvider,
  IPriceProviderWithHistory,
  PriceData,
  AggregatedPrice,
  PriceProviderInfo,
  PriceProviderTestResult,
  PriceHistoryPoint,
} from "./types";
import { hasHistoricalSupport } from "./types";

const log = createLogger("PRICE:SVC");

/**
 * Stale TTL multiplier: stale fallback entries live 10x longer than fresh entries.
 * For btcPrice (60s), stale lives 600s (10 min).
 * For priceHistory (3600s), stale lives 36000s (~10 hr).
 */
const STALE_TTL_MULTIPLIER = 10;

/** Cache key prefix for stale fallback entries */
const STALE_PREFIX = "stale:";

/** Wrapper for data stored in the price history / historical caches */
interface CachedHistorical {
  price: number;
  prices?: PriceHistoryPoint[];
  provider: string;
  currency: string;
}

class PriceService {
  private cacheDurationSec: number = CacheTTL.btcPrice; // 60 seconds default
  private registry: ProviderRegistry<IPriceProvider>;
  private initialized = false;

  constructor() {
    this.registry = createPriceProviderRegistry();
  }

  /**
   * Initialize the price service and register all providers
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await initializePriceProviders(this.registry);
    this.initialized = true;
    log.info("Price service initialized with provider registry");
  }

  /**
   * Ensure service is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }

  /**
   * Get current Bitcoin price with fallback and caching
   */
  async getPrice(
    currency: string = "USD",
    useCache: boolean = true,
  ): Promise<AggregatedPrice> {
    await this.ensureInitialized();

    const cacheKey = `current:${currency.toUpperCase()}`;

    // Check cache first
    if (useCache) {
      const cached = await priceCache.get<PriceData>(cacheKey);
      if (cached) {
        return {
          price: cached.price,
          currency: cached.currency,
          sources: [cached],
          median: cached.price,
          average: cached.price,
          timestamp: cached.timestamp,
          cached: true,
          change24h: cached.change24h,
        };
      }
    }

    // Get providers that support this currency
    const healthyProviders = await getProvidersForCurrency(
      this.registry,
      currency,
    );

    // Check if ANY provider supports this currency (even if unhealthy)
    const allProviders = this.registry
      .getAll()
      .filter((p) => p.supportsCurrency(currency));

    if (allProviders.length === 0) {
      throw new Error(`Currency ${currency} is not supported by any provider`);
    }

    // If no healthy providers, try all providers that support the currency
    // This gives circuit breakers a chance to recover
    const providersToTry =
      healthyProviders.length > 0 ? healthyProviders : allProviders;

    if (healthyProviders.length === 0) {
      log.warn("No healthy providers, attempting recovery", {
        currency,
        unhealthyProviders: allProviders.map((p) => p.name),
      });
    }

    // Fetch from available providers
    const results = await this.fetchFromProviders(providersToTry, currency);

    if (results.length === 0) {
      // Try stale cache as fallback (longer-lived entry)
      const stale = await priceCache.get<PriceData>(
        `${STALE_PREFIX}${cacheKey}`,
      );
      if (stale) {
        log.warn("Using stale cached price due to provider failures", {
          currency,
        });
        return {
          price: stale.price,
          currency: stale.currency,
          sources: [stale],
          median: stale.price,
          average: stale.price,
          timestamp: stale.timestamp,
          cached: true,
          stale: true,
          change24h: stale.change24h,
        };
      }
      log.error("All price providers failed", {
        currency,
        triedProviders: providersToTry.map((p) => p.name),
      });
      throw new Error(
        `All price providers are unavailable for ${currency}. Providers tried: ${providersToTry.map((p) => p.name).join(", ")}`,
      );
    }

    // Calculate aggregated price
    const prices = results.map((r) => r.price);
    const average = prices.reduce((sum, p) => sum + p, 0) / prices.length;
    const median = this.calculateMedian(prices);

    // Get 24h change from any provider that has it (prefer CoinGecko, then any other)
    const change24hSource =
      results.find(
        (r) => r.provider === "coingecko" && r.change24h !== undefined,
      ) || results.find((r) => r.change24h !== undefined);
    const change24h = change24hSource?.change24h;

    const aggregated: AggregatedPrice = {
      price: median,
      currency: currency.toUpperCase(),
      sources: results,
      median,
      average,
      timestamp: new Date(),
      cached: false,
      change24h,
    };

    // Cache the result (prefer source with change24h data)
    if (results.length > 0) {
      const sourceToCache = change24hSource || results[0];
      if (change24h !== undefined && !sourceToCache.change24h) {
        sourceToCache.change24h = change24h;
      }
      await this.setCacheEntry(cacheKey, sourceToCache, this.cacheDurationSec);
    }

    return aggregated;
  }

  /**
   * Get price from specific provider
   */
  async getPriceFrom(
    providerName: string,
    currency: string = "USD",
  ): Promise<PriceData> {
    await this.ensureInitialized();

    const provider = this.registry.get(providerName);

    if (!provider) {
      throw new Error(`Provider ${providerName} not found`);
    }

    if (!provider.supportsCurrency(currency)) {
      throw new Error(
        `Provider ${providerName} does not support currency ${currency}`,
      );
    }

    return provider.getPrice(currency);
  }

  /**
   * Fetch price from multiple providers in parallel
   */
  private async fetchFromProviders(
    providers: IPriceProvider[],
    currency: string,
  ): Promise<PriceData[]> {
    const promises = providers.map(async (provider) => {
      try {
        return await provider.getPrice(currency);
      } catch (error) {
        log.debug(`Failed to fetch from ${provider.name}`, {
          error: getErrorMessage(error),
        });
        return null;
      }
    });

    const results = await Promise.all(promises);
    return results.filter((r): r is PriceData => r !== null);
  }

  /**
   * Get prices for multiple currencies at once
   */
  async getPrices(
    currencies: string[],
  ): Promise<Record<string, AggregatedPrice>> {
    const promises = currencies.map(async (currency) => {
      try {
        const price = await this.getPrice(currency);
        return { currency, price };
      } catch (error) {
        log.error(`Failed to get price for ${currency}`, {
          error: getErrorMessage(error),
        });
        return null;
      }
    });

    const results = await Promise.all(promises);
    const priceMap: Record<string, AggregatedPrice> = {};

    for (const result of results) {
      if (result) {
        priceMap[result.currency] = result.price;
      }
    }

    return priceMap;
  }

  /**
   * Convert satoshis to fiat
   */
  async convertToFiat(sats: number, currency: string = "USD"): Promise<number> {
    const priceData = await this.getPrice(currency);
    const btc = sats / 100000000;
    return btc * priceData.price;
  }

  /**
   * Convert fiat to satoshis
   */
  async convertToSats(
    amount: number,
    currency: string = "USD",
  ): Promise<number> {
    const priceData = await this.getPrice(currency);
    const btc = amount / priceData.price;
    return Math.round(btc * 100000000);
  }

  /**
   * Get historical price for a specific date
   */
  async getHistoricalPrice(
    currency: string = "USD",
    date: Date,
  ): Promise<number> {
    await this.ensureInitialized();

    try {
      const normalizedDate = new Date(date);
      normalizedDate.setHours(0, 0, 0, 0);

      const cacheKey = `historical:${currency}:${normalizedDate.toISOString()}`;
      const cached = await priceCache.get<CachedHistorical>(cacheKey);

      if (cached && cached.price !== undefined) {
        log.debug(
          `Using cached historical price for ${currency} on ${normalizedDate.toDateString()}`,
        );
        return cached.price;
      }

      // Find a provider with historical support
      const provider = await this.getHistoricalProvider();

      if (!provider) {
        throw new Error("No provider available with historical price support");
      }

      const priceData = await provider.getHistoricalPrice(
        normalizedDate,
        currency,
      );

      await priceCache.set<CachedHistorical>(
        cacheKey,
        {
          price: priceData.price,
          provider: priceData.provider,
          currency: priceData.currency,
        },
        CacheTTL.priceHistory,
      );

      log.debug(
        `Fetched historical price from ${priceData.provider}: ${priceData.price} ${priceData.currency}`,
      );

      return priceData.price;
    } catch (error) {
      log.error("Failed to fetch historical price", {
        error: getErrorMessage(error),
      });
      throw new Error(
        `Failed to fetch historical price: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Get price history over a date range
   */
  async getPriceHistory(
    currency: string = "USD",
    days: number = 30,
  ): Promise<PriceHistoryPoint[]> {
    await this.ensureInitialized();

    try {
      const cacheKey = `history:${currency}:${days}d`;
      const cached = await priceCache.get<CachedHistorical>(cacheKey);

      if (cached && cached.prices) {
        log.debug(`Using cached price history for ${currency} (${days} days)`);
        return cached.prices;
      }

      const provider = await this.getHistoricalProvider();

      if (!provider) {
        throw new Error("No provider available with price history support");
      }

      const priceHistory = await provider.getPriceHistory(days, currency);

      await priceCache.set<CachedHistorical>(
        cacheKey,
        {
          provider: "coingecko",
          price: priceHistory[priceHistory.length - 1]?.price || 0,
          currency,
          prices: priceHistory,
        },
        CacheTTL.priceHistory,
      );

      log.debug(`Fetched price history: ${priceHistory.length} data points`);

      return priceHistory;
    } catch (error) {
      log.error("Failed to fetch price history", {
        error: getErrorMessage(error),
      });
      throw new Error(
        `Failed to fetch price history: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Get a provider that supports historical data
   */
  private async getHistoricalProvider(): Promise<IPriceProviderWithHistory | null> {
    const providers = this.registry.getAll();

    for (const provider of providers) {
      if (hasHistoricalSupport(provider)) {
        const healthy = await provider.healthCheck();
        if (healthy) {
          return provider;
        }
      }
    }

    return null;
  }

  /**
   * Get cache statistics
   *
   * Returns stats from the shared System 2 priceCache namespace.
   */
  getCacheStats(): { size: number; entries: string[] } {
    const stats = priceCache.getStats();
    return {
      size: stats.size,
      entries: [],
    };
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    await priceCache.clear();
  }

  /**
   * Set cache duration (in seconds for System 2 cache)
   *
   * Note: Duration is in milliseconds for API compatibility but stored in seconds.
   */
  setCacheDuration(ms: number): void {
    this.cacheDurationSec = Math.max(1, Math.round(ms / 1000));
  }

  /**
   * Get supported currencies across all providers
   */
  getSupportedCurrencies(): string[] {
    if (!this.initialized) {
      return this.getConfiguredCurrencies();
    }
    return getAllSupportedCurrencies(this.registry);
  }

  /**
   * Get list of available providers
   */
  getProviders(): string[] {
    if (!this.initialized) {
      return resolveEnabledPriceProviderNames();
    }
    return this.registry.getAll().map((p) => p.name);
  }

  /**
   * List known price providers with current enablement.
   */
  getProviderDiagnostics(): PriceProviderInfo[] {
    return getKnownPriceProviderInfos();
  }

  /**
   * Run a one-off test against a known provider.
   */
  async testProvider(
    providerName: string,
    currency: string = "USD",
  ): Promise<PriceProviderTestResult> {
    const provider = createKnownPriceProvider(providerName, {
      registerCircuitBreaker: false,
    });
    const normalizedCurrency = currency.toUpperCase();
    const startedAt = Date.now();

    if (!provider) {
      return {
        provider: providerName.trim().toLowerCase(),
        enabled: false,
        ok: false,
        currency: normalizedCurrency,
        latencyMs: 0,
        error: `Unknown price provider: ${providerName}`,
      };
    }

    try {
      const price = provider.testPrice
        ? await provider.testPrice(normalizedCurrency)
        : await provider.getPrice(normalizedCurrency);
      return {
        provider: provider.name,
        enabled: this.isProviderEnabled(provider.name),
        ok: true,
        currency: price.currency,
        latencyMs: Date.now() - startedAt,
        price: price.price,
        timestamp: price.timestamp,
      };
    } catch (error) {
      return {
        provider: provider.name,
        enabled: this.isProviderEnabled(provider.name),
        ok: false,
        currency: normalizedCurrency,
        latencyMs: Date.now() - startedAt,
        error: getErrorMessage(error),
      };
    }
  }

  /**
   * Run one-off tests against every known price provider.
   */
  async testAllProviders(
    currency: string = "USD",
  ): Promise<PriceProviderTestResult[]> {
    const results: PriceProviderTestResult[] = [];

    for (const provider of this.getProviderDiagnostics()) {
      results.push(await this.testProvider(provider.name, currency));
    }

    return results;
  }

  /**
   * Health check - test connectivity to providers
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    providers: Record<string, boolean>;
  }> {
    await this.ensureInitialized();

    const health = await this.registry.getHealth();
    const results: Record<string, boolean> = {};

    for (const status of health.providers) {
      results[status.name] = status.healthy;
    }

    return {
      healthy: health.healthyProviders > 0,
      providers: results,
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    await this.registry.shutdown();
    this.initialized = false;
    log.info("Price service shut down");
  }

  /**
   * Store a cache entry with both a fresh TTL and a longer-lived stale fallback.
   * The stale entry allows graceful degradation when all providers are down.
   */
  private async setCacheEntry<T>(
    key: string,
    data: T,
    ttlSeconds: number,
  ): Promise<void> {
    await Promise.all([
      priceCache.set(key, data, ttlSeconds),
      priceCache.set(
        `${STALE_PREFIX}${key}`,
        data,
        ttlSeconds * STALE_TTL_MULTIPLIER,
      ),
    ]);
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
  }

  private getConfiguredCurrencies(): string[] {
    const currencies = new Set<string>();
    const providers = this.getProviderDiagnostics().filter(
      (provider) => provider.enabled,
    );

    for (const provider of providers) {
      for (const currency of provider.supportedCurrencies) {
        currencies.add(currency);
      }
    }

    return Array.from(currencies).sort();
  }

  private isProviderEnabled(providerName: string): boolean {
    return this.getProviderDiagnostics().some(
      (provider) => provider.name === providerName && provider.enabled,
    );
  }
}

// Singleton instance
let priceService: PriceService | null = null;

/**
 * Get price service instance
 */
export function getPriceService(): PriceService {
  if (!priceService) {
    priceService = new PriceService();
  }
  return priceService;
}

export default PriceService;
export type {
  PriceData,
  AggregatedPrice,
  PriceProviderInfo,
  PriceProviderTestResult,
  PriceHistoryPoint,
  IPriceProvider,
};
