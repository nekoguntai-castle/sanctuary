import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let redisHandler: ((event: unknown) => void) | null = null;

  class MockClientWsServer {
    localBroadcast = vi.fn();
  }

  class MockGatewayWsServer {}

  return {
    MockClientWsServer,
    MockGatewayWsServer,
    setRedisHandler: vi.fn((handler: (event: unknown) => void) => {
      redisHandler = handler;
    }),
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

    const event = { type: 'transaction', data: { txid: 'abc' } };
    mocks.emitRedisEvent(event);
    expect((server as unknown as { localBroadcast: ReturnType<typeof vi.fn> }).localBroadcast).toHaveBeenCalledWith(event);
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

