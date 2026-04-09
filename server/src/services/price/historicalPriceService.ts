/**
 * Historical Price Service
 *
 * Handles historical price lookups and price-history ranges.
 * Depends on the provider registry (read-only) and the cache manager.
 */

import type { ProviderRegistry } from '../../providers';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { CacheTTL } from '../cache';
import type { IPriceProvider, IPriceProviderWithHistory, PriceHistoryPoint } from './types';
import { hasHistoricalSupport } from './types';
import { getCacheEntry, setCacheEntry, type CachedHistorical } from './priceCacheManager';

const log = createLogger('PRICE:HIST');

export async function getHistoricalProvider(
  registry: ProviderRegistry<IPriceProvider>
): Promise<IPriceProviderWithHistory | null> {
  const providers = registry.getAll();

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

export async function getHistoricalPrice(
  registry: ProviderRegistry<IPriceProvider>,
  currency: string = 'USD',
  date: Date
): Promise<number> {
  try {
    const normalizedDate = new Date(date);
    normalizedDate.setHours(0, 0, 0, 0);

    const cacheKey = `historical:${currency}:${normalizedDate.toISOString()}`;
    const cached = await getCacheEntry<CachedHistorical>(cacheKey);

    if (cached && cached.price !== undefined) {
      log.debug(`Using cached historical price for ${currency} on ${normalizedDate.toDateString()}`);
      return cached.price;
    }

    const provider = await getHistoricalProvider(registry);

    if (!provider) {
      throw new Error('No provider available with historical price support');
    }

    const priceData = await provider.getHistoricalPrice(normalizedDate, currency);

    await setCacheEntry<CachedHistorical>(cacheKey, {
      price: priceData.price,
      provider: priceData.provider,
      currency: priceData.currency,
    }, CacheTTL.priceHistory);

    log.debug(`Fetched historical price from ${priceData.provider}: ${priceData.price} ${priceData.currency}`);

    return priceData.price;
  } catch (error) {
    log.error('Failed to fetch historical price', { error: getErrorMessage(error) });
    throw new Error(`Failed to fetch historical price: ${getErrorMessage(error)}`);
  }
}

export async function getPriceHistory(
  registry: ProviderRegistry<IPriceProvider>,
  currency: string = 'USD',
  days: number = 30
): Promise<PriceHistoryPoint[]> {
  try {
    const cacheKey = `history:${currency}:${days}d`;
    const cached = await getCacheEntry<CachedHistorical>(cacheKey);

    if (cached && cached.prices) {
      log.debug(`Using cached price history for ${currency} (${days} days)`);
      return cached.prices;
    }

    const provider = await getHistoricalProvider(registry);

    if (!provider) {
      throw new Error('No provider available with price history support');
    }

    const priceHistory = await provider.getPriceHistory(days, currency);

    await setCacheEntry<CachedHistorical>(cacheKey, {
      provider: 'coingecko',
      price: priceHistory[priceHistory.length - 1]?.price || 0,
      currency,
      prices: priceHistory,
    }, CacheTTL.priceHistory);

    log.debug(`Fetched price history: ${priceHistory.length} data points`);

    return priceHistory;
  } catch (error) {
    log.error('Failed to fetch price history', { error: getErrorMessage(error) });
    throw new Error(`Failed to fetch price history: ${getErrorMessage(error)}`);
  }
}
