/**
 * Redis Infrastructure Module
 *
 * Centralized Redis connection management for distributed services.
 * Provides cache, event bus, and WebSocket adapter instances.
 *
 * ## Features
 *
 * - Automatic fallback to in-memory implementations when Redis unavailable
 * - Graceful degradation with logging
 * - Single connection pool shared across services
 * - Proper shutdown handling
 *
 * ## Usage
 *
 * ```typescript
 * import { initializeRedis, getDistributedCache, getDistributedEventBus } from './infrastructure/redis';
 *
 * // At startup
 * await initializeRedis();
 *
 * // Use distributed services
 * const cache = getDistributedCache();
 * const eventBus = getDistributedEventBus();
 * ```
 */

import Redis from 'ioredis';
import { getConfig } from '../config';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { cache as memoryCache, type ICacheService } from '../services/cache/cacheService';
import { RedisCache } from '../services/cache/redisCache';
import { eventBus as localEventBus } from '../events/eventBus';
import { RedisEventBus } from '../events/redisEventBus';

const log = createLogger('INFRA:REDIS');

// =============================================================================
// State
// =============================================================================

let redisClient: Redis | null = null;
let distributedCache: ICacheService | null = null;
let distributedEventBus: RedisEventBus | typeof localEventBus | null = null;
let isInitialized = false;
let isRedisEnabled = false;

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize Redis infrastructure
 *
 * Creates connections for cache and pub/sub if Redis is configured.
 * Falls back to in-memory implementations if Redis is unavailable.
 */
export async function initializeRedis(): Promise<void> {
  if (isInitialized) {
    log.warn('Redis infrastructure already initialized');
    return;
  }

  const config = getConfig();

  if (!config.redis.enabled) {
    log.error('Redis is required but REDIS_URL is not configured');
    throw new Error('Redis is required but REDIS_URL is not set');
  }

  try {
    log.info('Initializing Redis connections', {
      url: config.redis.url.replace(/\/\/.*@/, '//<credentials>@'),
    });

    // Create main Redis client
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 10) {
          log.error('Redis connection failed after 10 retries, using in-memory fallback');
          return null; // Stop retrying
        }
        const delay = Math.min(times * 100, 3000);
        log.warn(`Redis connection retry ${times}, waiting ${delay}ms`);
        return delay;
      },
      reconnectOnError(err) {
        return err.message.includes('READONLY');
      },
    });

    // Wait for connection to be ready (not just connected)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 10000);

      redisClient!.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      redisClient!.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Create distributed cache
    distributedCache = new RedisCache(redisClient);

    // Create distributed event bus (needs separate connections for pub/sub)
    const publisher = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

    const subscriber = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

    await Promise.all([
      new Promise<void>((resolve) => publisher.once('ready', resolve)),
      new Promise<void>((resolve) => subscriber.once('ready', resolve)),
    ]);

    distributedEventBus = new RedisEventBus(publisher, subscriber);

    isRedisEnabled = true;
    isInitialized = true;

    log.info('Redis infrastructure initialized successfully', {
      cache: 'redis',
      eventBus: 'redis',
    });
  } catch (error) {
    log.error('Failed to initialize Redis', { error: getErrorMessage(error) });

    // Clean up partial connections
    if (redisClient) {
      await redisClient.quit().catch((e) => {
        log.debug('Redis quit failed during error cleanup (non-critical)', { error: String(e) });
      });
      redisClient = null;
    }
    isRedisEnabled = false;
    isInitialized = false;
    throw error;
  }
}

// =============================================================================
// Accessors
// =============================================================================

/**
 * Get the distributed cache instance
 *
 * Returns Redis cache if available, otherwise in-memory cache.
 */
export function getDistributedCache(): ICacheService {
  if (!isInitialized) {
    log.warn('Redis not initialized, returning memory cache');
    return memoryCache;
  }
  return distributedCache!;
}

/**
 * Get a namespaced distributed cache
 */
export function getNamespacedCache(namespace: string): ICacheService {
  return getDistributedCache().namespace(namespace);
}

/**
 * Get the distributed event bus instance
 *
 * Returns Redis event bus if available, otherwise local event bus.
 */
export function getDistributedEventBus(): RedisEventBus | typeof localEventBus {
  if (!isInitialized) {
    log.warn('Redis not initialized, returning local event bus');
    return localEventBus;
  }
  return distributedEventBus!;
}

/**
 * Check if Redis is enabled and connected
 */
export function isRedisConnected(): boolean {
  return isRedisEnabled && redisClient?.status === 'ready';
}

/**
 * Get Redis client for advanced operations (null if not connected)
 */
export function getRedisClient(): Redis | null {
  return redisClient;
}

// =============================================================================
// Shutdown
// =============================================================================

/**
 * Shutdown Redis infrastructure gracefully
 */
export async function shutdownRedis(): Promise<void> {
  if (!isInitialized) {
    return;
  }

  log.info('Shutting down Redis infrastructure');

  try {
    // Shutdown event bus first (has pub/sub connections)
    if (distributedEventBus && 'shutdown' in distributedEventBus) {
      await (distributedEventBus as RedisEventBus).shutdown();
    }

    // Shutdown main client
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
    }

    isRedisEnabled = false;
    isInitialized = false;

    log.info('Redis infrastructure shutdown complete');
  } catch (error) {
    log.error('Error during Redis shutdown', { error: getErrorMessage(error) });
  }
}

// =============================================================================
// Health Check
// =============================================================================

/**
 * Check Redis health
 */
export async function checkRedisHealth(): Promise<{
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  error?: string;
}> {
  if (!isRedisEnabled || !redisClient) {
    return { status: 'unhealthy', error: 'Redis not initialized' };
  }

  try {
    const start = Date.now();
    await redisClient.ping();
    const latencyMs = Date.now() - start;

    return {
      status: latencyMs < 100 ? 'healthy' : 'degraded',
      latencyMs,
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: getErrorMessage(error, 'Unknown error'),
    };
  }
}
