import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

const {
  mockGetConfig,
  mockGetErrorMessage,
  mockLogger,
  redisState,
  redisInstances,
  redisCacheInstance,
  mockRedisCacheCtor,
  localEventBus,
  memoryCache,
  mockRedisEventBusInstance,
  mockRedisEventBusCtor,
} = vi.hoisted(() => ({
  mockGetConfig: vi.fn(),
  mockGetErrorMessage: vi.fn((err: unknown, fallback?: string) =>
    err instanceof Error ? err.message : (fallback || 'unknown')
  ),
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  redisState: {
    autoReady: true,
    initiallyReady: false,
    failMainWithError: null as Error | null,
    failPubSubIndex: null as number | null,
    hangPubSubIndex: null as number | null,
  },
  redisInstances: [] as MockRedis[],
  redisCacheInstance: {
    namespace: vi.fn((ns: string) => ({ ns, source: 'redis-cache' })),
  },
  mockRedisCacheCtor: vi.fn(),
  localEventBus: {
    on: vi.fn(),
    emit: vi.fn(),
  },
  memoryCache: {
    namespace: vi.fn((ns: string) => ({ ns, source: 'memory-cache' })),
  },
  mockRedisEventBusInstance: {
    shutdown: vi.fn().mockResolvedValue(undefined),
  },
  mockRedisEventBusCtor: vi.fn(),
}));

class MockRedis extends EventEmitter {
  status = redisState.initiallyReady ? 'ready' : 'connecting';
  url: string;
  options: any;
  quit = vi.fn().mockResolvedValue('OK');
  disconnect = vi.fn();
  ping = vi.fn().mockResolvedValue('PONG');

  constructor(url: string, options: any = {}) {
    super();
    this.url = url;
    this.options = options;
    redisInstances.push(this);

    const isMainClient = redisInstances.length === 1;
    if (isMainClient && redisState.failMainWithError) {
      process.nextTick(() => {
        this.emit('error', redisState.failMainWithError);
      });
      return;
    }

    if (redisState.failPubSubIndex === redisInstances.length) {
      process.nextTick(() => {
        this.emit('error', new Error('pubsub connection failed'));
      });
      return;
    }

    if (redisState.hangPubSubIndex === redisInstances.length) {
      return;
    }

    if (redisState.autoReady) {
      process.nextTick(() => {
        this.status = 'ready';
        this.emit('ready');
        this.emit('connect');
      });
    }
  }
}

vi.mock('ioredis', () => ({
  default: MockRedis,
}));

