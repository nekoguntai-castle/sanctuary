/**
 * Redis Rate Limiter
 *
 * Sliding window rate limiter implementation using Redis.
 * Uses Lua scripts for atomic operations.
 */

import type Redis from 'ioredis';
import type { IRateLimiter, RateLimitResult } from './types';
import { createLogger } from '../../utils/logger';

const log = createLogger('RATE_LIMIT:REDIS');

/**
 * Lua script for sliding window rate limiting
 *
 * KEYS[1] = rate limit key
 * ARGV[1] = window size in milliseconds
 * ARGV[2] = current timestamp in milliseconds
 * ARGV[3] = limit
 * ARGV[4] = cost (tokens to consume)
 *
 * Returns: [allowed (0/1), remaining, reset_at_ms]
 */
const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])

-- Remove old entries outside the window
local window_start = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current entries
local current = redis.call('ZCARD', key)

-- Calculate remaining
local remaining = math.max(0, limit - current)

-- Check if allowed
local allowed = 0
if current + cost <= limit then
  -- Add one entry per unit of cost, scored with the current timestamp
  -- Use a unique member per entry to allow multiple requests in same ms
  for _ = 1, cost do
    local member = now .. ':' .. redis.call('INCR', key .. ':seq')
    redis.call('ZADD', key, now, member)
  end
  redis.call('EXPIRE', key, math.ceil(window_ms / 1000) + 1)
  redis.call('EXPIRE', key .. ':seq', math.ceil(window_ms / 1000) + 1)
  allowed = 1
  remaining = math.max(0, limit - current - cost)
end

-- Calculate reset time (oldest entry + window)
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_at = now + window_ms
if oldest and #oldest >= 2 then
  reset_at = tonumber(oldest[2]) + window_ms
end

return {allowed, remaining, reset_at}
`;

/**
 * Lua script for checking without consuming
 */
const CHECK_ONLY_SCRIPT = `
local key = KEYS[1]
local window_ms = tonumber(ARGV[1])
local now = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])

-- Remove old entries outside the window
local window_start = now - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

-- Count current entries
local current = redis.call('ZCARD', key)

-- Calculate remaining
local remaining = math.max(0, limit - current)

-- Check if would be allowed
local allowed = 0
if current < limit then
  allowed = 1
end

-- Calculate reset time
local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
local reset_at = now + window_ms
if oldest and #oldest >= 2 then
  reset_at = tonumber(oldest[2]) + window_ms
end

return {allowed, remaining, reset_at}
`;

export class RedisRateLimiter implements IRateLimiter {
  private redis: Redis;
  private keyPrefix: string;

  constructor(redis: Redis, keyPrefix = 'ratelimit:') {
    this.redis = redis;
    this.keyPrefix = keyPrefix;
  }

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    cost = 1
  ): Promise<RateLimitResult> {
    const fullKey = this.keyPrefix + key;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();

    try {
      const result = (await this.redis.eval(
        SLIDING_WINDOW_SCRIPT,
        1,
        fullKey,
        windowMs,
        now,
        limit,
        cost
      )) as [number, number, number];

      const [allowed, remaining, resetAt] = result;

      return {
        allowed: allowed === 1,
        remaining,
        limit,
        resetAt,
        retryAfter: allowed === 1 ? undefined : Math.ceil((resetAt - now) / 1000),
      };
    } catch (error) {
      // On Redis error, fail open (allow the request)
      // This prevents Redis issues from blocking all traffic
      return {
        allowed: true,
        remaining: limit,
        limit,
        resetAt: now + windowMs,
      };
    }
  }

  async check(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<RateLimitResult> {
    const fullKey = this.keyPrefix + key;
    const windowMs = windowSeconds * 1000;
    const now = Date.now();

    try {
      const result = (await this.redis.eval(
        CHECK_ONLY_SCRIPT,
        1,
        fullKey,
        windowMs,
        now,
        limit
      )) as [number, number, number];

      const [allowed, remaining, resetAt] = result;

      return {
        allowed: allowed === 1,
        remaining,
        limit,
        resetAt,
        retryAfter: allowed === 1 ? undefined : Math.ceil((resetAt - now) / 1000),
      };
    } catch (error) {
      return {
        allowed: true,
        remaining: limit,
        limit,
        resetAt: now + windowMs,
      };
    }
  }

  async reset(key: string): Promise<void> {
    const fullKey = this.keyPrefix + key;
    await this.redis.del(fullKey, fullKey + ':seq');
  }

  async getRemaining(
    key: string,
    limit: number,
    windowSeconds: number
  ): Promise<number> {
    const result = await this.check(key, limit, windowSeconds);
    return result.remaining;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch (error) {
      log.debug('Redis health check failed', { error: String(error) });
      return false;
    }
  }

  getType(): string {
    return 'redis';
  }
}
