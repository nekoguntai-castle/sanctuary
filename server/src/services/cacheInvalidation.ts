/**
 * Cache Invalidation Service
 *
 * Subscribes to event bus events and invalidates relevant caches.
 * Ensures cache consistency when underlying data changes.
 */

import { getDistributedEventBus } from '../infrastructure';
import { eventBus } from '../events/eventBus';
import { walletCache, feeCache, priceCache } from './cache';
import { createLogger } from '../utils/logger';

const log = createLogger('CACHE_INVALIDATION:SVC');

let isInitialized = false;
const unsubscribers: Array<() => void> = [];

/**
 * Invalidate all wallet-related caches for a given walletId
 * Clears both balance-history and tx-stats entries in the System 2 wallet cache
 */
async function invalidateWalletCaches(walletId: string): Promise<void> {
  await Promise.all([
    walletCache.deletePattern(`balance-history:${walletId}:*`),
    walletCache.delete(`tx-stats:${walletId}`),
    // Activity-summary keys lead with the user id and cover a whole wallet set,
    // so no walletId-scoped pattern can reach them. Clearing the namespace is
    // the only correct move: leaving them stale would let a newly confirmed
    // transaction appear in the activity list while the summary above it still
    // reported the old count, for as long as the dashboard stayed open.
    walletCache.deletePattern('activity-summary:*'),
  ]);
  log.debug(`Invalidated wallet caches for ${walletId}`);
}

/**
 * Initialize cache invalidation listeners
 * Call once at application startup
 */
export function initializeCacheInvalidation(): void {
  if (isInitialized) {
    log.warn('Cache invalidation already initialized');
    return;
  }

  log.info('Initializing cache invalidation listeners');
  const distributedEventBus = getDistributedEventBus();

  // Wallet sync events - invalidate all wallet caches
  unsubscribers.push(
    eventBus.on('wallet:synced', async ({ walletId }) => {
      log.debug(`Invalidating caches for synced wallet ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  // Canonical persisted lifecycle transition. This also covers worker-owned
  // syncs, which do not run in the API process that owns the wallet cache.
  unsubscribers.push(
    distributedEventBus.on('wallet:syncTransition', async ({ walletId }) => {
      log.debug(`Invalidating caches for wallet sync transition ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  // Wallet deletion - clean up caches
  unsubscribers.push(
    eventBus.on('wallet:deleted', async ({ walletId }) => {
      log.debug(`Invalidating caches for deleted wallet ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  // Balance changes - invalidate wallet caches
  unsubscribers.push(
    eventBus.on('wallet:balanceChanged', async ({ walletId }) => {
      log.debug(`Invalidating caches for balance change in wallet ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  // Transaction events - invalidate affected wallet caches
  unsubscribers.push(
    eventBus.on('transaction:received', async ({ walletId }) => {
      log.debug(`Invalidating caches for received transaction in wallet ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  unsubscribers.push(
    eventBus.on('transaction:sent', async ({ walletId }) => {
      log.debug(`Invalidating caches for sent transaction in wallet ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  unsubscribers.push(
    eventBus.on('transaction:confirmed', async ({ walletId }) => {
      log.debug(`Invalidating caches for confirmed transaction in wallet ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  // Blockchain events - invalidate global caches
  unsubscribers.push(
    eventBus.on('blockchain:priceUpdated', async () => {
      log.debug('Invalidating price cache for price update');
      await priceCache.clear();
    })
  );

  unsubscribers.push(
    eventBus.on('blockchain:feeEstimateUpdated', async () => {
      log.debug('Invalidating fee estimate cache');
      await feeCache.clear();
    })
  );

  isInitialized = true;
  log.info(`Cache invalidation initialized with ${unsubscribers.length} listeners`);
}

/**
 * Shutdown cache invalidation listeners
 * Call on application shutdown
 */
export function shutdownCacheInvalidation(): void {
  if (!isInitialized) {
    return;
  }

  log.info('Shutting down cache invalidation listeners');

  for (const unsubscribe of unsubscribers) {
    unsubscribe();
  }
  unsubscribers.length = 0;

  isInitialized = false;
  log.info('Cache invalidation shutdown complete');
}

/**
 * Get cache invalidation status
 */
export function getCacheInvalidationStatus(): { initialized: boolean; listeners: number } {
  return {
    initialized: isInitialized,
    listeners: unsubscribers.length,
  };
}
