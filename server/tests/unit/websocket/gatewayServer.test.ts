import { createHmac } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATEWAY_AUTH_TIMEOUT_MS,
  GATEWAY_EVENT_PREPARATION_TIMEOUT_MS,
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

vi.mock('../../../src/websocket/gatewayEventMapper', () => ({
  mapGatewayEvent: mocks.mapGatewayEvent,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
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
  };
}

describe('GatewayWebSocketServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.config.gatewaySecret = 'gateway-secret';
    mocks.createdServers.length = 0;
    mocks.mapGatewayEvent.mockReset();
    mocks.mapGatewayEvent.mockImplementation(async (event) => event);
  });

  it('rejects connections when gateway secret is not configured', () => {
    mocks.config.gatewaySecret = '';
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);

    expect(client.close).toHaveBeenCalledWith(4003, 'Gateway authentication not configured');
  });

  it('forwards upgrade requests into websocket connection events', () => {
    const server = new GatewayWebSocketServer();
    const wsServer = mocks.createdServers[mocks.createdServers.length - 1];
    const emitSpy = vi.spyOn(wsServer, 'emit');
    const request = { headers: {} } as any;
    const socket = createClient();

    server.handleUpgrade(request, socket as any, Buffer.alloc(0));

    expect(emitSpy).toHaveBeenCalledWith('connection', socket, request);
  });

  it('sends auth challenge and authenticates valid response', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);

    const challengeMessage = client.send.mock.calls[0]?.[0];
    const parsedChallenge = JSON.parse(challengeMessage);
    expect(parsedChallenge.type).toBe('auth_challenge');
    expect(parsedChallenge.challenge).toBeTypeOf('string');

    const response = createHmac('sha256', 'gateway-secret')
      .update(parsedChallenge.challenge)
      .digest('hex');

    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response,
    })));

    const authSuccessMessage = client.send.mock.calls[1]?.[0];
    expect(JSON.parse(authSuccessMessage)).toEqual({ type: 'auth_success' });
    expect(server.isGatewayConnected()).toBe(true);
    expect(mocks.websocketConnectionsInc).toHaveBeenCalledWith({ type: 'gateway' });
  });

  it('decrements gateway metric and clears state when authenticated client disconnects', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    client.emit('close');

    expect(mocks.websocketConnectionsDec).toHaveBeenCalledWith({ type: 'gateway' });
    expect(server.isGatewayConnected()).toBe(false);
  });

  it('clears auth timeout when unauthenticated client disconnects', () => {
    const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('close');

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('rejects invalid authentication response', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: '00'.repeat(32),
    })));

    expect(client.close).toHaveBeenCalledWith(4003, 'Authentication failed');
    expect(server.isGatewayConnected()).toBe(false);
  });

  it('rejects non-auth messages before authentication', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('message', Buffer.from(JSON.stringify({ type: 'ping' })));

    expect(client.close).toHaveBeenCalledWith(4002, 'Authentication required');
  });

  it('logs websocket client errors', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('error', new Error('socket blew up'));

    expect(client.close).not.toHaveBeenCalledWith(4003, 'Authentication failed');
  });

  it('accepts non-auth messages after successful authentication', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    client.emit('message', Buffer.from(JSON.stringify({ type: 'status' })));

    expect(client.close).not.toHaveBeenCalledWith(4002, 'Authentication required');
  });

  it('rejects auth responses when challenge state is missing', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.challenge = undefined;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: '00'.repeat(32),
    })));

    expect(client.close).toHaveBeenCalledWith(4002, 'Invalid authentication state');
  });

  it('treats malformed auth response payloads as failed authentication', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    (server as any).handleAuthResponse(client, null as any);

    expect(client.close).toHaveBeenCalledWith(4003, 'Authentication failed');
  });

  it('closes unauthenticated clients after auth timeout', async () => {
    vi.useFakeTimers();
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    await vi.advanceTimersByTimeAsync(GATEWAY_AUTH_TIMEOUT_MS + 1);

    expect(client.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('does not close client on auth timeout after authentication already succeeded', async () => {
    vi.useFakeTimers();
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.isAuthenticated = true;
    await vi.advanceTimersByTimeAsync(GATEWAY_AUTH_TIMEOUT_MS + 1);

    expect(client.close).not.toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('ignores invalid gateway message payloads', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    client.emit('message', Buffer.from('not-json'));

    expect(client.close).not.toHaveBeenCalledWith(4002, 'Authentication required');
  });

  it('replaces existing authenticated gateway with newer connection', () => {
    const server = new GatewayWebSocketServer();
    const first = createClient();
    const second = createClient();

    (server as any).handleConnection(first, {} as any);
    const firstChallenge = JSON.parse(first.send.mock.calls[0][0]).challenge;
    first.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(firstChallenge).digest('hex'),
    })));

    (server as any).handleConnection(second, {} as any);
    const secondChallenge = JSON.parse(second.send.mock.calls[0][0]).challenge;
    second.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(secondChallenge).digest('hex'),
    })));

    expect(first.close).toHaveBeenCalledWith(1000, 'Replaced by new connection');
    expect(mocks.websocketConnectionsDec).toHaveBeenCalledWith({ type: 'gateway' });
    expect(server.isGatewayConnected()).toBe(true);
  });

  it('replaces unauthenticated tracked gateway without decrementing metric', () => {
    const server = new GatewayWebSocketServer();
    const existing = createClient();
    existing.isAuthenticated = false;
    (server as any).gateway = existing;

    const next = createClient();
    (server as any).handleConnection(next, {} as any);
    const challenge = JSON.parse(next.send.mock.calls[0][0]).challenge;
    next.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    expect(existing.close).toHaveBeenCalledWith(1000, 'Replaced by new connection');
    expect(mocks.websocketConnectionsDec).not.toHaveBeenCalled();
  });

  it('clears tracked unauthenticated gateway on close without decrementing metric', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    (server as any).gateway = client;
    client.isAuthenticated = false;
    client.emit('close');

    expect(mocks.websocketConnectionsDec).not.toHaveBeenCalled();
    expect((server as any).gateway).toBeNull();
  });

  it('sends events only when an authenticated gateway is available', async () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    await server.sendEvent({ type: 'transaction', data: { txid: 'abc' } } as any);
    expect(client.send).not.toHaveBeenCalled();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    await server.sendEvent({ type: 'transaction', data: { txid: 'abc' } } as any);

    const payload = JSON.parse(client.send.mock.calls[2][0]);
    expect(payload).toEqual({
      type: 'event',
      event: { type: 'transaction', data: { txid: 'abc' } },
    });
  });

  it('preserves accepted event order across deferred audience reads', async () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();
    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    let releaseFirst!: () => void;
    mocks.mapGatewayEvent
      .mockImplementationOnce((event) => new Promise((resolve) => {
        releaseFirst = () => resolve({ ...event as object, userIds: ['first'] });
      }))
      .mockImplementationOnce(async (event) => ({ ...event as object, userIds: ['second'] }));

    const first = server.sendEvent({ type: 'transaction', data: { txid: 'first' } } as any);
    const second = server.sendEvent({ type: 'transaction', data: { txid: 'second' } } as any);
    await Promise.resolve();
    expect(mocks.mapGatewayEvent).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([first, second]);

    expect(client.send.mock.calls.slice(2).map(([payload]) => JSON.parse(payload).event.userIds[0]))
      .toEqual(['first', 'second']);
  });

  it('allows later events after a mapper failure', async () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();
    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));
    mocks.mapGatewayEvent
      .mockRejectedValueOnce(new Error('audience read failed'))
      .mockImplementationOnce(async (event) => ({ ...event as object, userIds: ['ok'] }));

    await expect(server.sendEvent({ type: 'transaction', data: { txid: 'bad' } } as any))
      .rejects.toThrow('audience read failed');
    await expect(server.sendEvent({ type: 'transaction', data: { txid: 'good' } } as any))
      .resolves.toBeUndefined();
    expect(JSON.parse(client.send.mock.calls[2][0]).event.userIds).toEqual(['ok']);
  });

  it('times out a stuck audience read without blocking later events', async () => {
    vi.useFakeTimers();
    const server = new GatewayWebSocketServer();
    const client = createClient();
    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));
    let rejectLate!: (error: Error) => void;
    mocks.mapGatewayEvent
      .mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectLate = reject;
      }))
      .mockImplementationOnce(async (event) => ({ ...event as object, userIds: ['ok'] }));

    const stuck = server.sendEvent({ type: 'transaction', data: { txid: 'stuck' } } as any);
    const next = server.sendEvent({ type: 'transaction', data: { txid: 'next' } } as any);
    const rejection = expect(stuck).rejects.toThrow('Gateway event preparation timed out');
    await vi.advanceTimersByTimeAsync(GATEWAY_EVENT_PREPARATION_TIMEOUT_MS);

    await rejection;
    await expect(next).resolves.toBeUndefined();
    rejectLate(new Error('late audience failure'));
    await Promise.resolve();
    expect(JSON.parse(client.send.mock.calls[2][0]).event.userIds).toEqual(['ok']);
  });

  it('accepts sync batches larger than the browser socket queue limit', async () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();
    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    const sends = Array.from({ length: 101 }, (_, index) => server.sendEvent({
      type: 'transaction', data: { txid: `sync-${index}` },
    } as any));

    await expect(Promise.all(sends)).resolves.toHaveLength(101);
    expect(mocks.mapGatewayEvent).toHaveBeenCalledTimes(101);
    expect(client.send).toHaveBeenCalledTimes(103);
  });

  it('does not send an enriched event after the gateway socket stops being open', async () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();
    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    let release!: () => void;
    mocks.mapGatewayEvent.mockImplementationOnce((event) => new Promise((resolve) => {
      release = () => resolve(event);
    }));
    const send = server.sendEvent({ type: 'transaction', data: { txid: 'tx1' } } as any);
    await Promise.resolve();
    client.readyState = 0;
    release();
    await send;

    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('skips sending when client socket is not open', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();
    client.readyState = 0;

    (server as any).sendToClient(client, { type: 'auth_challenge', challenge: 'x' });

    expect(client.send).not.toHaveBeenCalled();
    expect(mocks.websocketMessagesInc).not.toHaveBeenCalledWith({ type: 'gateway', direction: 'out' });
  });

  it('handles auth success when auth timeout is already undefined', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.authTimeout = undefined;

    (server as any).handleAuthResponse(
      client,
      createHmac('sha256', 'gateway-secret').update(challenge).digest('hex')
    );

    expect(client.isAuthenticated).toBe(true);
    expect(client.challenge).toBeUndefined();
  });

  it('closes active gateway and websocket server on shutdown', () => {
    const server = new GatewayWebSocketServer();
    const client = createClient();

    (server as any).handleConnection(client, {} as any);
    const challenge = JSON.parse(client.send.mock.calls[0][0]).challenge;
    client.emit('message', Buffer.from(JSON.stringify({
      type: 'auth_response',
      response: createHmac('sha256', 'gateway-secret').update(challenge).digest('hex'),
    })));

    server.close();

    const wsServer = mocks.createdServers[mocks.createdServers.length - 1];
    expect(client.close).toHaveBeenCalledWith(1000, 'Server closing');
    expect(wsServer.close).toHaveBeenCalledTimes(1);
  });

  it('closes websocket server on shutdown even when no gateway is connected', () => {
    const server = new GatewayWebSocketServer();
    const wsServer = mocks.createdServers[mocks.createdServers.length - 1];

    server.close();

    expect(wsServer.close).toHaveBeenCalledTimes(1);
  });
});
