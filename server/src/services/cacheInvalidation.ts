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
import type { SystemEvents } from '../events/types';

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

type CacheInvalidation = SystemEvents['cache:invalidated'];

const CACHE_SCOPES: ReadonlySet<unknown> = new Set<CacheInvalidation['scope']>(['wallet', 'price', 'fees']);

/** Pub/sub payloads cross a process boundary; apply only a known shape. */
function isCacheInvalidation(value: unknown): value is CacheInvalidation {
  if (typeof value !== 'object' || value === null) return false;
  const { scope, walletId } = value as { scope?: unknown; walletId?: unknown };
  if (!CACHE_SCOPES.has(scope)) return false;
  return scope !== 'wallet' || (typeof walletId === 'string' && walletId.length > 0);
}

async function applyInvalidation(change: CacheInvalidation): Promise<void> {
  if (change.scope === 'wallet') {
    await invalidateWalletCaches(change.walletId!);
  } else if (change.scope === 'price') {
    await priceCache.clear();
  } else {
    await feeCache.clear();
  }
}

/**
 * The wallet/price/fee caches are in-memory per process. Apply a change seen on
 * this process's local bus here at once, then publish it so every other
 * process (API replicas and the worker, which detects most transaction and
 * confirmation changes) drops the same entries instead of waiting out the TTL.
 * Publishes are coalesced per wallet/scope, because one block can emit a
 * `transaction:confirmed` per transaction.
 */
const PUBLISH_COALESCE_MS = 100;
const pendingPublishes = new Map<string, CacheInvalidation>();
let publishTimer: ReturnType<typeof setTimeout> | null = null;

function flushPublishes(): void {
  if (publishTimer) clearTimeout(publishTimer);
  publishTimer = null;
  const bus = getDistributedEventBus();
  for (const change of pendingPublishes.values()) {
    bus.emit('cache:invalidated', change);
  }
  pendingPublishes.clear();
}

async function invalidateEverywhere(change: CacheInvalidation): Promise<void> {
  await applyInvalidation(change);
  pendingPublishes.set(change.scope === 'wallet' ? `wallet:${change.walletId}` : change.scope, change);
  if (!publishTimer) {
    publishTimer = setTimeout(flushPublishes, PUBLISH_COALESCE_MS);
    publishTimer.unref?.();
  }
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

  // Canonical persisted lifecycle transition, published for every sync
  // (including worker-owned ones), whether or not it changed any transaction.
  unsubscribers.push(
    distributedEventBus.on('wallet:syncTransition', async ({ walletId }) => {
      log.debug(`Invalidating caches for wallet sync transition ${walletId}`);
      await invalidateWalletCaches(walletId);
    })
  );

  // Pub/sub is at-most-once: after a possible gap (this subscriber reconnected,
  // or a peer failed to publish) the wallet entries a missed invalidation named
  // are unknown, so drop them all and let reads repopulate. Price and fee
  // entries expire within a minute anyway, and clearing the price cache would
  // also drop its stale-price fallback.
  unsubscribers.push(
    distributedEventBus.onResync(async () => {
      log.info('Possibly missed cache invalidations; clearing the wallet cache');
      await walletCache.clear();
    })
  );

  // Wallet deletion - clean up caches
  unsubscribers.push(
    eventBus.on('wallet:deleted', async ({ walletId }) => {
      log.debug(`Invalidating caches for deleted wallet ${walletId}`);
      await invalidateEverywhere({ scope: 'wallet', walletId });
    })
  );

  // Balance changes - invalidate wallet caches
  unsubscribers.push(
    eventBus.on('wallet:balanceChanged', async ({ walletId }) => {
      log.debug(`Invalidating caches for balance change in wallet ${walletId}`);
      await invalidateEverywhere({ scope: 'wallet', walletId });
    })
  );

  // Transaction events - invalidate affected wallet caches
  unsubscribers.push(
    eventBus.on('transaction:received', async ({ walletId }) => {
      log.debug(`Invalidating caches for received transaction in wallet ${walletId}`);
      await invalidateEverywhere({ scope: 'wallet', walletId });
    })
  );

  unsubscribers.push(
    eventBus.on('transaction:sent', async ({ walletId }) => {
      log.debug(`Invalidating caches for sent transaction in wallet ${walletId}`);
      await invalidateEverywhere({ scope: 'wallet', walletId });
    })
  );

  unsubscribers.push(
    eventBus.on('transaction:confirmed', async ({ walletId }) => {
      log.debug(`Invalidating caches for confirmed transaction in wallet ${walletId}`);
      await invalidateEverywhere({ scope: 'wallet', walletId });
    })
  );

  // Blockchain events - invalidate global caches
  unsubscribers.push(
    eventBus.on('blockchain:priceUpdated', async () => {
      log.debug('Invalidating price cache for price update');
      await invalidateEverywhere({ scope: 'price' });
    })
  );

  unsubscribers.push(
    eventBus.on('blockchain:feeEstimateUpdated', async () => {
      log.debug('Invalidating fee estimate cache');
      await invalidateEverywhere({ scope: 'fees' });
    })
  );

  // Invalidations published by other processes. `onRemote` skips this
  // process's own publishes, which were already applied above.
  unsubscribers.push(
    distributedEventBus.onRemote('cache:invalidated', async (change) => {
      if (!isCacheInvalidation(change)) {
        log.warn('Ignoring malformed cache invalidation');
        return;
      }
      await applyInvalidation(change);
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
  flushPublishes();

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
