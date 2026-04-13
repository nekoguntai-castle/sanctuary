import { beforeEach, describe, expect, it, vi } from 'vitest';

type EventCallback = (...args: any[]) => void;

function createMockPubSubClient(options?: {
  autoConnect?: boolean;
  publishThrows?: boolean;
  status?: string;
}) {
  const onceHandlers = new Map<string, EventCallback[]>();
  const onHandlers = new Map<string, EventCallback[]>();

  const client: any = {
    status: options?.status || 'connecting',
    once: vi.fn((event: string, cb: EventCallback) => {
      const existing = onceHandlers.get(event) || [];
      existing.push(cb);
      onceHandlers.set(event, existing);
      if (options?.autoConnect && (event === 'connect' || event === 'ready')) {
        queueMicrotask(() => {
          client.status = 'ready';
          cb();
        });
      }
      return client;
    }),
    on: vi.fn((event: string, cb: EventCallback) => {
      const existing = onHandlers.get(event) || [];
      existing.push(cb);
      onHandlers.set(event, existing);
      return client;
    }),
    subscribe: vi.fn().mockResolvedValue(1),
    unsubscribe: vi.fn().mockResolvedValue(1),
    quit: vi.fn().mockResolvedValue('OK'),
    removeListener: vi.fn((event: string, cb: EventCallback) => {
      onceHandlers.set(event, (onceHandlers.get(event) || []).filter((handler) => handler !== cb));
      onHandlers.set(event, (onHandlers.get(event) || []).filter((handler) => handler !== cb));
      return client;
    }),
    publish: vi.fn((_channel: string, _payload: string) => {
      if (options?.publishThrows) {
        throw new Error('publish failed');
      }
      return 1;
    }),
    emit: (event: string, ...args: any[]) => {
      if (event === 'ready') {
        client.status = 'ready';
      }
      const once = onceHandlers.get(event) || [];
      onceHandlers.delete(event);
      for (const cb of once) cb(...args);
      const listeners = onHandlers.get(event) || [];
      for (const cb of listeners) cb(...args);
    },
  };

  return client;
}

async function loadBridgeWithMocks(options?: {
  redisConnected?: boolean;
  redisClientAvailable?: boolean;
  publisher?: any;
  subscriber?: any;
}) {
  vi.resetModules();

  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  const publisher = options?.publisher ?? createMockPubSubClient({ autoConnect: true });
  const subscriber = options?.subscriber ?? createMockPubSubClient({ autoConnect: true });
  const rootClient = {
    duplicate: vi
      .fn()
      .mockReturnValueOnce(publisher)
      .mockReturnValueOnce(subscriber),
  };

  const isRedisConnected = vi.fn(() => options?.redisConnected ?? true);
  const getRedisClient = vi.fn(() => (
    options?.redisClientAvailable === false ? null : rootClient
  ));

  vi.doMock('../../../src/utils/logger', () => ({
    createLogger: () => log,
  }));
  vi.doMock('../../../src/infrastructure/redis', () => ({
    getRedisClient,
    isRedisConnected,
  }));

  const mod = await import('../../../src/websocket/redisBridge');
  return {
    ...mod,
    mocks: {
      log,
      rootClient,
      publisher,
      subscriber,
      isRedisConnected,
      getRedisClient,
    },
  };
}