vi.mock('../../../src/config', () => ({
  getConfig: mockGetConfig,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

vi.mock('../../../src/utils/errors', () => ({
  getErrorMessage: mockGetErrorMessage,
}));

vi.mock('../../../src/services/cache/cacheService', () => ({
  cache: memoryCache,
}));

vi.mock('../../../src/services/cache/redisCache', () => ({
  RedisCache: function RedisCacheMock() {
    mockRedisCacheCtor();
    return redisCacheInstance;
  },
}));

vi.mock('../../../src/events/eventBus', () => ({
  eventBus: localEventBus,
}));

vi.mock('../../../src/events/redisEventBus', () => ({
  RedisEventBus: function RedisEventBusMock() {
    mockRedisEventBusCtor();
    return mockRedisEventBusInstance;
  },
}));

async function loadRedisInfra() {
  vi.resetModules();
  return import('../../../src/infrastructure/redis');
}

describe('infrastructure/redis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisInstances.length = 0;
    redisState.autoReady = true;
    redisState.initiallyReady = false;
    redisState.failMainWithError = null;
    redisState.failPubSubIndex = null;
    redisState.hangPubSubIndex = null;
    (mockRedisEventBusInstance as any).shutdown = vi.fn().mockResolvedValue(undefined);

    mockGetConfig.mockReturnValue({
      redis: {
        enabled: true,
        url: 'redis://user:secret@localhost:6379/0',
      },
    });
  });

  afterEach(async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.shutdownRedis();
  });

  it('accepts clients already ready without waiting for another ready event', async () => {
    redisState.initiallyReady = true;
    redisState.autoReady = false;
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();
    expect(redisInfra.isRedisConnected()).toBe(true);
    expect(redisInstances).toHaveLength(3);
  });

  it('returns memory/local fallbacks before initialization', async () => {
    const redisInfra = await loadRedisInfra();

    expect(redisInfra.getDistributedCache()).toBe(memoryCache as any);
    expect(redisInfra.getNamespacedCache('wallet')).toEqual({ ns: 'wallet', source: 'memory-cache' });
    expect(redisInfra.getDistributedEventBus()).toBe(localEventBus as any);
    expect(redisInfra.isRedisConnected()).toBe(false);
    expect(redisInfra.getRedisClient()).toBeNull();
  });

  it('throws when redis is disabled in config', async () => {
    mockGetConfig.mockReturnValue({
      redis: { enabled: false, url: '' },
    });
    const redisInfra = await loadRedisInfra();

    await expect(redisInfra.initializeRedis()).rejects.toThrow('REDIS_URL is not set');
    expect(redisInfra.isRedisConnected()).toBe(false);
  });

  it('fails before client construction when redis url is malformed', async () => {
    mockGetConfig.mockReturnValue({
      redis: { enabled: true, url: undefined as unknown as string },
    });
    const redisInfra = await loadRedisInfra();

    await expect(redisInfra.initializeRedis()).rejects.toBeInstanceOf(Error);
    expect(redisInfra.getRedisClient()).toBeNull();
  });

  it('initializes redis infrastructure and exposes distributed instances', async () => {
    const redisInfra = await loadRedisInfra();

    await redisInfra.initializeRedis();

    expect(redisInstances).toHaveLength(3);
    expect(mockRedisCacheCtor).toHaveBeenCalledTimes(1);
    expect(mockRedisEventBusCtor).toHaveBeenCalledTimes(1);
    expect(redisInfra.getDistributedCache()).toBe(redisCacheInstance as any);
    expect(redisInfra.getNamespacedCache('prices')).toEqual({ ns: 'prices', source: 'redis-cache' });
    expect(redisInfra.getDistributedEventBus()).toBe(mockRedisEventBusInstance as any);
    expect(redisInfra.isRedisConnected()).toBe(true);
    expect(redisInfra.getRedisClient()).toBe(redisInstances[0] as any);

    const opts = redisInstances[0].options;
    expect(opts.retryStrategy(2)).toBe(200);
    expect(opts.retryStrategy(12)).toBe(1200);
    expect(opts.retryStrategy(1000)).toBe(3000);
    expect(opts.reconnectOnError(new Error('READONLY You can\'t write'))).toBe(true);
    expect(opts.reconnectOnError(new Error('network error'))).toBe(false);

    const publisherOpts = redisInstances[1].options;
    const subscriberOpts = redisInstances[2].options;
    expect(publisherOpts.retryStrategy(5)).toBe(500);
    expect(subscriberOpts.retryStrategy(7)).toBe(700);
  });

  it('logs an error every 20 retries and never stops retrying', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();
    const { retryStrategy } = redisInstances[0].options;
    mockLogger.error.mockClear();

    expect(retryStrategy(20)).toBe(2000);
    expect(retryStrategy(21)).toBe(2100);
    expect(retryStrategy(40)).toBe(3000);

    const retryErrors = mockLogger.error.mock.calls.filter(([msg]) => String(msg).includes('Redis still unreachable'));
    expect(retryErrors.map(([msg]) => msg)).toEqual([
      'Redis still unreachable after 20 retries; retrying every 3s',
      'Redis still unreachable after 40 retries; retrying every 3s',
    ]);
  });

  it('keeps one persistent throttled error listener after init', async () => {
    vi.useFakeTimers();
    try {
      const redisInfra = await loadRedisInfra();
      const init = redisInfra.initializeRedis();
      await vi.advanceTimersByTimeAsync(1);
      await init;
      const client = redisInstances[0];
      expect(client.listenerCount('error')).toBe(1);
      mockLogger.warn.mockClear();
      mockLogger.debug.mockClear();

      client.emit('error', new Error('ECONNREFUSED'));
      client.emit('error', new Error('ECONNREFUSED'));
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);
      expect(mockLogger.debug).not.toHaveBeenCalled();

      // Past the 30s window: one debug line, then silence inside the next window.
      await vi.advanceTimersByTimeAsync(30001);
      client.emit('error', new Error('ECONNREFUSED'));
      client.emit('error', new Error('ECONNREFUSED'));
      expect(mockLogger.debug).toHaveBeenCalledTimes(1);
      expect(mockLogger.warn).toHaveBeenCalledTimes(1);

      // A successful reconnect starts a new outage: the next error warns again.
      client.emit('ready');
      client.emit('error', new Error('ECONNRESET'));
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when initialized twice', async () => {
    const redisInfra = await loadRedisInfra();

    await redisInfra.initializeRedis();
    await redisInfra.initializeRedis();

    expect(redisInstances).toHaveLength(3);
  });

  it('cleans up partial state when initialization fails', async () => {
    redisState.failMainWithError = new Error('main connection failed');
    const redisInfra = await loadRedisInfra();

    await expect(redisInfra.initializeRedis()).rejects.toThrow('main connection failed');

    // disconnect(), not quit(): a QUIT queued while reconnecting never stops the retry loop.
    expect(redisInstances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(redisInstances[0].quit).not.toHaveBeenCalled();
    expect(redisInfra.isRedisConnected()).toBe(false);
    expect(redisInfra.getRedisClient()).toBeNull();
  });

  it('times out when redis never becomes ready and disconnects the retrying client', async () => {
    redisState.autoReady = false;
    const redisInfra = await loadRedisInfra();
    vi.useFakeTimers();

    const initPromise = redisInfra.initializeRedis();
    const initExpectation = expect(initPromise).rejects.toThrow('Redis connection timeout');
    expect(redisInstances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(10001);
    await initExpectation;
    expect(redisInstances[0].disconnect).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('shuts down initialized infrastructure cleanly', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();

    await redisInfra.shutdownRedis();

    expect(mockRedisEventBusInstance.shutdown).toHaveBeenCalledTimes(1);
    expect(redisInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(redisInfra.isRedisConnected()).toBe(false);
    expect(redisInfra.getDistributedCache()).toBe(memoryCache as any);
    expect(redisInfra.getDistributedEventBus()).toBe(localEventBus as any);
  });

  it('swallows shutdown errors and logs them', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();
    mockRedisEventBusInstance.shutdown.mockRejectedValueOnce(new Error('event bus shutdown failed'));

    await expect(redisInfra.shutdownRedis()).resolves.toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Error during Redis shutdown',
      expect.objectContaining({ error: 'event bus shutdown failed' })
    );
  });

  it('skips event bus shutdown when distributed bus has no shutdown method', async () => {
    delete (mockRedisEventBusInstance as any).shutdown;
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();

    await redisInfra.shutdownRedis();

    expect(redisInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(redisInfra.isRedisConnected()).toBe(false);
  });

  it('handles concurrent shutdown calls when first call reaches redis quit after second', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();

    let resolveFirstShutdown!: () => void;
    mockRedisEventBusInstance.shutdown
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirstShutdown = resolve;
          })
      )
      .mockResolvedValueOnce(undefined);

    const first = redisInfra.shutdownRedis();
    const second = redisInfra.shutdownRedis();

    await Promise.resolve();
    await second;
    resolveFirstShutdown();
    await first;

    expect(redisInstances[0].quit).toHaveBeenCalledTimes(1);
    expect(redisInfra.isRedisConnected()).toBe(false);
  });

  it('does not disconnect an already-closed client when a slower shutdown fails', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();
    let rejectFirst!: (error: Error) => void;
    mockRedisEventBusInstance.shutdown.mockImplementationOnce(() => new Promise<void>((_, reject) => {
      rejectFirst = reject;
    }));

    const first = redisInfra.shutdownRedis();
    await redisInfra.shutdownRedis();
    rejectFirst(new Error('subscription already closed'));
    await first;

    expect(redisInstances[0].quit).toHaveBeenCalledOnce();
    expect(redisInstances[0].disconnect).not.toHaveBeenCalled();
  });

  it('compares TLS credentials by contents and callback or native context by identity', async () => {
    const { getBullMqConnectionKey: key } = await loadRedisInfra();
    const verifyPeer = () => undefined;
    const secureContext = (await import('node:tls')).createSecureContext();
    const tls = { checkServerIdentity: verifyPeer, secureContext, ca: [Buffer.from('test-ca')] };
    const original = key({ password: 'test-password', tls });
    const equivalent = { ca: [Buffer.from('test-ca')], secureContext, checkServerIdentity: verifyPeer };
    expect(key({ tls: equivalent, password: 'test-password' })).toBe(original);
    expect(key({ password: 'test-password', tls: { ...tls, checkServerIdentity: () => undefined } })).not.toBe(original);
    expect(key({ password: 'test-password', tls: { ...tls, ca: [Buffer.from('other-ca')] } })).not.toBe(original);
    expect(key({ password: 'test-password', tls: { ...tls, secureContext: undefined } })).not.toBe(original);
    expect(key({ password: 'new-password', tls })).not.toBe(original);
    expect(original).toMatch(/^[a-f0-9]{64}$/);
  });

  it('distinguishes an implicit Redis endpoint from an explicitly configured one', async () => {
    const { getBullMqConnectionKey } = await loadRedisInfra();
    expect(getBullMqConnectionKey({})).not.toBe(getBullMqConnectionKey({ host: 'redis-2', port: 6380 }));
  });

  it('checkRedisHealth returns unhealthy when not initialized', async () => {
    const redisInfra = await loadRedisInfra();
    const health = await redisInfra.checkRedisHealth();
    expect(health).toEqual({
      status: 'unhealthy',
      error: 'Redis not initialized',
    });
  });

  it('checkRedisHealth returns healthy and degraded latencies', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();

    const nowSpy = vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1020)
      .mockReturnValueOnce(2000)
      .mockReturnValueOnce(2205);

    const healthy = await redisInfra.checkRedisHealth();
    const degraded = await redisInfra.checkRedisHealth();

    expect(healthy).toEqual({ status: 'healthy', latencyMs: 20 });
    expect(degraded).toEqual({ status: 'degraded', latencyMs: 205 });
    nowSpy.mockRestore();
  });

  it('checkRedisHealth returns unhealthy on ping failure', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();

    redisInstances[0].ping.mockRejectedValueOnce(new Error('ping failed'));
    const health = await redisInfra.checkRedisHealth();

    expect(health).toEqual({
      status: 'unhealthy',
      error: 'ping failed',
    });
  });

  it('P2-1: getBullMqConnectionOptions forwards host, port, username, password, db, and tls', async () => {
    const redisInfra = await loadRedisInfra();
    const opts = (redisInfra as any).getBullMqConnectionOptions({
      options: {
        host: 'redis.internal',
        port: 6380,
        username: 'acl-user',
        password: 'secret',
        db: 3,
        tls: { rejectUnauthorized: true },
      },
    });

    expect(opts).toEqual({
      host: 'redis.internal',
      port: 6380,
      username: 'acl-user',
      password: 'secret',
      db: 3,
      tls: { rejectUnauthorized: true },
    });
  });

  it('P2-2: disconnects main, publisher, and subscriber when pub/sub readiness fails or times out', async () => {
    redisState.failPubSubIndex = 2; // publisher emits error
    const redisInfra = await loadRedisInfra();

    await expect(redisInfra.initializeRedis()).rejects.toThrow('pubsub connection failed');
    expect(redisInstances).toHaveLength(3);
    expect(redisInstances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(redisInstances[1].disconnect).toHaveBeenCalledTimes(1);
    expect(redisInstances[2].disconnect).toHaveBeenCalledTimes(1);
    expect(redisInfra.isRedisConnected()).toBe(false);
    expect(redisInfra.getRedisClient()).toBeNull();
    expect(redisInfra.getDistributedCache()).toBe(memoryCache as any);
    expect(redisInfra.getDistributedEventBus()).toBe(localEventBus as any);
  });

  it('P2-2: resets all Redis latches and disconnects main client even if shutdown throws', async () => {
    const redisInfra = await loadRedisInfra();
    await redisInfra.initializeRedis();
    mockRedisEventBusInstance.shutdown.mockRejectedValueOnce(new Error('pubsub close error'));

    await redisInfra.shutdownRedis();

    expect(redisInstances[0].disconnect).toHaveBeenCalledTimes(1);
    expect(redisInfra.isRedisConnected()).toBe(false);
    expect(redisInfra.getRedisClient()).toBeNull();
    expect(redisInfra.getDistributedCache()).toBe(memoryCache as any);
    expect(redisInfra.getDistributedEventBus()).toBe(localEventBus as any);
  });
});
