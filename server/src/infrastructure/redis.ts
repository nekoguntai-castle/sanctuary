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

import { createHmac, randomBytes } from 'node:crypto';
import Redis from 'ioredis';
import type { ConnectionOptions } from 'bullmq';
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
// Last time the persistent main-client error listener logged (0 = none this outage)
let lastClientErrorLoggedAt = 0;
const CLIENT_ERROR_LOG_INTERVAL_MS = 30_000;
const REDIS_READY_TIMEOUT_MS = 10_000;

function logClientError(err: Error): void {
  const now = Date.now();
  if (lastClientErrorLoggedAt === 0) {
    lastClientErrorLoggedAt = now;
    log.warn('Redis client error', { error: getErrorMessage(err) });
  } else if (now - lastClientErrorLoggedAt >= CLIENT_ERROR_LOG_INTERVAL_MS) {
    lastClientErrorLoggedAt = now;
    log.debug('Redis client error (throttled)', { error: getErrorMessage(err) });
  }
}

function waitForReady(client: Redis, timeoutMs: number): Promise<void> {
  if (client.status === 'ready') {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      clearTimeout(timeout);
      client.off('error', onInitError);
      resolve();
    };
    const onInitError = (err: Error) => {
      clearTimeout(timeout);
      client.off('ready', onReady);
      reject(err);
    };
    const timeout = setTimeout(() => {
      client.off('ready', onReady);
      client.off('error', onInitError);
      reject(new Error('Redis connection timeout'));
    }, timeoutMs);
    timeout.unref?.();

    client.once('ready', onReady);
    client.on('error', onInitError);
  });
}

function disconnectSafely(client: Redis | null): void {
  if (!client) return;
  if (client.listenerCount('error') === 0) {
    client.on('error', logClientError);
  }
  client.disconnect();
}

/**
 * Extract BullMQ connection options from a live ioredis client, preserving
 * ACL username and TLS settings alongside host, port, password, and db.
 */
export function getBullMqConnectionOptions(
  redis: Pick<Redis, 'options'>,
): ConnectionOptions {
  return {
    host: redis.options.host,
    port: redis.options.port,
    ...(redis.options.username !== undefined ? { username: redis.options.username } : {}),
    password: redis.options.password,
    db: redis.options.db,
    ...(redis.options.tls !== undefined ? { tls: redis.options.tls } : {}),
  };
}

// Callback and native TLS context identities are process-local, as are the cached queues.
const connectionKeySecret = randomBytes(32);
const tlsReferenceIds = new WeakMap<object, number>();
let nextTlsReferenceId = 0;

function tlsReferenceId(value: object): number {
  let id = tlsReferenceIds.get(value);
  if (id === undefined) {
    id = ++nextTlsReferenceId;
    tlsReferenceIds.set(value, id);
  }
  return id;
}

function connectionKeyValue(value: unknown): unknown {
  if (typeof value === 'function') return ['reference', tlsReferenceId(value)];
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array) return ['bytes', Buffer.from(value).toString('base64')];
  if (Array.isArray(value)) return ['array', value.map(connectionKeyValue)];
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return ['reference', tlsReferenceId(value)];
  const record = value as Record<string, unknown>;
  return ['object', Object.keys(record).sort().filter(key => record[key] !== undefined)
    .map(key => [key, connectionKeyValue(record[key])])];
}

/** Compare the forwarded options, including credentials and TLS, without retaining them in queue keys. */
export function getBullMqConnectionKey(connection: ConnectionOptions): string {
  return createHmac('sha256', connectionKeySecret)
    .update(JSON.stringify(connectionKeyValue(connection)))
    .digest('hex');
}

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

  let publisher: Redis | null = null;
  let subscriber: Redis | null = null;

  try {
    log.info('Initializing Redis connections', {
      url: config.redis.url.replace(/\/\/.*@/, '//<credentials>@'),
    });

    // Create main Redis client
    redisClient = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        // Never stop retrying: a null return would leave the client in `end` until restart.
        const delay = Math.min(times * 100, 3000);
        if (times <= 10) {
          log.warn(`Redis connection retry ${times}, waiting ${delay}ms`);
        } else if (times % 20 === 0) {
          log.error(`Redis still unreachable after ${times} retries; retrying every 3s`);
        }
        return delay;
      },
      reconnectOnError(err) {
        return err.message.includes('READONLY');
      },
    });

    // Wait for connection to be ready (not just connected)
    await waitForReady(redisClient, REDIS_READY_TIMEOUT_MS);

    // Persistent listener: keeps reconnect failures in structured, throttled logs
    redisClient.on('ready', () => {
      lastClientErrorLoggedAt = 0;
    });
    redisClient.on('error', logClientError);

    // Create distributed cache
    distributedCache = new RedisCache(redisClient);

    // Create distributed event bus (needs separate connections for pub/sub)
    publisher = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

    subscriber = new Redis(config.redis.url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        return Math.min(times * 100, 3000);
      },
    });

    await Promise.all([
      waitForReady(publisher, REDIS_READY_TIMEOUT_MS),
      waitForReady(subscriber, REDIS_READY_TIMEOUT_MS),
    ]);

    publisher.on('error', logClientError);
    subscriber.on('error', logClientError);

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
    // disconnect(), not quit(): retries are unbounded, and a QUIT queued while
    // reconnecting would leave the client retrying forever.
    disconnectSafely(publisher);
    publisher = null;
    disconnectSafely(subscriber);
    subscriber = null;
    disconnectSafely(redisClient);
    redisClient = null;
    distributedCache = null;
    distributedEventBus = null;
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

  const eventBusToClose = distributedEventBus;
  const clientToClose = redisClient;

  try {
    // Shutdown event bus first (has pub/sub connections)
    if (eventBusToClose && 'shutdown' in eventBusToClose) {
      await (eventBusToClose as RedisEventBus).shutdown();
    }

    // Shutdown main client
    if (clientToClose && redisClient === clientToClose) {
      await clientToClose.quit();
    }

    log.info('Redis infrastructure shutdown complete');
  } catch (error) {
    log.error('Error during Redis shutdown', { error: getErrorMessage(error) });
    if (clientToClose && redisClient === clientToClose) {
      disconnectSafely(clientToClose);
    }
  } finally {
    if (redisClient === clientToClose) {
      redisClient = null;
    }
    if (distributedEventBus === eventBusToClose) {
      distributedEventBus = null;
    }
    distributedCache = null;
    isRedisEnabled = false;
    isInitialized = false;
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