describe('RedisWebSocketBridge (connected mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with connected Redis, subscribes, and handles remote messages', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setBroadcastHandler(handler);

    await initializeRedisBridge();
    expect(redisBridge.isActive()).toBe(true);
    expect(mocks.subscriber.subscribe).toHaveBeenCalledWith('sanctuary:ws:broadcast');

    const envelope = {
      event: { type: 'sync', data: { source: 'remote' }, walletId: 'wallet-1' },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    };
    mocks.subscriber.emit('message', 'sanctuary:ws:broadcast', JSON.stringify(envelope));

    expect(handler).toHaveBeenCalledWith(envelope.event);
    expect(redisBridge.getMetrics().received).toBe(1);

    await shutdownRedisBridge();
  });

  it('ignores messages from channels other than the broadcast channel', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setBroadcastHandler(handler);

    await initializeRedisBridge();

    const envelope = {
      event: { type: 'sync', data: { source: 'remote' } },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    };
    mocks.subscriber.emit('message', 'sanctuary:ws:other', JSON.stringify(envelope));

    expect(handler).not.toHaveBeenCalled();
    expect(redisBridge.getMetrics().received).toBe(0);

    await shutdownRedisBridge();
  });

  it('skips self-published messages and tracks skippedSelf metric', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setBroadcastHandler(handler);
    await initializeRedisBridge();

    const selfEnvelope = {
      event: { type: 'block', data: { height: 1 } },
      instanceId: redisBridge.getInstanceId(),
      timestamp: Date.now(),
    };
    mocks.subscriber.emit('message', 'sanctuary:ws:broadcast', JSON.stringify(selfEnvelope));

    expect(handler).not.toHaveBeenCalled();
    expect(redisBridge.getMetrics().skippedSelf).toBe(1);

    await shutdownRedisBridge();
  });

  it('publishes broadcast envelopes when active', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    await initializeRedisBridge();

    redisBridge.publishBroadcast({
      type: 'transaction',
      data: { txid: 'abc' },
      walletId: 'wallet-1',
    } as any);

    expect(mocks.publisher.publish).toHaveBeenCalledWith(
      'sanctuary:ws:broadcast',
      expect.stringContaining('"type":"transaction"')
    );
    expect(redisBridge.getMetrics().published).toBe(1);

    await shutdownRedisBridge();
  });

  it('initializes when duplicate Redis clients are already ready', async () => {
    const publisher = createMockPubSubClient({ autoConnect: false, status: 'ready' });
    const subscriber = createMockPubSubClient({ autoConnect: false, status: 'ready' });
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks({
      publisher,
      subscriber,
    });

    await initializeRedisBridge();

    expect(redisBridge.isActive()).toBe(true);
    expect(mocks.subscriber.subscribe).toHaveBeenCalledWith('sanctuary:ws:broadcast');
    expect(publisher.once).not.toHaveBeenCalledWith('ready', expect.any(Function));
    expect(subscriber.once).not.toHaveBeenCalledWith('ready', expect.any(Function));

    await shutdownRedisBridge();
  });

  it('records publish errors when publisher throws', async () => {
    const publisher = createMockPubSubClient({ autoConnect: true, publishThrows: true });
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge } = await loadBridgeWithMocks({ publisher });
    await initializeRedisBridge();

    redisBridge.publishBroadcast({
      type: 'mempool',
      data: { size: 10 },
    } as any);

    expect(redisBridge.getMetrics().errors).toBe(1);

    await shutdownRedisBridge();
  });

  it('records parse errors for malformed inbound messages', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    await initializeRedisBridge();

    mocks.subscriber.emit('message', 'sanctuary:ws:broadcast', '{invalid-json');
    expect(redisBridge.getMetrics().errors).toBe(1);

    await shutdownRedisBridge();
  });

  it('ignores valid inbound messages when no broadcast handler is set', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    await initializeRedisBridge();

    const envelope = {
      event: { type: 'sync', data: { source: 'remote' } },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    };
    mocks.subscriber.emit('message', 'sanctuary:ws:broadcast', JSON.stringify(envelope));

    expect(redisBridge.getMetrics().received).toBe(0);
    expect(redisBridge.getMetrics().errors).toBe(0);

    await shutdownRedisBridge();
  });

  it('catches and logs errors thrown by broadcastHandler', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn(() => { throw new Error('handler exploded'); });
    redisBridge.setBroadcastHandler(handler);
    await initializeRedisBridge();

    const envelope = {
      event: { type: 'sync', data: { source: 'remote' } },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    };
    mocks.subscriber.emit('message', 'sanctuary:ws:broadcast', JSON.stringify(envelope));

    expect(handler).toHaveBeenCalled();
    expect(redisBridge.getMetrics().errors).toBe(1);

    await shutdownRedisBridge();
  });

  it('increments error metrics on publisher/subscriber error events', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    await initializeRedisBridge();

    mocks.publisher.emit('error', new Error('publisher down'));
    mocks.subscriber.emit('error', new Error('subscriber down'));

    expect(redisBridge.getMetrics().errors).toBe(2);

    await shutdownRedisBridge();
  });

  it('cleans up and resets state on shutdown', async () => {
    const { initializeRedisBridge, shutdownRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
    redisBridge.setBroadcastHandler(vi.fn());
    await initializeRedisBridge();

    await shutdownRedisBridge();

    expect(mocks.subscriber.unsubscribe).toHaveBeenCalledWith('sanctuary:ws:broadcast');
    expect(mocks.subscriber.quit).toHaveBeenCalled();
    expect(mocks.publisher.quit).toHaveBeenCalled();
    expect(redisBridge.isActive()).toBe(false);
    expect((redisBridge as any).broadcastHandler).toBeNull();
  });

  it('handles shutdown cleanup when publisher/subscriber are already null', async () => {
    const { redisBridge, shutdownRedisBridge } = await loadBridgeWithMocks();

    (redisBridge as any).isInitialized = true;
    (redisBridge as any).subscriber = null;
    (redisBridge as any).publisher = null;

    await expect(shutdownRedisBridge()).resolves.not.toThrow();
    expect(redisBridge.isActive()).toBe(false);
  });

  it('ignores cleanup errors from unsubscribe/quit', async () => {
    const publisher = createMockPubSubClient({ autoConnect: true });
    const subscriber = createMockPubSubClient({ autoConnect: true });
    subscriber.unsubscribe.mockRejectedValueOnce(new Error('unsubscribe failed'));
    publisher.quit.mockRejectedValueOnce(new Error('quit failed'));

    const { initializeRedisBridge, shutdownRedisBridge, redisBridge } = await loadBridgeWithMocks({
      publisher,
      subscriber,
    });
    await initializeRedisBridge();
    await expect(shutdownRedisBridge()).resolves.not.toThrow();
    expect(redisBridge.isActive()).toBe(false);
  });

  it('handles initialization failure and performs partial cleanup', async () => {
    const publisher = createMockPubSubClient({ autoConnect: true });
    const subscriber = createMockPubSubClient({ autoConnect: true });
    subscriber.subscribe.mockRejectedValueOnce(new Error('subscribe failed'));

    const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks({
      publisher,
      subscriber,
    });
    await initializeRedisBridge();

    expect(redisBridge.isActive()).toBe(false);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to initialize Redis WebSocket bridge',
      expect.any(Object)
    );
    expect(subscriber.quit).toHaveBeenCalled();
    expect(publisher.quit).toHaveBeenCalled();
  });

  it('handles publisher/subscriber ready timeout callbacks during initialize', async () => {
    vi.useFakeTimers();
    try {
      const publisher = createMockPubSubClient({ autoConnect: false });
      const subscriber = createMockPubSubClient({ autoConnect: false });
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks({
        publisher,
        subscriber,
      });

      const initPromise = initializeRedisBridge();
      await vi.advanceTimersByTimeAsync(5000);
      await initPromise;

      expect(redisBridge.isActive()).toBe(false);
      expect(mocks.log.error).toHaveBeenCalledWith(
        'Failed to initialize Redis WebSocket bridge',
        expect.any(Object)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stays local-only when Redis is disconnected or client missing', async () => {
    const disconnected = await loadBridgeWithMocks({ redisConnected: false });
    await disconnected.initializeRedisBridge();
    expect(disconnected.redisBridge.isActive()).toBe(false);

    const missingClient = await loadBridgeWithMocks({ redisConnected: true, redisClientAvailable: false });
    await missingClient.initializeRedisBridge();
    expect(missingClient.redisBridge.isActive()).toBe(false);
  });

  it('returns early when initialize is called more than once', async () => {
    const { initializeRedisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();

    await initializeRedisBridge();
    await initializeRedisBridge();

    expect(mocks.log.warn).toHaveBeenCalledWith('Redis WebSocket bridge already initialized');

    await shutdownRedisBridge();
  });
});
