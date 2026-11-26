import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetRedisClient,
  mockIsRedisConnected,
  mockRedisLimiterCtor,
  mockLimiterInstance,
} = vi.hoisted(() => {
  const mockLimiterInstance = {
    consume: vi.fn(),
    check: vi.fn(),
    reset: vi.fn(),
    getRemaining: vi.fn(),
    isHealthy: vi.fn(),
    getType: vi.fn(),
  };

  return {
    mockGetRedisClient: vi.fn(),
    mockIsRedisConnected: vi.fn(),
    mockRedisLimiterCtor: vi.fn().mockImplementation(function RedisRateLimiterMock() {
      return mockLimiterInstance;
    }),
    mockLimiterInstance,
  };
});

vi.mock('../../../../src/infrastructure', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../../src/services/rateLimiting/redisRateLimiter', () => ({
  RedisRateLimiter: mockRedisLimiterCtor,
}));

vi.mock('../../../../src/services/rateLimiting/policies', () => ({
  RATE_LIMIT_POLICIES: {
    'api:default': {
      name: 'api:default',
      limit: 10,
      windowSeconds: 60,
      keyStrategy: 'user',
    },
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const loadService = async () => {
  vi.resetModules();
  const mod = await import('../../../../src/services/rateLimiting/rateLimitService');
  return mod.rateLimitService;
};

describe('rateLimitService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRedisClient.mockReturnValue({ eval: vi.fn() });
    mockIsRedisConnected.mockReturnValue(true);
    mockLimiterInstance.consume.mockResolvedValue({
      allowed: true,
      remaining: 9,
      limit: 10,
      resetAt: 12345,
    });
    mockLimiterInstance.check.mockResolvedValue({
      allowed: true,
      remaining: 9,
      limit: 10,
      resetAt: 12345,
    });
    mockLimiterInstance.reset.mockResolvedValue(undefined);
    mockLimiterInstance.getRemaining.mockResolvedValue(9);
    mockLimiterInstance.isHealthy.mockResolvedValue(true);
    mockLimiterInstance.getType.mockReturnValue('redis');
  });

  it('initializes once and requires redis connectivity', async () => {
    const service = await loadService();

    service.initialize();
    service.initialize();

    expect(mockRedisLimiterCtor).toHaveBeenCalledTimes(1);
  });

  it('throws on initialize when redis is unavailable', async () => {
    mockGetRedisClient.mockReturnValue(null);
    mockIsRedisConnected.mockReturnValue(false);
    const service = await loadService();

    expect(() => service.initialize()).toThrow('Redis is required for rate limiting');
  });

  it('allows unknown policy with permissive defaults', async () => {
    const service = await loadService();

    const result = await service.consume('missing:policy', 'user-1');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(1000);
  });

  it('throws when consuming a known policy before initialization', async () => {
    const service = await loadService();

    await expect(service.consume('api:default', 'user-1')).rejects.toThrow('Redis rate limiter unavailable');
  });

  it('consumes with composed key and custom cost', async () => {
    const service = await loadService();
    service.initialize();
    mockLimiterInstance.consume.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      limit: 10,
      resetAt: 20000,
      retryAfter: 5,
    });

    const result = await service.consume('api:default', 'user-1', 2);

    expect(mockLimiterInstance.consume).toHaveBeenCalledWith('api:default:user-1', 10, 60, 2);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(5);
  });

  it('returns limiter consume result when request is allowed', async () => {
    const service = await loadService();
    service.initialize();

    const result = await service.consume('api:default', 'user-allow');

    expect(mockLimiterInstance.consume).toHaveBeenCalledWith('api:default:user-allow', 10, 60, 1);
    expect(result).toEqual({
      allowed: true,
      remaining: 9,
      limit: 10,
      resetAt: 12345,
    });
  });

  it('fails open when limiter consume throws', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-11T00:00:00.000Z'));
    const now = Date.now();
    const service = await loadService();
    service.initialize();
    mockLimiterInstance.consume.mockRejectedValueOnce(new Error('redis down'));

    const result = await service.consume('api:default', 'user-1');

    expect(result).toEqual({
      allowed: true,
      remaining: 10,
      limit: 10,
      resetAt: now + 60000,
    });
    vi.useRealTimers();
  });

  it('checks, resets, and gets remaining for known policies', async () => {
    const service = await loadService();
    service.initialize();
    mockLimiterInstance.check.mockResolvedValueOnce({
      allowed: true,
      remaining: 7,
      limit: 10,
      resetAt: 12345,
    });
    mockLimiterInstance.getRemaining.mockResolvedValueOnce(7);

    const checkResult = await service.check('api:default', 'user-1');
    await service.reset('api:default', 'user-1');
    const remaining = await service.getRemaining('api:default', 'user-1');

    expect(checkResult.remaining).toBe(7);
    expect(mockLimiterInstance.check).toHaveBeenCalledWith('api:default:user-1', 10, 60);
    expect(mockLimiterInstance.reset).toHaveBeenCalledWith('api:default:user-1');
    expect(remaining).toBe(7);
  });

  it('fails open when limiter check throws', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-11T00:00:00.000Z'));
    const now = Date.now();
    const service = await loadService();
    service.initialize();
    mockLimiterInstance.check.mockRejectedValueOnce(new Error('redis check down'));

    const result = await service.check('api:default', 'user-1');

    expect(result).toEqual({
      allowed: true,
      remaining: 10,
      limit: 10,
      resetAt: now + 60000,
    });
    vi.useRealTimers();
  });

  it('returns permissive defaults for unknown policy checks', async () => {
    const service = await loadService();

    const checkResult = await service.check('missing:policy', 'user-1');
    const remaining = await service.getRemaining('missing:policy', 'user-1');
    await service.reset('missing:policy', 'user-1');

    expect(checkResult.allowed).toBe(true);
    expect(checkResult.limit).toBe(1000);
    expect(remaining).toBe(999);
    expect(mockLimiterInstance.reset).not.toHaveBeenCalled();
  });

  it('returns backend health when limiter is available', async () => {
    const service = await loadService();
    service.initialize();
    mockLimiterInstance.isHealthy.mockResolvedValueOnce(true);
    mockLimiterInstance.getType.mockReturnValueOnce('redis');

    const health = await service.getHealth();

    expect(health.healthy).toBe(true);
    expect(health.backend).toBe('redis');
    expect(health.latencyMs).toBeTypeOf('number');
  });

  it('returns unhealthy health when limiter is unavailable', async () => {
    const service = await loadService();

    const health = await service.getHealth();

    expect(health).toEqual({
      healthy: false,
      backend: 'redis',
    });
  });

  it('registers custom policies and exposes policy names', async () => {
    const service = await loadService();
    const customPolicy = {
      name: 'custom:test',
      limit: 3,
      windowSeconds: 30,
      keyStrategy: 'user' as const,
    };

    service.registerPolicy(customPolicy);

    expect(service.getPolicy('custom:test')).toEqual(customPolicy);
    expect(service.getPolicyNames()).toContain('api:default');
    expect(service.getPolicyNames()).toContain('custom:test');
  });

  it('P3-5: does not start an unused MemoryRateLimiter timer and resets state on shutdown so initialize can run again', async () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    try {
      const service = await loadService();
      expect(setIntervalSpy).not.toHaveBeenCalled();

      service.initialize();
      expect(mockRedisLimiterCtor).toHaveBeenCalledTimes(1);

      service.shutdown();
      await expect(service.consume('api:default', 'user-1')).rejects.toThrow(
        'Redis rate limiter unavailable',
      );

      service.initialize();
      expect(mockRedisLimiterCtor).toHaveBeenCalledTimes(2);
    } finally {
      setIntervalSpy.mockRestore();
    }
  });
});
