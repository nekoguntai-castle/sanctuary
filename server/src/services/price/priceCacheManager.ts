/**
 * Price Cache Manager
 *
 * Encapsulates the stale-cache fallback pattern for price data.
 * Every fresh write is accompanied by a longer-lived "stale" entry
 * so the service can degrade gracefully when all providers are down.
 */

import { priceCache } from '../cache';
import type { PriceHistoryPoint } from './types';

/**
 * Stale TTL multiplier: stale fallback entries live 10x longer than fresh entries.
 * For btcPrice (60s), stale lives 600s (10 min).
 * For priceHistory (3600s), stale lives 36000s (~10 hr).
 */
export const STALE_TTL_MULTIPLIER = 10;

/** Cache key prefix for stale fallback entries */
export const STALE_PREFIX = 'stale:';

export interface CachedHistorical {
  price: number;
  prices?: PriceHistoryPoint[];
  provider: string;
  currency: string;
}

export async function getCacheEntry<T>(key: string): Promise<T | null> {
  return priceCache.get<T>(key);
}

export async function getStaleCacheEntry<T>(key: string): Promise<T | null> {
  return priceCache.get<T>(`${STALE_PREFIX}${key}`);
}

/**
 * Dual-write: fresh entry + longer-lived stale fallback for graceful degradation.
 */
export async function setCacheEntry<T>(key: string, data: T, ttlSeconds: number): Promise<void> {
  await Promise.all([
    priceCache.set(key, data, ttlSeconds),
    priceCache.set(`${STALE_PREFIX}${key}`, data, ttlSeconds * STALE_TTL_MULTIPLIER),
  ]);
}

export function getCacheStats(): { size: number; entries: string[] } {
  const stats = priceCache.getStats();
  return {
    size: stats.size,
    entries: [],
  };
}

export async function clearCache(): Promise<void> {
  await priceCache.clear();
}
