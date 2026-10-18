import { afterAll, beforeAll, expect, it, vi } from 'vitest';
/**
 * Redis rate limiter charges a request's full cost
 *
 * Runs the real consume Lua script against Redis: a request of cost N must
 * occupy N slots of the sliding window, not one. Mocked redis.eval and the
 * in-memory limiter cannot observe the script.
 *
 * Requires Redis (REDIS_URL). Skipped without REDIS_URL unless
 * SANCTUARY_REQUIRE_REDIS_INTEGRATION=true, which fails at collection.
 */

import type Redis from 'ioredis';
import { getRedisClient, initializeRedis, shutdownRedis } from '../../../src/infrastructure/redis';
import { RedisRateLimiter } from '../../../src/services/rateLimiting/redisRateLimiter';
import { describeWithRedis } from '../setup/redis';

vi.setConfig({ testTimeout: 30000 });

const KEY_PREFIX = 'itest:ratelimit-cost:';
const KEY = 'batch';

describeWithRedis('Redis rate limiter cost accounting', () => {
  let redis: Redis;
  let limiter: RedisRateLimiter;

  beforeAll(async () => {
    await initializeRedis();
    const client = getRedisClient();
    if (!client) throw new Error('Redis client unavailable');
    redis = client;
    limiter = new RedisRateLimiter(redis, KEY_PREFIX);
    await limiter.reset(KEY);
  });

  afterAll(async () => {
    await limiter.reset(KEY);
    await shutdownRedis();
  });

  it('adds one window entry per unit of cost and refuses a request that no longer fits', async () => {
    const first = await limiter.consume(KEY, 10, 60, 5);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(5);
    expect(await redis.zcard(KEY_PREFIX + KEY)).toBe(5);

    const second = await limiter.consume(KEY, 10, 60, 6);
    expect(second.allowed).toBe(false);
    expect(await redis.zcard(KEY_PREFIX + KEY)).toBe(5);

    const third = await limiter.consume(KEY, 10, 60, 5);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    expect(await redis.zcard(KEY_PREFIX + KEY)).toBe(10);
  });
});
