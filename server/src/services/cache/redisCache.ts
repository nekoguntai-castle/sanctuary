/**
 * Redis Cache Implementation
 *
 * Distributed cache using Redis for horizontal scaling.
 * Implements ICacheService interface for drop-in replacement of MemoryCache.
 *
 * ## Features
 *
 * - TTL-based expiration (native Redis SETEX)
 * - Pattern-based deletion (SCAN + DEL)
 * - Namespace prefixing for isolation
 * - Connection pooling via ioredis
 * - Automatic reconnection
 *
 * ## Usage
 *
 * ```typescript
 * import { createRedisCache } from './redisCache';
 *
 * const cache = await createRedisCache('redis://localhost:6379');
 * await cache.set('key', { value: 1 }, 60);
 * const data = await cache.get('key');
 * ```
 */

import Redis from 'ioredis';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import type { ICacheService, CacheStats } from './cacheService';

const log = createLogger('CACHE:SVC_REDIS');

/**
 * Redis-backed cache with TTL support
 */
export class RedisCache implements ICacheService {
  private redis: Redis;
  private prefix: string;
  private defaultTtl: number;
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    size: 0,
  };

  constructor(redis: Redis, prefix: string = '', defaultTtl: number = 300) {
    this.redis = redis;
    this.prefix = prefix ? `sanctuary:${prefix}` : 'sanctuary';
    this.defaultTtl = defaultTtl;
  }

  private getFullKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const fullKey = this.getFullKey(key);
      const value = await this.redis.get(fullKey);

      if (value === null) {
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return JSON.parse(value) as T;
    } catch (error) {
      log.error('Redis get error', { key, error: getErrorMessage(error) });
      this.stats.misses++;
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const fullKey = this.getFullKey(key);
      const ttl = ttlSeconds ?? this.defaultTtl;
      const serialized = JSON.stringify(value);

      await this.redis.setex(fullKey, ttl, serialized);
      this.stats.sets++;
    } catch (error) {
      log.error('Redis set error', { key, error: getErrorMessage(error) });
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const fullKey = this.getFullKey(key);
      const result = await this.redis.del(fullKey);
      if (result > 0) {
        this.stats.deletes++;
        return true;
      }
      return false;
    } catch (error) {
      log.error('Redis delete error', { key, error: getErrorMessage(error) });
      return false;
    }
  }

  async deletePattern(pattern: string): Promise<number> {
    try {
      const fullPattern = this.getFullKey(pattern);
      let count = 0;
      let cursor = '0';

      // Use SCAN to safely iterate over keys matching pattern
      do {
        const [newCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          fullPattern.replace(/\*/g, '*'),
          'COUNT',
          100
        );
        cursor = newCursor;

        if (keys.length > 0) {
          const deleted = await this.redis.del(...keys);
          count += deleted;
        }
      } while (cursor !== '0');

      if (count > 0) {
        this.stats.deletes += count;
        log.debug(`Deleted ${count} keys matching pattern`, { pattern });
      }

      return count;
    } catch (error) {
      log.error('Redis deletePattern error', { pattern, error: getErrorMessage(error) });
      return 0;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const fullKey = this.getFullKey(key);
      const exists = await this.redis.exists(fullKey);
      return exists === 1;
    } catch (error) {
      log.error('Redis has error', { key, error: getErrorMessage(error) });
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await this.deletePattern('*');
      log.info('Cache cleared', { prefix: this.prefix });
    } catch (error) {
      log.error('Redis clear error', { error: getErrorMessage(error) });
    }
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  namespace(prefix: string): ICacheService {
    const newPrefix = this.prefix ? `${this.prefix}:${prefix}` : prefix;
    const namespaced = new RedisCache(this.redis, '', this.defaultTtl);
    namespaced.prefix = newPrefix;
    namespaced.stats = this.stats; // Share stats with parent
    return namespaced;
  }

  /**
   * Get the underlying Redis client for advanced operations
   */
  getClient(): Redis {
    return this.redis;
  }
}

/**
 * Create a Redis cache instance
 */
export async function createRedisCache(url: string): Promise<RedisCache> {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 100, 3000);
      log.warn(`Redis connection retry ${times}, waiting ${delay}ms`);
      return delay;
    },
    reconnectOnError(err) {
      const targetError = 'READONLY';
      if (err.message.includes(targetError)) {
        return true; // Reconnect on READONLY error (failover)
      }
      return false;
    },
  });

  // Wait for connection
  await new Promise<void>((resolve, reject) => {
    redis.once('connect', () => {
      log.info('Redis connected', { url: url.replace(/\/\/.*@/, '//<credentials>@') });
      resolve();
    });
    redis.once('error', (err) => {
      log.error('Redis connection error', { error: err.message });
      reject(err);
    });
  });

  return new RedisCache(redis);
}

/**
 * Create a Redis client for pub/sub (separate connection required)
 */
export function createRedisPubSub(url: string): { publisher: Redis; subscriber: Redis } {
  const publisher = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  const subscriber = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      return Math.min(times * 100, 3000);
    },
  });

  return { publisher, subscriber };
}
