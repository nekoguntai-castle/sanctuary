import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let redisHandler: ((event: unknown) => void) | null = null;
  let controlHandler: ((control: unknown) => Promise<void>) | null = null;

  class MockClientWsServer {
    localBroadcast = vi.fn(async () => undefined);
    applyAuthorizationControl = vi.fn(async () => undefined);
  }

  class MockGatewayWsServer {
    sendEvent = vi.fn(async () => undefined);
  }

  return {
    MockClientWsServer,
    MockGatewayWsServer,
    setRedisHandler: vi.fn((handler: (event: unknown) => void) => {
      redisHandler = handler;
    }),
    setControlHandler: vi.fn((handler: (control: unknown) => Promise<void>) => {
      controlHandler = handler;
    }),
    publishControl: vi.fn(),
    emitRedisControl: async (control: unknown) => controlHandler?.(control),
    emitRedisEvent: (event: unknown) => {
      if (redisHandler) redisHandler(event);
    },
    getRateLimitEvents: vi.fn(() => []),
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
});

vi.mock('../../../src/websocket/clientServer', () => ({
  SanctauryWebSocketServer: mocks.MockClientWsServer,
  getRateLimitEvents: mocks.getRateLimitEvents,
}));

vi.mock('../../../src/websocket/gatewayServer', () => ({
  GatewayWebSocketServer: mocks.MockGatewayWsServer,
}));

vi.mock('../../../src/websocket/redisBridge', () => ({
  redisBridge: {
    setBroadcastHandler: mocks.setRedisHandler,
    setControlHandler: mocks.setControlHandler,
    publishControl: mocks.publishControl,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

describe('websocket/server singleton wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('throws when reading client server before initialization', async () => {
    const mod = await import('../../../src/websocket/server');
    expect(() => mod.getWebSocketServer()).toThrow('WebSocket server not initialized');
  });

  it('initializes client websocket singleton and wires redis broadcast handler', async () => {
    const mod = await import('../../../src/websocket/server');

    const server = mod.initializeWebSocketServer();
    expect(server).toBeInstanceOf(mocks.MockClientWsServer);
    expect(mod.getWebSocketServer()).toBe(server);
    expect(mocks.setRedisHandler).toHaveBeenCalledTimes(1);
    expect(mocks.setControlHandler).toHaveBeenCalledTimes(1);

    const event = { type: 'transaction', data: { txid: 'abc' } };
    mocks.emitRedisEvent(event);
    expect((server as unknown as { localBroadcast: ReturnType<typeof vi.fn> }).localBroadcast).toHaveBeenCalledWith(event);

    const control = { version: 1, type: 'user-access-revoked', userId: 'u1' };
    await mocks.emitRedisControl(control);
    expect((server as any).applyAuthorizationControl).toHaveBeenCalledWith(control);
  });

  it('mirrors remote wallet log entries into this process log buffer', async () => {
    // Sync runs in the worker but GET /sync/logs/:walletId is served here, so
    // without this the wallet Log tab is empty for every worker-run sync.
    const mod = await import('../../../src/websocket/server');
    const { walletLogBuffer } = await import('../../../src/services/walletLogBuffer');
    walletLogBuffer.clear('wallet-remote');
    mod.initializeWebSocketServer();

    mocks.emitRedisEvent({
      type: 'log',
      walletId: 'wallet-remote',
      data: {
        id: 'entry-1',
        timestamp: '2026-08-19T00:00:00.000Z',
        level: 'info',
        module: 'SYNC',
        message: 'Sync started',
      },
    });

    expect(walletLogBuffer.get('wallet-remote')).toEqual([
      expect.objectContaining({ id: 'entry-1', message: 'Sync started' }),
    ]);
  });

  it('logs rejected remote broadcasts without leaking an unhandled rejection', async () => {
    const mod = await import('../../../src/websocket/server');
    const server = mod.initializeWebSocketServer();
    const rejection = new Error('local broadcast failed');
    (server as unknown as { localBroadcast: ReturnType<typeof vi.fn> }).localBroadcast
      .mockRejectedValueOnce(rejection);

    mocks.emitRedisEvent({ type: 'sync', data: { source: 'remote' } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to apply remote WebSocket broadcast',
      { error: String(rejection) },
    );
  });

  it('forwards a worker event locally and to the gateway exactly once', async () => {
    const mod = await import('../../../src/websocket/server');
    const server = mod.initializeWebSocketServer();
    const gateway = mod.initializeGatewayWebSocketServer();
    const event = { type: 'transaction', walletId: 'w1', data: { txid: 'tx1' } };

    mocks.emitRedisEvent(event);
    await new Promise((resolve) => setImmediate(resolve));

    expect((server as any).localBroadcast).toHaveBeenCalledTimes(1);
    expect((server as any).localBroadcast).toHaveBeenCalledWith(event);
    expect((gateway as any).sendEvent).toHaveBeenCalledTimes(1);
    expect((gateway as any).sendEvent).toHaveBeenCalledWith(event);
  });

  it('logs rejected worker gateway dispatches without affecting local delivery', async () => {
    const mod = await import('../../../src/websocket/server');
    const server = mod.initializeWebSocketServer();
    const gateway = mod.initializeGatewayWebSocketServer();
    (gateway as any).sendEvent.mockRejectedValueOnce(new Error('gateway unavailable'));

    mocks.emitRedisEvent({ type: 'transaction', walletId: 'w1', data: { txid: 'tx1' } });
    await new Promise((resolve) => setImmediate(resolve));

    expect((server as any).localBroadcast).toHaveBeenCalledTimes(1);
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'Failed to forward remote WebSocket broadcast to gateway',
      { error: 'Error: gateway unavailable' },
    );
  });

  it('dispatches authorization controls locally and through Redis after initialization', async () => {
    const serverMod = await import('../../../src/websocket/server');
    const controlMod = await import('../../../src/websocket/authorizationControl');
    const server = serverMod.initializeWebSocketServer();
    const control = { version: 1 as const, type: 'wallet-access-changed' as const, walletId: 'w1' };

    await controlMod.dispatchWebSocketAuthorizationControl(control);

    expect((server as any).applyAuthorizationControl).toHaveBeenCalledWith(control);
    expect(mocks.publishControl).toHaveBeenCalledWith(control);
  });

  it('throws on duplicate client websocket initialization', async () => {
    const mod = await import('../../../src/websocket/server');
    mod.initializeWebSocketServer();

    expect(() => mod.initializeWebSocketServer()).toThrow('WebSocket server already initialized');
  });

  it('returns null from getWebSocketServerIfInitialized before initialization', async () => {
    const mod = await import('../../../src/websocket/server');
    expect(mod.getWebSocketServerIfInitialized()).toBeNull();
  });

  it('returns server from getWebSocketServerIfInitialized after initialization', async () => {
    const mod = await import('../../../src/websocket/server');
    const server = mod.initializeWebSocketServer();
    expect(mod.getWebSocketServerIfInitialized()).toBe(server);
  });

  it('returns null gateway server before initialization', async () => {
    const mod = await import('../../../src/websocket/server');
    expect(mod.getGatewayWebSocketServer()).toBeNull();
  });

  it('initializes gateway websocket singleton and rejects duplicates', async () => {
    const mod = await import('../../../src/websocket/server');
    const gateway = mod.initializeGatewayWebSocketServer();

    expect(gateway).toBeInstanceOf(mocks.MockGatewayWsServer);
    expect(mod.getGatewayWebSocketServer()).toBe(gateway);
    expect(() => mod.initializeGatewayWebSocketServer()).toThrow('Gateway WebSocket server already initialized');
  });
});
