import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_HELD_EVENT_LIMIT,
  GATEWAY_HELD_EVENT_TTL_MS,
} from '../../../src/websocket/types';

const mocks = vi.hoisted(() => {
  class MockWebSocketServer {
    handlers: Record<string, (...args: unknown[]) => void> = {};
    close = vi.fn();

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers[event] = handler;
      return this;
    }

    emit(event: string, ...args: unknown[]) {
      this.handlers[event]?.(...args);
      return true;
    }

    handleUpgrade(_req: unknown, socket: unknown, _head: Buffer, cb: (ws: unknown) => void) {
      cb(socket);
    }
  }

  return {
    createdServers: [] as MockWebSocketServer[],
    MockWebSocketServer,
    config: { gatewaySecret: 'gateway-secret' },
    websocketConnectionsInc: vi.fn(),
    websocketConnectionsDec: vi.fn(),
    websocketMessagesInc: vi.fn(),
    mapGatewayEvent: vi.fn(async (event: unknown) => event),
    refilterPushAudience: vi.fn(async (event: unknown) => event),
    markGatewayConnected: vi.fn(async () => undefined),
    clearGatewayConnected: vi.fn(async () => undefined),
    isAnyGatewayConnected: vi.fn(async () => false),
    isGatewayConnectedElsewhere: vi.fn(async () => false),
    recordGatewayPushLoss: vi.fn(),
    flushGatewayPushLosses: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock('ws', () => {
  function WebSocketServer() {
    const server = new mocks.MockWebSocketServer();
    mocks.createdServers.push(server);
    return server;
  }

  return {
    WebSocket: { OPEN: 1 },
    WebSocketServer,
  };
});

vi.mock('../../../src/config', () => ({
  __esModule: true,
  default: mocks.config,
}));

vi.mock('../../../src/observability/metrics', () => ({
  websocketConnections: {
    inc: mocks.websocketConnectionsInc,
    dec: mocks.websocketConnectionsDec,
  },
  websocketMessagesTotal: {
    inc: mocks.websocketMessagesInc,
  },
}));

vi.mock('../../../src/websocket/gatewayPresence', () => ({
  markGatewayConnected: mocks.markGatewayConnected,
  clearGatewayConnected: mocks.clearGatewayConnected,
  isAnyGatewayConnected: mocks.isAnyGatewayConnected,
  isGatewayConnectedElsewhere: mocks.isGatewayConnectedElsewhere,
}));

vi.mock('../../../src/websocket/gatewayPushLoss', () => ({
  GatewayPushLossLog: class {
    record = mocks.recordGatewayPushLoss;
    flush = mocks.flushGatewayPushLosses;
  },
}));

vi.mock('../../../src/websocket/gatewayEventMapper', () => ({
  mapGatewayEvent: mocks.mapGatewayEvent,
  refilterPushAudience: mocks.refilterPushAudience,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => mocks.logger,
}));

import { GatewayWebSocketServer } from '../../../src/websocket/gatewayServer';

type TestGatewayClient = {
  isAuthenticated: boolean;
  challenge?: string;
  authTimeout?: NodeJS.Timeout;
  readyState: number;
  on: (event: string, cb: (...args: unknown[]) => void) => void;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  emit: (event: string, ...args: unknown[]) => void;
  hasHandler: (event: string) => boolean;
};

function createClient(): TestGatewayClient {
  const handlers: Record<string, (...args: unknown[]) => void> = {};

  return {
    isAuthenticated: false,
    readyState: 1,
    on: (event, cb) => {
      handlers[event] = cb;
    },
    send: vi.fn(),
    close: vi.fn(),
    emit: (event, ...args) => {
      handlers[event]?.(...args);
    },
    hasHandler: (event) => event in handlers,
  };
}

// Split from gatewayServer.test.ts, which is near the file-size limit.
beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.config.gatewaySecret = 'gateway-secret';
  mocks.createdServers.length = 0;
  mocks.mapGatewayEvent.mockReset();
  mocks.mapGatewayEvent.mockImplementation(async (event) => event);
  mocks.refilterPushAudience.mockReset();
  mocks.refilterPushAudience.mockImplementation(async (event) => event);
  mocks.isAnyGatewayConnected.mockReset();
  mocks.isAnyGatewayConnected.mockResolvedValue(false);
  mocks.isGatewayConnectedElsewhere.mockReset();
  mocks.isGatewayConnectedElsewhere.mockResolvedValue(false);
});

