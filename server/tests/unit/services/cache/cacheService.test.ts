/**
 * Cache Service Tests
 *
 * Tests for in-memory cache with TTL support, namespacing, and pattern deletion.
 */

import { vi, beforeEach, afterEach } from 'vitest';

// Mock logger
vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock metrics
vi.mock('../../../../src/observability/metrics', () => ({
  cacheOperationsTotal: {
    inc: vi.fn(),
  },
}));

import {
  cache,
  createNamespacedCache,
  walletCache,
  priceCache,
  feeCache,
  CacheKeys,
  CacheTTL,
} from '../../../../src/services/cache/cacheService';
import { cacheOperationsTotal } from '../../../../src/observability/metrics';

describe('Cache Service', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear the cache before each test
    await cache.clear();
  });

  describe('Basic Operations', () => {
    describe('get/set', () => {
      it('should store and retrieve a value', async () => {
        await cache.set('test-key', 'test-value');
        const result = await cache.get<string>('test-key');

        expect(result).toBe('test-value');
      });

      it('should return null for non-existent key', async () => {
        const result = await cache.get<string>('non-existent');

        expect(result).toBeNull();
        expect(cacheOperationsTotal.inc).toHaveBeenCalledWith({ type: 'get', result: 'miss' });
      });

      it('should increment metrics on cache hit', async () => {
        await cache.set('hit-key', 'value');
        await cache.get<string>('hit-key');

        expect(cacheOperationsTotal.inc).toHaveBeenCalledWith({ type: 'get', result: 'hit' });
      });

      it('should increment metrics on cache set', async () => {
        await cache.set('new-key', 'value');

        expect(cacheOperationsTotal.inc).toHaveBeenCalledWith({ type: 'set', result: 'success' });
      });

      it('should store complex objects', async () => {
        const obj = { name: 'test', value: 123, nested: { a: 1 } };
        await cache.set('object-key', obj);
        const result = await cache.get<typeof obj>('object-key');

        expect(result).toEqual(obj);
      });

      it('should store arrays', async () => {
        const arr = [1, 2, 3, 4, 5];
        await cache.set('array-key', arr);
        const result = await cache.get<typeof arr>('array-key');

        expect(result).toEqual(arr);
      });
    });

    describe('TTL expiration', () => {
      it('should expire entries after TTL', async () => {
        vi.useFakeTimers();

        await cache.set('expire-key', 'value', 1); // 1 second TTL

        // Should exist immediately
        let result = await cache.get<string>('expire-key');
        expect(result).toBe('value');

        // Advance time past TTL
        vi.advanceTimersByTime(1500); // 1.5 seconds

        result = await cache.get<string>('expire-key');
        expect(result).toBeNull();

        vi.useRealTimers();
      });

      it('should not expire before TTL', async () => {
        vi.useFakeTimers();

        await cache.set('not-expired', 'value', 10); // 10 second TTL

        vi.advanceTimersByTime(5000); // 5 seconds

        const result = await cache.get<string>('not-expired');
        expect(result).toBe('value');

        vi.useRealTimers();
      });
    });

    describe('delete', () => {
      it('should delete an existing key', async () => {
        await cache.set('delete-me', 'value');
        const deleted = await cache.delete('delete-me');

        expect(deleted).toBe(true);
        expect(await cache.get('delete-me')).toBeNull();
        expect(cacheOperationsTotal.inc).toHaveBeenCalledWith({ type: 'delete', result: 'success' });
      });

      it('should return false for non-existent key', async () => {
        const deleted = await cache.delete('never-existed');

        expect(deleted).toBe(false);
      });
    });

    describe('deletePattern', () => {
      it('should delete keys matching pattern', async () => {
        await cache.set('wallet:1', 'a');
        await cache.set('wallet:2', 'b');
        await cache.set('wallet:3', 'c');
        await cache.set('other:1', 'd');

        const count = await cache.deletePattern('wallet:*');

        expect(count).toBe(3);
        expect(await cache.get('wallet:1')).toBeNull();
        expect(await cache.get('wallet:2')).toBeNull();
        expect(await cache.get('wallet:3')).toBeNull();
        expect(await cache.get('other:1')).toBe('d');
      });

      it('should return 0 when no keys match', async () => {
        await cache.set('key1', 'value');

        const count = await cache.deletePattern('nomatch:*');

        expect(count).toBe(0);
      });

      it('should treat non-wildcard regex characters literally', async () => {
        await cache.set('wallet.1', 'dot');
        await cache.set('walletx1', 'plain');
        await cache.set('wallet.2', 'dot-two');

        const count = await cache.deletePattern('wallet.*');

        expect(count).toBe(2);
        expect(await cache.get('wallet.1')).toBeNull();
        expect(await cache.get('wallet.2')).toBeNull();
        expect(await cache.get('walletx1')).toBe('plain');
      });
    });

    describe('has', () => {
      it('should return true for existing key', async () => {
        await cache.set('exists', 'value');

        const exists = await cache.has('exists');

        expect(exists).toBe(true);
      });

      it('should return false for non-existent key', async () => {
        const exists = await cache.has('does-not-exist');

        expect(exists).toBe(false);
      });

      it('should return false for expired key', async () => {
        vi.useFakeTimers();

        await cache.set('will-expire', 'value', 1);
        vi.advanceTimersByTime(2000);

        const exists = await cache.has('will-expire');
        expect(exists).toBe(false);

        vi.useRealTimers();
      });
    });

    describe('clear', () => {
      it('should clear all entries', async () => {
        await cache.set('key1', 'value1');
        await cache.set('key2', 'value2');
        await cache.set('key3', 'value3');

        await cache.clear();

        expect(await cache.get('key1')).toBeNull();
        expect(await cache.get('key2')).toBeNull();
        expect(await cache.get('key3')).toBeNull();
      });
    });

    describe('eviction and cleanup lifecycle', () => {
      it('should evict oldest entries when max size is reached', async () => {
        const scoped = cache.namespace('evict') as any;
        const originalMaxSize = scoped.maxSize;
        scoped.maxSize = 2;

        await scoped.set('a', 'value-a');
        await scoped.set('b', 'value-b');
        await scoped.set('c', 'value-c');

        expect(await scoped.get('a')).toBeNull();
        expect(await scoped.get('b')).toBe('value-b');
        expect(await scoped.get('c')).toBe('value-c');

        scoped.maxSize = originalMaxSize;
      });

      it('should evict in batches when cache size requires multiple removals', async () => {
        const scoped = cache.namespace('batch-evict') as any;
        const originalMaxSize = scoped.maxSize;
        scoped.maxSize = 40;

        for (let i = 0; i < 40; i++) {
          await scoped.set(`k-${i}`, `v-${i}`);
        }
        await scoped.set('k-overflow', 'v-overflow');

        expect(await scoped.get('k-0')).toBeNull();
        expect(await scoped.get('k-overflow')).toBe('v-overflow');
        scoped.maxSize = originalMaxSize;
      });

      it('should remove expired entries during periodic cleanup and allow stop()', async () => {
        vi.useFakeTimers();

        const internalCache = cache as any;
        internalCache.stop();
        internalCache.startCleanup();

        await cache.set('cleanup-expired', 'expired', 1);
        await cache.set('cleanup-fresh', 'fresh', 120);

        await vi.advanceTimersByTimeAsync(1500);
        await vi.advanceTimersByTimeAsync(60000);

        expect(await cache.get('cleanup-expired')).toBeNull();
        expect(await cache.get('cleanup-fresh')).toBe('fresh');

        internalCache.stop();
        expect(internalCache.cleanupInterval).toBeNull();

        vi.useRealTimers();
      });

      it('should no-op cleanup bookkeeping when no entries are expired', async () => {
        vi.useFakeTimers();

        const internalCache = cache as any;
        internalCache.stop();
        internalCache.startCleanup();

        await cache.set('cleanup-not-expired', 'value', 300);
        await vi.advanceTimersByTimeAsync(60000);

        expect(await cache.get('cleanup-not-expired')).toBe('value');

        internalCache.stop();
        internalCache.stop();
        vi.useRealTimers();
      });
    });

    describe('getStats', () => {
      it('should track cache statistics', async () => {
        await cache.set('stat-key', 'value');
        await cache.get('stat-key'); // hit
        await cache.get('missing-key'); // miss

        const stats = cache.getStats();

        expect(stats.sets).toBeGreaterThan(0);
        expect(stats.hits).toBeGreaterThan(0);
        expect(stats.misses).toBeGreaterThan(0);
      });
    });
  });

  describe('Namespacing', () => {
    it('should create namespaced cache', () => {
      const namespaced = cache.namespace('myns');

      expect(namespaced).toBeDefined();
    });

    it('should prefix keys in namespace', async () => {
      const namespaced = cache.namespace('ns1');
      await namespaced.set('key', 'value');

      // Direct access with full key should work
      const directResult = await cache.get<string>('ns1:key');
      expect(directResult).toBe('value');
    });

    it('should isolate namespaces', async () => {
      const ns1 = cache.namespace('ns1');
      const ns2 = cache.namespace('ns2');

      await ns1.set('key', 'value1');
      await ns2.set('key', 'value2');

      expect(await ns1.get('key')).toBe('value1');
      expect(await ns2.get('key')).toBe('value2');
    });

    it('should support nested namespaces', async () => {
      const level1 = cache.namespace('l1');
      const level2 = level1.namespace('l2');

      await level2.set('key', 'nested-value');

      const result = await cache.get<string>('l1:l2:key');
      expect(result).toBe('nested-value');
    });

    it('should clear only namespaced entries', async () => {
      const namespaced = cache.namespace('clearns');
      await namespaced.set('a', 1);
      await namespaced.set('b', 2);
      await cache.set('outside', 3);

      await namespaced.clear();

      expect(await namespaced.get('a')).toBeNull();
      expect(await namespaced.get('b')).toBeNull();
      expect(await cache.get('outside')).toBe(3);
    });
  });

  describe('Factory Functions', () => {
    describe('createNamespacedCache', () => {
      it('should create a namespaced cache instance', async () => {
        const myCache = createNamespacedCache('mycache');
        await myCache.set('test', 'value');

        const result = await myCache.get<string>('test');
        expect(result).toBe('value');
      });
    });

    describe('Pre-configured caches', () => {
      it('should have walletCache namespace', async () => {
        await walletCache.set('balance', 100);
        const result = await cache.get<number>('wallet:balance');
        expect(result).toBe(100);
      });

      it('should have priceCache namespace', async () => {
        await priceCache.set('btc', 50000);
        const result = await cache.get<number>('price:btc');
        expect(result).toBe(50000);
      });

      it('should have feeCache namespace', async () => {
        await feeCache.set('mainnet', 10);
        const result = await cache.get<number>('fees:mainnet');
        expect(result).toBe(10);
      });
    });
  });

  describe('CacheKeys', () => {
    it('should generate wallet balance key', () => {
      const key = CacheKeys.walletBalance('abc123');
      expect(key).toBe('wallet:balance:abc123');
    });

    it('should generate wallet info key', () => {
      const key = CacheKeys.walletInfo('abc123');
      expect(key).toBe('wallet:info:abc123');
    });

    it('should generate btc price key', () => {
      const key = CacheKeys.btcPrice();
      expect(key).toBe('price:btc:usd');
    });

    it('should generate price history key', () => {
      const key = CacheKeys.priceHistory(7);
      expect(key).toBe('price:history:7');
    });

    it('should generate fee estimates key', () => {
      const key = CacheKeys.feeEstimates('mainnet');
      expect(key).toBe('fees:mainnet');
    });

    it('should generate user preferences key', () => {
      const key = CacheKeys.userPreferences('user-123');
      expect(key).toBe('user:prefs:user-123');
    });

    it('should generate block height key', () => {
      const key = CacheKeys.blockHeight('mainnet');
      expect(key).toBe('block:height:mainnet');
    });
  });

  describe('CacheTTL', () => {
    it('should have correct TTL values', () => {
      expect(CacheTTL.balance).toBe(30);
      expect(CacheTTL.blockHeight).toBe(10);
      expect(CacheTTL.feeEstimates).toBe(60);
      expect(CacheTTL.btcPrice).toBe(60);
      expect(CacheTTL.userPreferences).toBe(300);
      expect(CacheTTL.priceHistory).toBe(3600);
      expect(CacheTTL.walletInfo).toBe(3600);
    });
  });
});
