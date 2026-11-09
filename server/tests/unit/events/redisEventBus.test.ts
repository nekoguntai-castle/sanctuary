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
  let publisher: InstanceType<typeof MockRedis>;
  let subscriber: InstanceType<typeof MockRedis>;
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

  describe('onResync', () => {
    // Regression: Redis pub/sub is at-most-once. Events published while this
    // process's subscriber was disconnected, or that a peer failed to publish,
    // were lost silently, so caches and Electrum config stayed stale.
    const flushTimers = () => new Promise((resolve) => setImmediate(resolve));

    it('resyncs once the subscriber has reconnected and resubscribed', async () => {
      const handler = vi.fn();
      bus.onResync(handler);

      subscriber.emit('ready'); // initial connection: nothing was missed
      await flushTimers();
      expect(handler).not.toHaveBeenCalled();

      subscriber.emit('close');
      subscriber.emit('ready');
      await flushTimers();
      expect(handler).not.toHaveBeenCalled(); // waits for the resubscribe ack

      subscriber.triggerPsubscribe(null);
      await flushTimers();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('resyncs when another instance announces a failed publish', async () => {
      const handler = vi.fn();
      const remote = vi.fn();
      bus.onResync(handler);
      bus.onRemote('sanctuary:resync' as any, remote);

      subscriber.emit('pmessage', '*', 'sanctuary:events:__resync', JSON.stringify({
        event: '__resync', data: null, instanceId: 'other-instance', timestamp: Date.now(),
      }));
      await flushTimers();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(remote).not.toHaveBeenCalled();
    });

    it('announces a resync after a failed publish, retrying until it is sent', async () => {
      vi.useFakeTimers();
      try {
        publisher.publish
          .mockRejectedValueOnce(new Error('redis down')) // the event itself
          .mockRejectedValueOnce(new Error('redis down')) // first announcement
          .mockResolvedValue(1);

        bus.emit('wallet:synced' as any, { walletId: 'w1' } as any);
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(5_000);
        await vi.advanceTimersByTimeAsync(5_000);

        const announcements = publisher.publish.mock.calls.filter(([channel]) => channel === 'sanctuary:events:__resync');
        expect(announcements).toHaveLength(2);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(publisher.publish.mock.calls.filter(([channel]) => channel === 'sanctuary:events:__resync')).toHaveLength(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it('announces after a failed emitAsync publish and still rejects the caller', async () => {
      vi.useFakeTimers();
      try {
        publisher.publish.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(1);

        await expect(bus.emitAsync('wallet:synced' as any, { walletId: 'w1' } as any)).rejects.toThrow('redis down');
        await vi.advanceTimersByTimeAsync(5_000);

        expect(publisher.publish).toHaveBeenLastCalledWith('sanctuary:events:__resync', expect.any(String));
      } finally {
        vi.useRealTimers();
      }
    });

    const announcement = (failedAt: unknown) => JSON.stringify({
      event: '__resync', data: { failedAt }, instanceId: 'other-instance', timestamp: Date.now(),
    });

    it('skips an announcement that a resync started after the failure already covers', async () => {
      const handler = vi.fn();
      bus.onResync(handler);
      const now = vi.spyOn(Date, 'now').mockReturnValue(10_000);
      try {
        subscriber.emit('close');
        subscriber.emit('ready');
        subscriber.triggerPsubscribe(null); // resync starts at 10_000
        await flushTimers();
        expect(handler).toHaveBeenCalledTimes(1);

        // The peer failed during the outage, before this resync began.
        subscriber.emit('pmessage', '*', 'sanctuary:events:__resync', announcement(9_000));
        await flushTimers();
        expect(handler).toHaveBeenCalledTimes(1);

        // A failure after it is not covered.
        subscriber.emit('pmessage', '*', 'sanctuary:events:__resync', announcement(11_000));
        await flushTimers();
        expect(handler).toHaveBeenCalledTimes(2);
      } finally {
        now.mockRestore();
      }
    });

    it('announces a later failure separately, carrying its own failure time', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1_000);
        publisher.publish.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(1);
        bus.emit('wallet:synced' as any, { walletId: 'w1' } as any);
        await vi.advanceTimersByTimeAsync(5_000);

        publisher.publish.mockRejectedValueOnce(new Error('redis down'));
        bus.emit('wallet:synced' as any, { walletId: 'w2' } as any);
        await vi.advanceTimersByTimeAsync(5_000);

        const sent = publisher.publish.mock.calls
          .filter(([channel]) => channel === 'sanctuary:events:__resync')
          .map(([, body]) => JSON.parse(body as string).data.failedAt);
        expect(sent).toEqual([1_000, 6_000]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('does not announce once shutting down', async () => {
      vi.useFakeTimers();
      try {
        let rejectInFlight!: (error: Error) => void;
        publisher.publish.mockImplementationOnce(() => new Promise((_, reject) => { rejectInFlight = reject; }));
        bus.emit('wallet:synced' as any, { walletId: 'w1' } as any);

        await bus.shutdown();
        rejectInFlight(new Error('Connection is closed.'));
        await vi.advanceTimersByTimeAsync(30_000);

        expect(publisher.publish.mock.calls.filter(([channel]) => channel === 'sanctuary:events:__resync')).toHaveLength(0);
      } finally {
        vi.useRealTimers();
      }
    });

    it('retries a failed resubscribe while connected, then resyncs', async () => {
      vi.useFakeTimers();
      try {
        const handler = vi.fn();
        bus.onResync(handler);
        subscriber.emit('close');
        subscriber.emit('ready');
        subscriber.triggerPsubscribe(new Error('resubscribe failed'));
        expect(handler).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1_000);
        subscriber.triggerPsubscribe(null);
        await vi.advanceTimersByTimeAsync(0);

        expect(handler).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('coalesces triggers that arrive during a resync into one more run', async () => {
      let release!: () => void;
      const handler = vi.fn()
        .mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }))
        .mockResolvedValue(undefined);
      bus.onResync(handler);
      const trigger = () => subscriber.emit('pmessage', '*', 'sanctuary:events:__resync', announcement(Date.now() + 60_000));

      trigger();
      await flushTimers();
      trigger();
      trigger();
      release();
      await flushTimers();

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('announces again for a failure during an in-flight announcement', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1_000);
        let finishAnnouncement!: (ok: boolean) => void;
        publisher.publish
          .mockRejectedValueOnce(new Error('redis down'))
          .mockImplementationOnce(() => new Promise((resolve, reject) => {
            finishAnnouncement = (ok) => (ok ? resolve(1) : reject(new Error('redis down')));
          }))
          .mockRejectedValueOnce(new Error('redis down'))
          .mockResolvedValue(1);
        bus.emit('wallet:synced' as any, { walletId: 'w1' } as any);
        await vi.advanceTimersByTimeAsync(5_000); // announcement in flight
        bus.emit('wallet:synced' as any, { walletId: 'w2' } as any); // fails at 6_000
        await vi.advanceTimersByTimeAsync(0);
        finishAnnouncement(false); // the first announcement fails too
        await vi.advanceTimersByTimeAsync(5_000);

        const sent = publisher.publish.mock.calls
          .filter(([channel]) => channel === 'sanctuary:events:__resync')
          .map(([, body]) => JSON.parse(body as string).data.failedAt);
        expect(sent).toEqual([1_000, 1_000]); // retried with the earliest failure
      } finally {
        vi.useRealTimers();
      }
    });

    it('reschedules after a sent announcement when another failure arrived meanwhile', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(1_000);
        let finishAnnouncement!: () => void;
        publisher.publish
          .mockRejectedValueOnce(new Error('redis down'))
          .mockImplementationOnce(() => new Promise((resolve) => { finishAnnouncement = () => resolve(1); }))
          .mockRejectedValueOnce(new Error('redis down'))
          .mockResolvedValue(1);
        bus.emit('wallet:synced' as any, { walletId: 'w1' } as any);
        await vi.advanceTimersByTimeAsync(5_000);
        bus.emit('wallet:synced' as any, { walletId: 'w2' } as any);
        await vi.advanceTimersByTimeAsync(0);
        finishAnnouncement();
        await vi.advanceTimersByTimeAsync(5_000);

        const sent = publisher.publish.mock.calls
          .filter(([channel]) => channel === 'sanctuary:events:__resync')
          .map(([, body]) => JSON.parse(body as string).data.failedAt);
        expect(sent).toEqual([1_000, 6_000]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('cancels pending announcement and resubscribe retries on shutdown', async () => {
      vi.useFakeTimers();
      try {
        publisher.publish.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(1);
        bus.emit('wallet:synced' as any, { walletId: 'w1' } as any);
        await vi.advanceTimersByTimeAsync(0); // announcement timer pending
        subscriber.emit('close');
        subscriber.emit('ready');
        subscriber.triggerPsubscribe(new Error('resubscribe failed')); // retry timer pending
        subscriber.psubscribe.mockClear();

        await bus.shutdown();
        subscriber.triggerPsubscribe(new Error('late failure')); // no new retry once shutting down
        await vi.advanceTimersByTimeAsync(30_000);

        expect(publisher.publish.mock.calls.filter(([channel]) => channel === 'sanctuary:events:__resync')).toHaveLength(0);
        expect(subscriber.psubscribe).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it('ignores its own announcements, isolates handler errors and supports unsubscribe', async () => {
      const failing = vi.fn().mockRejectedValue(new Error('boom'));
      const unsubscribe = bus.onResync(failing);
      const ok = vi.fn();
      bus.onResync(ok);

      subscriber.emit('close');
      subscriber.emit('ready');
      subscriber.triggerPsubscribe(null);
      await flushTimers();
      expect(ok).toHaveBeenCalledTimes(1);
      expect(mockLogError).toHaveBeenCalled();

      unsubscribe();
      subscriber.emit('close');
      subscriber.emit('ready');
      subscriber.triggerPsubscribe(new Error('resubscribe failed'));
      await flushTimers();
      expect(ok).toHaveBeenCalledTimes(1); // no resync until subscribed
      expect(failing).toHaveBeenCalledTimes(1);
    });
  });

  describe('onRemote', () => {
    // Needed so a process can react to another instance's change without
    // re-running the change it already applied itself (e.g. node config reset).
    it('delivers events published by other instances', async () => {
      const handler = vi.fn();
      bus.onRemote('wallet:synced' as any, handler);

      subscriber.emit('pmessage', '*', 'sanctuary:events:wallet:synced', JSON.stringify({
        event: 'wallet:synced',
        data: { walletId: 'w9' },
        instanceId: 'other-instance',
        timestamp: Date.now(),
      }));
      await Promise.resolve();

      expect(handler).toHaveBeenCalledWith({ walletId: 'w9' });
    });

    it('does not deliver events this instance emitted', async () => {
      const handler = vi.fn();
      bus.onRemote('wallet:synced' as any, handler);

      bus.emit('wallet:synced' as any, { walletId: 'w10' } as any);
      await bus.emitAsync('wallet:synced' as any, { walletId: 'w11' } as any);
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
    });

    it('isolates handler errors and supports unsubscribe', async () => {
      const handler = vi.fn().mockRejectedValueOnce(new Error('boom'));
      const unsubscribe = bus.onRemote('wallet:synced' as any, handler);
      const message = JSON.stringify({
        event: 'wallet:synced',
        data: { walletId: 'w12' },
        instanceId: 'other-instance',
        timestamp: Date.now(),
      });

      subscriber.emit('pmessage', '*', 'sanctuary:events:wallet:synced', message);
      await new Promise((resolve) => setImmediate(resolve));
      expect(bus.getMetrics().errors['wallet:synced']).toBe(1);

      unsubscribe();
      subscriber.emit('pmessage', '*', 'sanctuary:events:wallet:synced', message);
      await Promise.resolve();
      expect(handler).toHaveBeenCalledTimes(1);
    });
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

  it('logs distributed event processing errors', () => {
    (bus as any).localEmitter.emit = vi.fn(() => {
      throw new Error('local emit failed');
    });

    subscriber.emit('pmessage', '*', 'sanctuary:events:wallet:synced', JSON.stringify({
      event: 'wallet:synced',
      data: { walletId: 'w-error' },
      instanceId: 'other-instance',
      timestamp: Date.now(),
    }));

    expect(mockLogError).toHaveBeenCalledWith('Failed to process distributed event', expect.any(Object));
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

  it('tracks rejected raw listeners during emitAsync', async () => {
    (bus as any).localEmitter.on('transaction:confirmed', async () => {
      throw new Error('raw listener failed');
    });

    await bus.emitAsync('transaction:confirmed' as any, { txid: 'abc' } as any);

    expect(bus.getMetrics().errors['transaction:confirmed']).toBe(1);
    expect(mockLogError).toHaveBeenCalledWith('Error in async event handler for transaction:confirmed', expect.any(Object));
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
