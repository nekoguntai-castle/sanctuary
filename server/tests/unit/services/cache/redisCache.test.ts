import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';

const hoisted = vi.hoisted(() => ({
  redisCtorImpl: vi.fn(),
}));

class MockRedis extends EventEmitter {
  get = vi.fn(async () => null);
  setex = vi.fn(async () => 'OK');
  del = vi.fn(async (..._keys: string[]) => 0);
  scan = vi.fn(async () => ['0', []] as [string, string[]]);
  exists = vi.fn(async () => 0);

  constructor() {
    super();
  }
}

function RedisCtor(...args: unknown[]) {
  return hoisted.redisCtorImpl(...args);
}

vi.mock('ioredis', () => ({
  __esModule: true,
  default: RedisCtor,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { RedisCache, createRedisCache, createRedisPubSub } from '../../../../src/services/cache/redisCache';

const makeRedis = () => new MockRedis() as unknown as InstanceType<typeof MockRedis>;

describe('RedisCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('get returns value and tracks hit/miss', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.get.mockResolvedValueOnce(null);
    expect(await cache.get('a')).toBeNull();
    expect(cache.getStats().misses).toBe(1);

    redis.get.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    expect(await cache.get('b')).toEqual({ ok: true });
    expect(cache.getStats().hits).toBe(1);
  });

  it('get returns null and tracks miss on parse or redis errors', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.get.mockResolvedValueOnce('{bad-json');
    expect(await cache.get('broken')).toBeNull();

    redis.get.mockRejectedValueOnce(new Error('redis down'));
    expect(await cache.get('broken2')).toBeNull();
    expect(cache.getStats().misses).toBe(2);
  });

  it('set uses default ttl and increments stats', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test', 42);

    await cache.set('a', { value: 1 });
    expect(redis.setex).toHaveBeenCalledWith('sanctuary:test:a', 42, JSON.stringify({ value: 1 }));
    expect(cache.getStats().sets).toBe(1);
  });

  it('set swallows redis errors', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test', 42);

    redis.setex.mockRejectedValueOnce(new Error('write failed'));
    await expect(cache.set('a', { value: 1 })).resolves.toBeUndefined();
    expect(cache.getStats().sets).toBe(0);
  });

  it('delete returns true when key removed', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.del.mockResolvedValueOnce(1);
    expect(await cache.delete('a')).toBe(true);
    expect(cache.getStats().deletes).toBe(1);
  });

  it('delete returns false when key missing or redis errors', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.del.mockResolvedValueOnce(0);
    expect(await cache.delete('a')).toBe(false);

    redis.del.mockRejectedValueOnce(new Error('delete failed'));
    expect(await cache.delete('b')).toBe(false);
  });

  it('deletePattern scans and deletes matching keys', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.scan
      .mockResolvedValueOnce(['1', ['k1', 'k2']])
      .mockResolvedValueOnce(['0', ['k3']]);
    redis.del
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);

    const deleted = await cache.deletePattern('user:*');
    expect(deleted).toBe(3);
    expect(redis.scan).toHaveBeenNthCalledWith(1, '0', 'MATCH', 'sanctuary:test:user:*', 'COUNT', 100);
    expect(cache.getStats().deletes).toBe(3);
  });

  it('deletePattern returns 0 on redis errors', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.scan.mockRejectedValueOnce(new Error('scan failed'));
    await expect(cache.deletePattern('user:*')).resolves.toBe(0);
  });

  it('deletePattern returns 0 when scan finds no keys', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.scan.mockResolvedValueOnce(['0', []]);
    const deleted = await cache.deletePattern('user:*');

    expect(deleted).toBe(0);
    expect(redis.del).not.toHaveBeenCalled();
    expect(cache.getStats().deletes).toBe(0);
  });

  it('has returns false on redis error', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.exists.mockRejectedValueOnce(new Error('boom'));
    expect(await cache.has('a')).toBe(false);
  });

  it('has returns true when key exists', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    redis.exists.mockResolvedValueOnce(1);
    expect(await cache.has('a')).toBe(true);
  });

  it('clear delegates to deletePattern and handles errors', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'test');

    const deletePatternSpy = vi.spyOn(cache, 'deletePattern');
    deletePatternSpy.mockResolvedValueOnce(2);
    await expect(cache.clear()).resolves.toBeUndefined();
    expect(deletePatternSpy).toHaveBeenCalledWith('*');

    deletePatternSpy.mockRejectedValueOnce(new Error('clear failed'));
    await expect(cache.clear()).resolves.toBeUndefined();
  });

  it('namespace shares stats and prefixes keys', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'base');
    const child = cache.namespace('child') as RedisCache;

    redis.get.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    await child.get('a');

    expect(redis.get).toHaveBeenCalledWith('sanctuary:base:child:a');
    expect(cache.getStats().hits).toBe(1);
    expect(child.getStats().hits).toBe(1);
  });

  it('namespace uses provided prefix directly when parent prefix is empty', async () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'base');
    (cache as any).prefix = '';
    const child = cache.namespace('child') as RedisCache;

    redis.get.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    await child.get('a');

    expect(redis.get).toHaveBeenCalledWith('child:a');
  });

  it('getClient returns underlying redis instance', () => {
    const redis = makeRedis();
    const cache = new RedisCache(redis as any, 'base');
    expect(cache.getClient()).toBe(redis);
  });
});

describe('createRedisCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves on connect', async () => {
    const redis = makeRedis();
    hoisted.redisCtorImpl.mockImplementation(() => redis);

    const promise = createRedisCache('redis://localhost:6379');
    const options = hoisted.redisCtorImpl.mock.calls[0][1] as any;
    expect(options.retryStrategy(2)).toBe(200);
    expect(options.retryStrategy(100)).toBe(3000);
    expect(options.reconnectOnError(new Error('READONLY You can only write against primary'))).toBe(true);
    expect(options.reconnectOnError(new Error('ECONNREFUSED'))).toBe(false);

    redis.emit('connect');
    const cache = await promise;

    expect(cache).toBeInstanceOf(RedisCache);
  });

  it('rejects on error', async () => {
    const redis = makeRedis();
    hoisted.redisCtorImpl.mockImplementation(() => redis);

    const promise = createRedisCache('redis://localhost:6379');
    redis.emit('error', new Error('nope'));

    await expect(promise).rejects.toThrow('nope');
  });
});

describe('createRedisPubSub', () => {
  it('creates publisher and subscriber clients', () => {
    hoisted.redisCtorImpl.mockImplementation(() => makeRedis());
    const { publisher, subscriber } = createRedisPubSub('redis://localhost:6379');
    expect(publisher).toBeDefined();
    expect(subscriber).toBeDefined();
    expect(hoisted.redisCtorImpl).toHaveBeenCalledTimes(2);

    const publisherOptions = hoisted.redisCtorImpl.mock.calls[0][1] as any;
    const subscriberOptions = hoisted.redisCtorImpl.mock.calls[1][1] as any;
    expect(publisherOptions.retryStrategy(2)).toBe(200);
    expect(subscriberOptions.retryStrategy(30)).toBe(3000);
  });
});
