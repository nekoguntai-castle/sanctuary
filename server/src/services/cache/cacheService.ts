/**
 * Cache Service
 *
 * Provides a caching layer for frequently accessed data.
 * Uses in-memory cache by default, with optional Redis backend.
 *
 * ## Features
 *
 * - TTL-based expiration
 * - Namespace prefixing for cache segmentation
 * - Cache invalidation helpers
 * - Metrics for monitoring
 *
 * ## Usage
 *
 * ```typescript
 * // Get/set with TTL
 * await cache.set('wallet:balance:abc', 100000n, 30); // 30 second TTL
 * const balance = await cache.get<bigint>('wallet:balance:abc');
 *
 * // With namespace
 * const walletCache = cache.namespace('wallet');
 * await walletCache.set('balance:abc', 100000n, 30);
 *
 * // Invalidate
 * await cache.delete('wallet:balance:abc');
 * await cache.deletePattern('wallet:*');
 * ```
 */

import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { cacheOperationsTotal } from '../../observability/metrics';

const log = createLogger('CACHE:SVC');

// =============================================================================
// Types
// =============================================================================

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  size: number;
}

export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  deletePattern(pattern: string): Promise<number>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;
  getStats(): CacheStats;
  namespace(prefix: string): ICacheService;
}

// =============================================================================
// In-Memory Cache Implementation
// =============================================================================

// Default maximum cache entries before FIFO eviction kicks in
const DEFAULT_MAX_CACHE_SIZE = 10_000;
const REGEXP_SPECIAL_CHARS = /[.*+?^${}()|[\]\\]/g;

function escapeRegExpLiteral(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARS, '\\$&');
}

function cachePatternToRegExp(pattern: string): RegExp {
  const escapedPattern = pattern
    .split('*')
    .map(escapeRegExpLiteral)
    .join('.*');

  return new RegExp(`^${escapedPattern}$`);
}

/**
 * In-memory cache with TTL support and max size eviction
 */