describe('push events that could not be delivered', () => {
  const txEvent = (txid: string) => ({
    type: 'transaction', walletId: 'w1', data: { txid, type: 'received', amount: 5 },
  }) as any;

  function connect(server: GatewayWebSocketServer): TestGatewayClient & { isAlive: boolean } {
    const client = { ...createClient(), ping: vi.fn(), terminate: vi.fn(), isAlive: true };
    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));
    return client;
  }

  const sentEvents = (client: TestGatewayClient) => client.send.mock.calls
    .map(([raw]) => JSON.parse(raw))
    .filter((message) => message.type === 'event')
    .map((message) => message.event.data.txid);

  const settle = async () => {
    for (let i = 0; i < 50; i++) await Promise.resolve();
  };

  it('holds a transaction event that arrives with no gateway and delivers it when one authenticates', async () => {
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));
    await server.sendEvent(txEvent('tx2'));

    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual(['tx1', 'tx2']);
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();
  });

  it('holds only events the gateway turns into a push', async () => {
    const server = new GatewayWebSocketServer();
    const confirmation = (txid: string, confirmations: number, previousConfirmations?: number) => ({
      type: 'confirmation', walletId: 'w1', data: { txid, confirmations, previousConfirmations },
    }) as any;
    await server.sendEvent({ type: 'balance', walletId: 'w1', data: { txid: 'bal' } } as any);
    // Only the first confirmation notifies; deeper ones never become a push.
    await server.sendEvent(confirmation('deep', 3, 2));
    await server.sendEvent(confirmation('first', 2, 0));
    await server.sendEvent(confirmation('legacy-first', 1));
    await server.sendEvent(confirmation('legacy-deep', 2));

    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual(['first', 'legacy-first']);
  });

  it('does not hold wallet-level push events, whose senders retry them', async () => {
    const server = new GatewayWebSocketServer();
    const client = connect(server);
    mocks.refilterPushAudience.mockRejectedValueOnce(new Error('db down'));
    const insight = { type: 'ai_insight', walletId: 'w1', walletName: 'Vault', userIds: ['u1'], data: { walletId: 'w1' } };

    await expect(server.sendEvent(insight as any)).rejects.toThrow('db down');
    (server as any).checkGatewayHeartbeat();
    await settle();

    expect(mocks.refilterPushAudience).toHaveBeenCalledTimes(1);
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();
  });

  it('holds nothing when no gateway secret is configured, since no gateway can connect', async () => {
    mocks.config.gatewaySecret = '';
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    mocks.config.gatewaySecret = 'gateway-secret';
    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual([]);
  });

  it('stops a retry pass at the first failed lookup instead of stalling on every held event', async () => {
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));
    await server.sendEvent(txEvent('tx2'));
    await server.sendEvent(txEvent('tx3'));
    mocks.mapGatewayEvent.mockRejectedValueOnce(new Error('db down'));

    const client = connect(server);
    await settle();

    // tx1 failed; tx2 and tx3 were put back without a lookup or a failure count.
    expect(mocks.mapGatewayEvent).toHaveBeenCalledTimes(1);
    expect(sentEvents(client)).toEqual([]);

    client.isAlive = true;
    (server as any).checkGatewayHeartbeat();
    await settle();
    expect(sentEvents(client)).toEqual(['tx1', 'tx2', 'tx3']);
  });

  it('writes its loss record on each heartbeat and forces it on close', () => {
    const server = new GatewayWebSocketServer();
    (server as any).checkGatewayHeartbeat();
    expect(mocks.flushGatewayPushLosses).toHaveBeenLastCalledWith();

    server.close();
    expect(mocks.flushGatewayPushLosses).toHaveBeenLastCalledWith(true);
  });

  it('holds nothing while another instance has the gateway', async () => {
    mocks.isGatewayConnectedElsewhere.mockResolvedValue(true);
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual([]);
  });

  it('holds the event when only this instance\'s own stale record says a gateway is connected', async () => {
    // Redis was unreachable when the gateway socket closed, so this instance's
    // record was not cleared and still counts as "a gateway is connected".
    mocks.isAnyGatewayConnected.mockResolvedValue(true);
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));
    await (server as any).reviewHeldWithoutGateway();

    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual(['tx1']);
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();
  });

  it('holds the event when the shared presence record cannot be read', async () => {
    mocks.isGatewayConnectedElsewhere.mockRejectedValue(new Error('redis down'));
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual(['tx1']);
  });

  it('retries an event whose audience lookup failed, on the next heartbeat', async () => {
    const server = new GatewayWebSocketServer();
    const client = connect(server);
    mocks.mapGatewayEvent.mockRejectedValueOnce(new Error('db down'));

    await expect(server.sendEvent(txEvent('tx1'))).rejects.toThrow('db down');
    expect(sentEvents(client)).toEqual([]);

    (server as any).checkGatewayHeartbeat();
    await settle();

    expect(sentEvents(client)).toEqual(['tx1']);
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();
  });

  it('holds an event whose gateway closed while it was being prepared', async () => {
    const server = new GatewayWebSocketServer();
    const client = connect(server);
    let release!: () => void;
    mocks.mapGatewayEvent.mockImplementationOnce((event) => new Promise((resolve) => {
      release = () => resolve(event);
    }));
    const send = server.sendEvent(txEvent('tx1'));
    await Promise.resolve();
    client.readyState = 0;
    release();
    await send;

    const next = connect(server);
    await settle();

    expect(sentEvents(next)).toEqual(['tx1']);
  });

  it('does not hold a non-push event whose gateway closed while it was being prepared', async () => {
    const server = new GatewayWebSocketServer();
    const client = connect(server);
    let release!: () => void;
    mocks.mapGatewayEvent.mockImplementationOnce((event) => new Promise((resolve) => {
      release = () => resolve(event);
    }));
    const send = server.sendEvent({ type: 'balance', walletId: 'w1', data: { txid: 'bal' } } as any);
    await Promise.resolve();
    client.readyState = 0;
    release();
    await send;

    const next = connect(server);
    await settle();

    expect(sentEvents(next)).toEqual([]);
  });

  it('records an event it gives up on after repeated lookup failures', async () => {
    const server = new GatewayWebSocketServer();
    const client = connect(server);
    mocks.mapGatewayEvent.mockRejectedValue(new Error('db down'));

    await expect(server.sendEvent(txEvent('tx1'))).rejects.toThrow('db down');
    (server as any).checkGatewayHeartbeat();
    await settle();
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();
    client.isAlive = true;
    (server as any).checkGatewayHeartbeat();
    await settle();

    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledTimes(1);
    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transaction', walletId: 'w1' }),
      'db down',
      3,
    );
    // Given up on: a later heartbeat does not try again.
    client.isAlive = true;
    (server as any).checkGatewayHeartbeat();
    await settle();
    expect(mocks.mapGatewayEvent).toHaveBeenCalledTimes(3);
  });

  it('records held events that outlive the hold window with no gateway', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    vi.setSystemTime(1_000_000 + GATEWAY_HELD_EVENT_TTL_MS - 1);
    await (server as any).reviewHeldWithoutGateway();
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();

    vi.setSystemTime(1_000_000 + GATEWAY_HELD_EVENT_TTL_MS + 1);
    (server as any).checkGatewayHeartbeat();
    await settle();
    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transaction' }),
      expect.stringContaining('No push gateway connected'),
      0,
    );

    const client = connect(server);
    await settle();
    expect(sentEvents(client)).toEqual([]);
    server.close();
  });

  it('records an expired event at retry time instead of sending it late', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    vi.setSystemTime(1_000_000 + GATEWAY_HELD_EVENT_TTL_MS + 1);
    const client = connect(server);
    await settle();

    expect(sentEvents(client)).toEqual([]);
    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledTimes(1);
    server.close();
  });

  it('drops held events without a record once another instance has the gateway', async () => {
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    mocks.isGatewayConnectedElsewhere.mockResolvedValue(true);
    await (server as any).reviewHeldWithoutGateway();

    mocks.isGatewayConnectedElsewhere.mockResolvedValue(false);
    const client = connect(server);
    await settle();
    expect(sentEvents(client)).toEqual([]);
    expect(mocks.recordGatewayPushLoss).not.toHaveBeenCalled();
  });

  it('leaves held events alone when a gateway connects during the presence read', async () => {
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    let answer!: (value: boolean) => void;
    mocks.isGatewayConnectedElsewhere.mockImplementationOnce(() => new Promise<boolean>((resolve) => {
      answer = resolve;
    }));
    const review = (server as any).reviewHeldWithoutGateway();
    const client = connect(server);
    answer(true);
    await review;
    await settle();

    expect(sentEvents(client)).toEqual(['tx1']);
  });

  it('records the oldest held event when the hold limit is reached', async () => {
    const server = new GatewayWebSocketServer();
    for (let i = 0; i <= GATEWAY_HELD_EVENT_LIMIT; i++) {
      await server.sendEvent(txEvent(`tx${i}`));
    }

    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledTimes(1);
    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ txid: 'tx0' }) }),
      expect.stringContaining('limit'),
      0,
    );
  });

  it('records held events when the server closes', async () => {
    const server = new GatewayWebSocketServer();
    await server.sendEvent(txEvent('tx1'));

    server.close();

    expect(mocks.recordGatewayPushLoss).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'transaction' }),
      expect.stringContaining('closing'),
      0,
    );
  });
});
