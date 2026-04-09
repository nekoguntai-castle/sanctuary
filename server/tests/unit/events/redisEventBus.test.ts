import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  redisInstances,
  redisState,
  mockLogError,
  MockRedis,
} = vi.hoisted(() => {
  const { EventEmitter } = require('events');

  class MockRedis extends EventEmitter {
    status = 'ready';
    psubscribeCallback: ((err: Error | null) => void) | null = null;
    publish = vi.fn().mockResolvedValue(1);
    psubscribe = vi.fn((_: string, cb?: (err: Error | null) => void) => {
      this.psubscribeCallback = cb || null;
    });
    punsubscribe = vi.fn().mockResolvedValue(undefined);
    quit = vi.fn().mockResolvedValue('OK');
    url: string;
    options: unknown;

    constructor(url = 'redis://test', options: unknown = {}) {
      super();
      this.url = url;
      this.options = options;
      redisInstances.push(this);

      if (redisState.autoConnect) {
        process.nextTick(() => {
          this.emit('connect');
        });
      }
    }

    triggerPsubscribe(err: Error | null = null): void {
      this.psubscribeCallback?.(err);
    }
  }

  const redisInstances: InstanceType<typeof MockRedis>[] = [];
  const redisState = {
    autoConnect: true,
  };

  return {
    redisInstances,
    redisState,
    mockLogError: vi.fn(),
    MockRedis,
  };
});

vi.mock('ioredis', () => ({
  default: MockRedis,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLogError,
  }),
}));

import {
  RedisEventBus,
  createRedisEventBus,
} from '../../../src/events/redisEventBus';