class MemoryCache implements ICacheService {
  private cache = new Map<string, CacheEntry<unknown>>();
  private prefix: string;
  private defaultTtl: number;
  private maxSize: number;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
  };

  // Cleanup interval reference for proper shutdown
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(prefix: string = '', defaultTtl: number = 300, maxSize: number = DEFAULT_MAX_CACHE_SIZE) {
    this.prefix = prefix;
    this.defaultTtl = defaultTtl;
    this.maxSize = maxSize;

    // Only start cleanup in root cache (not namespaced instances)
    if (!prefix) {
      this.startCleanup();
    }
  }

  private getFullKey(key: string): string {
    return this.prefix ? `${this.prefix}:${key}` : key;
  }

  async get<T>(key: string): Promise<T | null> {
    const fullKey = this.getFullKey(key);
    const entry = this.cache.get(fullKey);

    if (!entry) {
      this.stats.misses++;
      cacheOperationsTotal.inc({ type: 'get', result: 'miss' });
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(fullKey);
      this.stats.misses++;
      cacheOperationsTotal.inc({ type: 'get', result: 'miss' });
      return null;
    }

    this.stats.hits++;
    cacheOperationsTotal.inc({ type: 'get', result: 'hit' });
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const fullKey = this.getFullKey(key);
    const ttl = ttlSeconds ?? this.defaultTtl;
    const expiresAt = Date.now() + (ttl * 1000);

    // Evict oldest entries if at capacity (FIFO — Map insertion order)
    // Only evict if this is a new key (updates don't increase size)
    if (!this.cache.has(fullKey) && this.cache.size >= this.maxSize) {
      const evictCount = Math.max(1, Math.floor(this.maxSize * 0.05)); // Evict 5% batch
      let evicted = 0;
      for (const oldKey of this.cache.keys()) {
        this.cache.delete(oldKey);
        evicted++;
        if (evicted >= evictCount) break;
      }
      log.warn(`Cache at max size (${this.maxSize}), evicted ${evicted} oldest entries`);
    }

    this.cache.set(fullKey, { value, expiresAt });
    this.stats.sets++;
    this.stats.size = this.cache.size;
    cacheOperationsTotal.inc({ type: 'set', result: 'success' });
  }

  async delete(key: string): Promise<boolean> {
    const fullKey = this.getFullKey(key);
    const deleted = this.cache.delete(fullKey);
    if (deleted) {
      this.stats.deletes++;
      this.stats.size = this.cache.size;
      cacheOperationsTotal.inc({ type: 'delete', result: 'success' });
    }
    return deleted;
  }

  async deletePattern(pattern: string): Promise<number> {
    const fullPattern = this.getFullKey(pattern);
    const regex = cachePatternToRegExp(fullPattern);
    let count = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        count++;
      }
    }

    if (count > 0) {
      this.stats.deletes += count;
      this.stats.size = this.cache.size;
    }

    return count;
  }

  async has(key: string): Promise<boolean> {
    const value = await this.get(key);
    return value !== null;
  }

  async clear(): Promise<void> {
    if (this.prefix) {
      // Clear only entries with this prefix
      await this.deletePattern('*');
    } else {
      // Clear everything
      this.cache.clear();
      this.stats.size = 0;
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  namespace(prefix: string): ICacheService {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    const namespaced = new MemoryCache(newPrefix, this.defaultTtl, this.maxSize);
    // Share the same underlying cache
    namespaced.cache = this.cache;
    namespaced.stats = this.stats;
    return namespaced;
  }

  // =============================================================================
  // Lifecycle
  // =============================================================================

  private startCleanup(): void {
    // Clean up expired entries every 60 seconds
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      let expired = 0;

      for (const [key, entry] of this.cache.entries()) {
        if (now > entry.expiresAt) {
          this.cache.delete(key);
          expired++;
        }
      }

      if (expired > 0) {
        log.debug(`Cache cleanup: removed ${expired} expired entries`);
        this.stats.size = this.cache.size;
      }
    }, 60000);

    // Don't prevent Node from exiting
    this.cleanupInterval.unref();
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// =============================================================================
// Cache Keys & TTLs
// =============================================================================

/**
 * Standard cache key patterns
 */
export const CacheKeys = {
  // Wallet data
  walletBalance: (walletId: string) => `wallet:balance:${walletId}`,
  walletInfo: (walletId: string) => `wallet:info:${walletId}`,

  // Price data
  btcPrice: () => 'price:btc:usd',
  priceHistory: (days: number) => `price:history:${days}`,

  // Fee estimates
  feeEstimates: (network: string) => `fees:${network}`,

  // User preferences
  userPreferences: (userId: string) => `user:prefs:${userId}`,

  // Block height
  blockHeight: (network: string) => `block:height:${network}`,
} as const;

/**
 * Standard TTLs in seconds
 */
export const CacheTTL = {
  // Short TTL for frequently changing data
  balance: 30,
  blockHeight: 10,

  // Medium TTL for semi-static data
  feeEstimates: 60,
  btcPrice: 60,

  // Long TTL for rarely changing data
  userPreferences: 300,
  priceHistory: 3600,

  // Very long TTL for static data
  walletInfo: 3600,
} as const;

// =============================================================================
// Singleton & Factory
// =============================================================================

/**
 * Global cache instance
 */
export const cache = new MemoryCache();

/**
 * Create a namespaced cache instance
 */
export function createNamespacedCache(namespace: string): ICacheService {
  return cache.namespace(namespace);
}

/**
 * Wallet-specific cache helper
 */
export const walletCache = cache.namespace('wallet');

/**
 * Price-specific cache helper
 */
export const priceCache = cache.namespace('price');

/**
 * Fee-specific cache helper
 */
export const feeCache = cache.namespace('fees');

// =============================================================================
// Cache Warming
// =============================================================================

/**
 * Cache warming configuration
 */
export interface CacheWarmConfig {
  /** Warm feature flags (default: true) */
  featureFlags?: boolean;
  /** Warm block height (default: true) */
  blockHeight?: boolean;
  /** Warm price data (default: true) */
  priceData?: boolean;
}

/**
 * Warm caches on startup to reduce cold-start latency
 *
 * This pre-populates commonly accessed data into the cache,
 * reducing the number of database/API queries during initial requests.
 */
export async function warmCaches(config: CacheWarmConfig = {}): Promise<{
  warmed: string[];
  failed: string[];
  durationMs: number;
}> {
  const startTime = Date.now();
  const warmed: string[] = [];
  const failed: string[] = [];

  const {
    featureFlags = true,
    blockHeight = true,
    priceData = true,
  } = config;

  const warmingTasks: Promise<void>[] = [];

  // Warm feature flags
  if (featureFlags) {
    warmingTasks.push(
      (async () => {
        try {
          const { featureFlagService } = await import('../featureFlagService');
          const flags = await featureFlagService.getAllFlags();
          if (flags.length > 0) {
            warmed.push('featureFlags');
          } else {
            failed.push('featureFlags');
          }
        } catch (error) {
          log.warn('Failed to warm feature flags cache', { error: getErrorMessage(error) });
          failed.push('featureFlags');
        }
      })()
    );
  }

  // Warm block height
  if (blockHeight) {
    warmingTasks.push(
      (async () => {
        try {
          const { getBlockHeight } = await import('../bitcoin/utils/blockHeight');
          const height = await getBlockHeight();
          if (height > 0) {
            warmed.push('blockHeight');
          } else {
            failed.push('blockHeight');
          }
        } catch (error) {
          log.warn('Failed to warm block height cache', { error: getErrorMessage(error) });
          failed.push('blockHeight');
        }
      })()
    );
  }

  // Warm price data
  if (priceData) {
    warmingTasks.push(
      (async () => {
        try {
          const { getPriceService } = await import('../price');
          const price = await getPriceService().getPrice();
          if (price) {
            warmed.push('priceData');
          } else {
            failed.push('priceData');
          }
        } catch (error) {
          log.warn('Failed to warm price cache', { error: getErrorMessage(error) });
          failed.push('priceData');
        }
      })()
    );
  }

  // Wait for all warming tasks to complete
  await Promise.allSettled(warmingTasks);

  const durationMs = Date.now() - startTime;

  if (warmed.length > 0) {
    log.info(`Cache warming completed in ${durationMs}ms`, {
      warmed,
      failed: failed.length > 0 ? failed : undefined,
    });
  }

  return { warmed, failed, durationMs };
}
