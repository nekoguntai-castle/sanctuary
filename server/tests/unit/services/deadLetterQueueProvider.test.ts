import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  isRedisConnected: vi.fn(),
}));

vi.mock('../../../src/infrastructure', () => ({
  getRedisClient: mocks.getRedisClient,
  isRedisConnected: mocks.isRedisConnected,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('default dead letter store provider', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('creates and reuses a Redis store for the connected client identity', async () => {
    const redis = {
      eval: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
    };
    mocks.getRedisClient.mockReturnValue(redis);
    mocks.isRedisConnected.mockReturnValue(true);
    const { deadLetterQueue } = await import(
      '../../../src/services/deadLetterQueue'
    );

    await deadLetterQueue.start();
    await deadLetterQueue.loadFromRedis();

    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it('replaces the Redis store when the connected client identity changes', async () => {
    const firstRedis = {
      eval: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
    };
    const secondRedis = {
      eval: vi.fn().mockResolvedValue(0),
      get: vi.fn(),
    };
    mocks.getRedisClient
      .mockReturnValueOnce(firstRedis)
      .mockReturnValue(secondRedis);
    mocks.isRedisConnected.mockReturnValue(true);
    const { deadLetterQueue } = await import(
      '../../../src/services/deadLetterQueue'
    );

    await deadLetterQueue.start();
    await deadLetterQueue.loadFromRedis();

    expect(firstRedis.eval).toHaveBeenCalledTimes(1);
    expect(secondRedis.eval).toHaveBeenCalledTimes(1);
  });

  it('uses the process-local test store when Redis is absent or disconnected', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    mocks.getRedisClient.mockReturnValueOnce(null).mockReturnValue({});
    mocks.isRedisConnected.mockReturnValue(false);
    const { deadLetterQueue } = await import(
      '../../../src/services/deadLetterQueue'
    );

    await expect(deadLetterQueue.start()).resolves.toBeUndefined();
    await expect(deadLetterQueue.loadFromRedis()).resolves.toBeUndefined();
  });

  it('fails closed outside tests when Redis is unavailable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    mocks.getRedisClient.mockReturnValue(null);
    mocks.isRedisConnected.mockReturnValue(false);
    const { deadLetterQueue } = await import(
      '../../../src/services/deadLetterQueue'
    );

    await expect(deadLetterQueue.start()).rejects.toThrow(
      'Redis is required for the dead letter queue',
    );
  });
});
