/**
 * Cache Collector
 *
 * Collects in-memory cache statistics: hit/miss ratio, size, and operation counts.
 * Low hit rates or full caches indicate stale data or memory pressure.
 */

import { cache, walletCache, priceCache, feeCache } from '../../cache';
import { registerCollector } from './registry';

registerCollector('cache', async () => {
  const caches: Record<string, unknown> = {
    default: cache.getStats(),
    wallet: walletCache.getStats(),
    price: priceCache.getStats(),
    fee: feeCache.getStats(),
  };

  return { caches };
});