describe('RedisEventBus', () => {
  let publisher: MockRedis;
  let subscriber: MockRedis;
  let bus: RedisEventBus;

  beforeEach(() => {
    vi.clearAllMocks();
    redisInstances.length = 0;
    redisState.autoConnect = true;
    publisher = new MockRedis();
    subscriber = new MockRedis();
    bus = new RedisEventBus(publisher as any, subscriber as any);
    subscriber.triggerPsubscribe(null);
  });

  afterEach(async () => {
    bus.removeAllListeners();
  });

  it('emits locally and publishes to redis with BigInt-safe serialization', async () => {
    const handler = vi.fn();
    bus.on('wallet:created' as any, handler);

    bus.emit('wallet:created' as any, { walletId: 'w1', amount: BigInt(42) } as any);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({ walletId: 'w1', amount: BigInt(42) });
    expect(publisher.publish).toHaveBeenCalledTimes(1);

    const [channel, payload] = publisher.publish.mock.calls[0];
    expect(channel).toBe('sanctuary:events:wallet:created');
    expect(payload).toContain('"__bigint":"42"');
    expect(bus.getMetrics().emitted['wallet:created']).toBe(1);
  });

  it('receives distributed events from other instances', async () => {
    const handler = vi.fn();
    bus.on('wallet:synced' as any, handler);

    const envelope = {
      event: 'wallet:synced',
      data: { walletId: 'w2' },
      instanceId: 'other-instance',
      timestamp: Date.now(),
    };
    subscriber.emit('pmessage', '*', 'sanctuary:events:wallet:synced', JSON.stringify(envelope));
    await Promise.resolve();

    expect(handler).toHaveBeenCalledWith({ walletId: 'w2' });
    expect(bus.getMetrics().received['wallet:synced']).toBe(1);
  });

  it('ignores distributed events from same instance', async () => {
    const handler = vi.fn();
    bus.on('wallet:synced' as any, handler);

    const envelope = {
      event: 'wallet:synced',
      data: { walletId: 'w2' },
      instanceId: (bus as any).instanceId,
      timestamp: Date.now(),
    };
    subscriber.emit('pmessage', '*', 'sanctuary:events:wallet:synced', JSON.stringify(envelope));
    await Promise.resolve();

    expect(handler).not.toHaveBeenCalled();
    expect(bus.getMetrics().received['wallet:synced']).toBeUndefined();
  });

  it('tracks handler errors for on/once listeners', async () => {
    bus.on('wallet:deleted' as any, async () => {
      throw new Error('on failed');
    });
    bus.once('wallet:deleted' as any, async () => {
      throw new Error('once failed');
    });

    bus.emit('wallet:deleted' as any, { walletId: 'w3' } as any);
    await Promise.resolve();

    expect(bus.getMetrics().errors['wallet:deleted']).toBe(2);
    expect(mockLogError).toHaveBeenCalled();
  });

  it('increments existing error counters in once() handler catch path', async () => {
    (bus as any).metrics.errors.set('wallet:archived', 3);
    bus.once('wallet:archived' as any, async () => {
      throw new Error('once failed again');
    });

    bus.emit('wallet:archived' as any, { walletId: 'w4' } as any);
    await Promise.resolve();

    expect(bus.getMetrics().errors['wallet:archived']).toBe(4);
  });

  it('initializes error counters in once() handler catch path when metric is absent', async () => {
    bus.once('wallet:restored' as any, async () => {
      throw new Error('once failed new metric');
    });

    bus.emit('wallet:restored' as any, { walletId: 'w5' } as any);
    await Promise.resolve();

    expect(bus.getMetrics().errors['wallet:restored']).toBe(1);
  });

  it('handles invalid incoming payloads and subscriber errors', () => {
    subscriber.emit('pmessage', '*', 'sanctuary:events:test', '{bad json');
    subscriber.emit('error', new Error('subscriber down'));

    expect(mockLogError).toHaveBeenCalled();
  });


  it('handles publish failures in emit()', async () => {
    publisher.publish.mockRejectedValueOnce(new Error('publish failed'));

    bus.emit('user:login' as any, { userId: 'u1' } as any);
    await Promise.resolve();

    expect(mockLogError).toHaveBeenCalledWith('Failed to publish event to Redis', expect.any(Object));
  });

  it('supports emitAsync and listener management helpers', async () => {
    const first = vi.fn(async () => undefined);
    const second = vi.fn(async () => undefined);
    bus.on('transaction:broadcast' as any, first);
    bus.on('transaction:broadcast' as any, second);

    expect(bus.listenerCount('transaction:broadcast' as any)).toBe(2);
    await bus.emitAsync('transaction:broadcast' as any, { txid: 'abc' } as any);

    expect(first).toHaveBeenCalled();
    expect(second).toHaveBeenCalled();
    expect(publisher.publish).toHaveBeenCalled();

    bus.removeAllListeners('transaction:broadcast' as any);
    expect(bus.listenerCount('transaction:broadcast' as any)).toBe(0);
  });

  it('resets metrics and shuts down connections', async () => {
    bus.emit('wallet:created' as any, { walletId: 'w1' } as any);
    expect(Object.keys(bus.getMetrics().emitted)).toContain('wallet:created');

    bus.resetMetrics();
    expect(bus.getMetrics().emitted).toEqual({});

    await bus.shutdown();
    expect(subscriber.punsubscribe).toHaveBeenCalled();
    expect(subscriber.quit).toHaveBeenCalled();
    expect(publisher.quit).toHaveBeenCalled();
  });

  it('supports unsubscribe function from on()', async () => {
    const handler = vi.fn();
    const unsubscribe = bus.on('wallet:created' as any, handler);

    bus.emit('wallet:created' as any, { walletId: 'w1' } as any);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);

    unsubscribe();
    bus.emit('wallet:created' as any, { walletId: 'w2' } as any);
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('runs subscribe callback error branch', () => {
    subscriber.triggerPsubscribe(new Error('subscribe failed'));
    expect(mockLogError).toHaveBeenCalledWith('Failed to subscribe to event channels', {
      error: 'subscribe failed',
    });
  });
});

describe('createRedisEventBus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisInstances.length = 0;
  });

  it('creates and connects publisher + subscriber', async () => {
    redisState.autoConnect = true;

    const bus = await createRedisEventBus('redis://localhost:6379');

    expect(bus).toBeInstanceOf(RedisEventBus);
    expect(redisInstances).toHaveLength(2);
    expect(redisInstances[0].url).toBe('redis://localhost:6379');
    expect(redisInstances[1].url).toBe('redis://localhost:6379');
  });

  it('configures retry strategies for publisher and subscriber clients', async () => {
    redisState.autoConnect = true;

    const bus = await createRedisEventBus('redis://localhost:6379');

    const publisherRetry = (redisInstances[0].options as any).retryStrategy as (times: number) => number;
    const subscriberRetry = (redisInstances[1].options as any).retryStrategy as (times: number) => number;

    expect(publisherRetry(2)).toBe(200);
    expect(subscriberRetry(40)).toBe(3000);

    await bus.shutdown();
  });

  it('rejects when redis connection emits error', async () => {
    redisState.autoConnect = false;
    const pending = createRedisEventBus('redis://localhost:6379');

    expect(redisInstances).toHaveLength(2);
    redisInstances[0].emit('error', new Error('connect failed'));

    await expect(pending).rejects.toThrow('connect failed');
  });
});
