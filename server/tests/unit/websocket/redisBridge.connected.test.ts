import { beforeEach, describe, expect, it, vi } from 'vitest';

type EventCallback = (...args: any[]) => void;

function createMockPubSubClient(options?: {
  autoConnect?: boolean;
  publishThrows?: boolean;
  publishRejects?: boolean;
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
      if (options?.publishRejects) {
        return Promise.reject(new Error('async publish failed'));
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
    expect(mocks.subscriber.subscribe).toHaveBeenCalledWith(
      'sanctuary:ws:broadcast', 'sanctuary:ws:authorization-control', 'sanctuary:ws:gateway',
    );

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

  it('runs publish-only for processes with no WebSocket clients of their own', async () => {
    // The worker publishes sync status and wallet logs but has nobody to fan
    // them out to, so it must not open (or parse) a subscriber connection.
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();

    await initializeRedisBridge({ publishOnly: true });

    expect(redisBridge.isActive()).toBe(true);
    expect(mocks.rootClient.duplicate).toHaveBeenCalledTimes(1);
    expect(mocks.subscriber.subscribe).not.toHaveBeenCalled();

    redisBridge.publishBroadcast({ type: 'sync', data: { inProgress: true }, walletId: 'wallet-1' });
    expect(mocks.publisher.publish).toHaveBeenCalledWith(
      'sanctuary:ws:broadcast',
      expect.stringContaining('"walletId":"wallet-1"'),
    );

    await shutdownRedisBridge();
    expect(redisBridge.isActive()).toBe(false);
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

  it('publishes and receives versioned authorization controls on a separate channel', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setControlHandler(handler);
    await initializeRedisBridge();

    const control = { version: 1 as const, type: 'access-token-revoked' as const, jti: 'jti-1' };
    redisBridge.publishControl(control);
    expect(mocks.publisher.publish).toHaveBeenCalledWith(
      'sanctuary:ws:authorization-control',
      expect.stringContaining('"type":"access-token-revoked"'),
    );

    mocks.subscriber.emit('message', 'sanctuary:ws:authorization-control', JSON.stringify({
      control,
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(handler).toHaveBeenCalledWith(control);
    await shutdownRedisBridge();
  });

  it('rejects malformed controls without invoking the handler', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setControlHandler(handler);
    await initializeRedisBridge();

    mocks.subscriber.emit('message', 'sanctuary:ws:authorization-control', JSON.stringify({
      control: { version: 1, type: 'user-access-revoked' },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).not.toHaveBeenCalled();
    expect(redisBridge.getMetrics().errors).toBe(1);
    await shutdownRedisBridge();
  });

  it.each([
    ['non-object envelope', 'not-an-envelope'],
    ['missing instance ID', { control: { version: 1, type: 'user-access-revoked', userId: 'u1' }, timestamp: 1 }],
    ['non-numeric timestamp', { control: { version: 1, type: 'user-access-revoked', userId: 'u1' }, instanceId: 'remote', timestamp: 'now' }],
    ['non-object control', { control: 'revoke', instanceId: 'remote', timestamp: 1 }],
    ['unsupported version', { control: { version: 2, type: 'user-access-revoked', userId: 'u1' }, instanceId: 'remote', timestamp: 1 }],
    ['missing control type', { control: { version: 1, userId: 'u1' }, instanceId: 'remote', timestamp: 1 }],
    ['wallet control without wallet ID', { control: { version: 1, type: 'wallet-access-changed', walletId: '' }, instanceId: 'remote', timestamp: 1 }],
    ['token control without token ID', { control: { version: 1, type: 'access-token-revoked', jti: '' }, instanceId: 'remote', timestamp: 1 }],
    ['unknown control type', { control: { version: 1, type: 'unknown' }, instanceId: 'remote', timestamp: 1 }],
  ])('rejects a %s authorization control', async (_description, envelope) => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setControlHandler(handler);
    await initializeRedisBridge();

    mocks.subscriber.emit(
      'message',
      'sanctuary:ws:authorization-control',
      JSON.stringify(envelope),
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).not.toHaveBeenCalled();
    expect(redisBridge.getMetrics().errors).toBe(1);
    await shutdownRedisBridge();
  });

  it('accepts a wallet authorization control', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setControlHandler(handler);
    await initializeRedisBridge();
    const control = { version: 1, type: 'wallet-access-changed', walletId: 'wallet-1' };

    mocks.subscriber.emit('message', 'sanctuary:ws:authorization-control', JSON.stringify({
      control,
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).toHaveBeenCalledWith(control);
    expect(redisBridge.getMetrics().received).toBe(1);
    await shutdownRedisBridge();
  });

  it('ignores a valid remote control when no control handler is set', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    await initializeRedisBridge();

    mocks.subscriber.emit('message', 'sanctuary:ws:authorization-control', JSON.stringify({
      control: { version: 1, type: 'user-access-revoked', userId: 'u1' },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(redisBridge.getMetrics()).toMatchObject({ received: 0, errors: 0 });
    await shutdownRedisBridge();
  });

  it('deduplicates self-published authorization controls', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    const handler = vi.fn();
    redisBridge.setControlHandler(handler);
    await initializeRedisBridge();

    mocks.subscriber.emit('message', 'sanctuary:ws:authorization-control', JSON.stringify({
      control: { version: 1, type: 'user-access-revoked', userId: 'u1' },
      instanceId: redisBridge.getInstanceId(),
      timestamp: Date.now(),
    }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(handler).not.toHaveBeenCalled();
    expect(redisBridge.getMetrics().skippedSelf).toBe(1);
    await shutdownRedisBridge();
  });

  it('observes rejected async authorization control handlers', async () => {
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks();
    redisBridge.setControlHandler(vi.fn(async () => { throw new Error('control failed'); }));
    await initializeRedisBridge();

    mocks.subscriber.emit('message', 'sanctuary:ws:authorization-control', JSON.stringify({
      control: { version: 1, type: 'user-access-revoked', userId: 'u1' },
      instanceId: 'remote-instance',
      timestamp: Date.now(),
    }));
    await new Promise((resolve) => setImmediate(resolve));

    expect(redisBridge.getMetrics().errors).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to handle WebSocket authorization control', expect.any(Object),
    );
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
    expect(mocks.subscriber.subscribe).toHaveBeenCalledWith(
      'sanctuary:ws:broadcast', 'sanctuary:ws:authorization-control', 'sanctuary:ws:gateway',
    );
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

  it('observes asynchronous publisher rejections', async () => {
    const publisher = createMockPubSubClient({ autoConnect: true, publishRejects: true });
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge } = await loadBridgeWithMocks({ publisher });
    await initializeRedisBridge();

    redisBridge.publishControl({ version: 1, type: 'user-access-revoked', userId: 'u1' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(redisBridge.getMetrics().errors).toBe(1);
    await shutdownRedisBridge();
  });

  it('observes asynchronous broadcast publisher rejections', async () => {
    const publisher = createMockPubSubClient({ autoConnect: true, publishRejects: true });
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks({ publisher });
    await initializeRedisBridge();

    redisBridge.publishBroadcast({ type: 'sync', data: { source: 'local' } } as any);
    await new Promise((resolve) => setImmediate(resolve));

    expect(redisBridge.getMetrics().errors).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to publish WebSocket broadcast',
      expect.objectContaining({ error: 'async publish failed', eventType: 'sync' }),
    );
    await shutdownRedisBridge();
  });

  it('records synchronous authorization control publish failures', async () => {
    const publisher = createMockPubSubClient({ autoConnect: true, publishThrows: true });
    const { initializeRedisBridge, redisBridge, shutdownRedisBridge, mocks } = await loadBridgeWithMocks({ publisher });
    await initializeRedisBridge();

    redisBridge.publishControl({ version: 1, type: 'user-access-revoked', userId: 'u1' });

    expect(redisBridge.getMetrics().errors).toBe(1);
    expect(mocks.log.error).toHaveBeenCalledWith(
      'Failed to publish WebSocket authorization control',
      expect.objectContaining({ error: 'publish failed', controlType: 'user-access-revoked' }),
    );
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

    expect(mocks.subscriber.unsubscribe).toHaveBeenCalledWith(
      'sanctuary:ws:broadcast', 'sanctuary:ws:authorization-control', 'sanctuary:ws:gateway',
    );
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

  describe('gateway-only push channel', () => {
    const gatewayEvent = {
      type: 'ai_insight' as const,
      walletId: 'wallet-1',
      walletName: 'Treasury',
      userIds: ['user-1'],
      data: { insightId: 'i-1', insightType: 'utxo_health', insightTypeLabel: 'UTXO Health', severity: 'warning' },
    };

    it('publishes gateway events on their own channel from a publish-only worker, returning PUBLISH count', async () => {
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
      await initializeRedisBridge({ publishOnly: true });

      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).resolves.toBe(1);

      expect(mocks.subscriber.subscribe).not.toHaveBeenCalled();
      expect(mocks.publisher.publish).toHaveBeenCalledTimes(1);
      const [channel, payload] = mocks.publisher.publish.mock.calls[0];
      expect(channel).toBe('sanctuary:ws:gateway');
      expect(JSON.parse(payload)).toMatchObject({ event: gatewayEvent, instanceId: redisBridge.getInstanceId() });
      expect(redisBridge.getMetrics().published).toBe(1);
    });

    it('excludes its own subscriber from the receiver count, floored at 0', async () => {
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
      await initializeRedisBridge();

      mocks.publisher.publish.mockResolvedValueOnce(2);
      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).resolves.toBe(1);
      mocks.publisher.publish.mockResolvedValueOnce(1);
      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).resolves.toBe(0);
      mocks.publisher.publish.mockResolvedValueOnce(0);
      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).resolves.toBe(0);
    });

    it('resolves 0 without publishing when the bridge is not initialized', async () => {
      const { redisBridge, mocks } = await loadBridgeWithMocks();
      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).resolves.toBe(0);
      expect(mocks.publisher.publish).not.toHaveBeenCalled();
    });

    it('routes remote gateway events to the gateway handler only, never the broadcast handler', async () => {
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
      const broadcastHandler = vi.fn();
      const gatewayHandler = vi.fn();
      redisBridge.setBroadcastHandler(broadcastHandler);
      redisBridge.setGatewayEventHandler(gatewayHandler);
      await initializeRedisBridge();

      mocks.subscriber.emit('message', 'sanctuary:ws:gateway', JSON.stringify({
        event: gatewayEvent, instanceId: 'remote-instance', timestamp: Date.now(),
      }));

      expect(gatewayHandler).toHaveBeenCalledWith(gatewayEvent);
      expect(broadcastHandler).not.toHaveBeenCalled();
      expect(redisBridge.getMetrics().received).toBe(1);
    });

    it('forwards only validated fields, stripping forged top-level and data keys', async () => {
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
      await initializeRedisBridge();
      const gatewayHandler = vi.fn();
      redisBridge.setGatewayEventHandler(gatewayHandler);
      const emit = (event: unknown) => mocks.subscriber.emit('message', 'sanctuary:ws:gateway', JSON.stringify({
        event, instanceId: 'remote-instance', timestamp: 1,
      }));

      emit({ ...gatewayEvent, userId: 'attacker', data: { ...gatewayEvent.data, body: 'Forged body' } });
      emit({
        type: 'consolidation_suggestion', walletId: 'wallet-1', walletName: 'Treasury',
        userIds: ['user-1'], userId: 'attacker', data: { feeRate: 3, title: 'Forged' },
      });

      expect(gatewayHandler).toHaveBeenNthCalledWith(1, gatewayEvent);
      expect(gatewayHandler.mock.calls[0][0]).not.toHaveProperty('userId');
      expect(gatewayHandler).toHaveBeenNthCalledWith(2, {
        type: 'consolidation_suggestion', walletId: 'wallet-1', walletName: 'Treasury',
        userIds: ['user-1'], data: { feeRate: 3 },
      });
      expect(gatewayHandler.mock.calls[1][0]).not.toHaveProperty('userId');
    });

    it('drops self-published gateway events', async () => {
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
      const gatewayHandler = vi.fn();
      redisBridge.setGatewayEventHandler(gatewayHandler);
      await initializeRedisBridge();

      mocks.subscriber.emit('message', 'sanctuary:ws:gateway', JSON.stringify({
        event: gatewayEvent, instanceId: redisBridge.getInstanceId(), timestamp: Date.now(),
      }));

      expect(gatewayHandler).not.toHaveBeenCalled();
      expect(redisBridge.getMetrics().skippedSelf).toBe(1);
    });

    it('rejects malformed gateway envelopes and ignores events with no handler set', async () => {
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks();
      await initializeRedisBridge();
      const emit = (value: unknown) => mocks.subscriber.emit(
        'message', 'sanctuary:ws:gateway', typeof value === 'string' ? value : JSON.stringify(value),
      );
      const envelope = { event: gatewayEvent, instanceId: 'remote', timestamp: 1 };

      // No handler yet: a valid event is ignored without counting as received.
      emit(envelope);
      expect(redisBridge.getMetrics().received).toBe(0);

      const gatewayHandler = vi.fn();
      redisBridge.setGatewayEventHandler(gatewayHandler);
      emit('{invalid-json');
      emit(null);
      emit(5);
      emit({ ...envelope, instanceId: '' });
      emit({ ...envelope, timestamp: 'now' });
      emit({ ...envelope, event: null });
      emit({ ...envelope, event: 'ai_insight' });
      emit({ ...envelope, event: { ...gatewayEvent, type: 7 } });
      emit({ ...envelope, event: { ...gatewayEvent, type: 'transaction' } });
      emit({ ...envelope, event: { ...gatewayEvent, walletId: '' } });
      emit({ ...envelope, event: { ...gatewayEvent, walletName: 7 } });
      emit({ ...envelope, event: { ...gatewayEvent, userIds: ['ok', ''] } });
      emit({ ...envelope, event: { ...gatewayEvent, userIds: 'user-1' } });
      emit({ ...envelope, event: { ...gatewayEvent, data: null } });
      emit({ ...envelope, event: { ...gatewayEvent, data: 'x' } });
      emit({ ...envelope, event: { ...gatewayEvent, data: { ...gatewayEvent.data, severity: 7 } } });
      emit({ ...envelope, event: { ...gatewayEvent, data: { ...gatewayEvent.data, insightId: '' } } });
      emit({ ...envelope, event: { ...gatewayEvent, data: { ...gatewayEvent.data, insightTypeLabel: 5 } } });
      emit({ ...envelope, event: { ...gatewayEvent, type: 'consolidation_suggestion' } });
      emit({ ...envelope, event: { ...gatewayEvent, type: 'consolidation_suggestion', data: { feeRate: '2' } } });

      expect(gatewayHandler).not.toHaveBeenCalled();
      expect(redisBridge.getMetrics().errors).toBe(20);
      expect(mocks.log.warn).toHaveBeenCalledWith('Rejected malformed gateway push event');
    });

    it('catches a throwing gateway handler and rejects a synchronously failing publish', async () => {
      const publisher = createMockPubSubClient({ autoConnect: true, publishThrows: true });
      const { initializeRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks({ publisher });
      redisBridge.setGatewayEventHandler(() => {
        throw new Error('handler exploded');
      });
      await initializeRedisBridge();

      mocks.subscriber.emit('message', 'sanctuary:ws:gateway', JSON.stringify({
        event: gatewayEvent, instanceId: 'remote', timestamp: 1,
      }));
      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).rejects.toThrow('publish failed');

      expect(mocks.log.error).toHaveBeenCalledWith(
        'Failed to handle gateway push event', { error: 'handler exploded' },
      );
      expect(mocks.log.error).toHaveBeenCalledWith(
        'Failed to publish gateway push event', { error: 'publish failed', eventType: 'ai_insight' },
      );
      expect(redisBridge.getMetrics()).toMatchObject({ errors: 2, published: 0 });
    });

    it('rejects an asynchronously failing publish and clears the handler on shutdown', async () => {
      const publisher = createMockPubSubClient({ autoConnect: true, publishRejects: true });
      const { initializeRedisBridge, shutdownRedisBridge, redisBridge, mocks } = await loadBridgeWithMocks({
        publisher,
      });
      redisBridge.setGatewayEventHandler(vi.fn());
      await initializeRedisBridge();

      await expect(redisBridge.publishGatewayEvent(gatewayEvent)).rejects.toThrow('async publish failed');

      expect(mocks.log.error).toHaveBeenCalledWith(
        'Failed to publish gateway push event', { error: 'async publish failed', eventType: 'ai_insight' },
      );
      await shutdownRedisBridge();
      expect((redisBridge as any).gatewayEventHandler).toBeNull();
    });
  });
});
