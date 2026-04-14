import { expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

import {
  activeServers,
  createClient,
  createRequest,
  flushMicrotasks,
  loadServer,
  mockVerifyToken,
  parseLastSend,
} from './clientServerLimitsTestHarness';

export const registerClientServerLimitMessageFlowContracts = () => {
  it('rejects token-auth connection when per-user limit has already been reached', async () => {
    process.env.MAX_WEBSOCKET_PER_USER = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existingClient = createClient({ userId: 'user-1' });
    const client = createClient();

    (server as any).connectionsPerUser.set('user-1', new Set([existingClient]));
    (server as any).handleConnection(
      client,
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer test-token' } })
    );
    await flushMicrotasks();

    expect(client.close).toHaveBeenCalledWith(1008, 'User connection limit of 1 reached');
  });

  it('closes token-auth connection when JWT verification fails during upgrade', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('invalid token'));
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(
      client,
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer bad-token' } })
    );
    await flushMicrotasks();

    expect(client.close).toHaveBeenCalledWith(1008, 'Authentication failed');
  });

  it('tracks authenticated users when registration is called directly', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'direct-user' });

    (server as any).completeClientRegistration(client);
    (server as any).completeClientRegistration(client);

    expect((server as any).connectionsPerUser.get('direct-user')?.size).toBe(1);
  });

  it('routes registered client message and close events to handlers', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    const handleMessageSpy = vi.spyOn(server as any, 'handleMessage').mockImplementation(() => {});
    const disconnectSpy = vi.spyOn(server as any, 'handleDisconnect').mockImplementation(() => {});
    const payload = Buffer.from(JSON.stringify({ type: 'pong' }));

    (server as any).completeClientRegistration(client);
    client.emit('message', payload);
    client.emit('close');

    expect(handleMessageSpy).toHaveBeenCalledWith(client, payload);
    expect(disconnectSpy).toHaveBeenCalledWith(client);
  });

  it('marks connection alive on pong and handles websocket error callback', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    const disconnectSpy = vi.spyOn(server as any, 'handleDisconnect');

    (server as any).completeClientRegistration(client);
    client.isAlive = false;
    client.emit('pong');
    expect(client.isAlive).toBe(true);

    client.emit('error', new Error('socket failed'));
    expect(client.closeReason).toBe('error');
    expect(disconnectSpy).toHaveBeenCalledWith(client);
  });

  it('dispatches auth/subscribe/unsubscribe/ping message types from handleMessage', async () => {
    process.env.MAX_WS_MESSAGES_PER_SECOND = '100';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      connectionTime: Date.now() - 6000,
      lastMessageReset: Date.now() - 2000,
    });
    const authSpy = vi.spyOn(server as any, 'handleAuth').mockImplementation(async () => {});
    const subscribeSpy = vi.spyOn(server as any, 'handleSubscribe').mockImplementation(async () => {});
    const unsubscribeSpy = vi.spyOn(server as any, 'handleUnsubscribe').mockImplementation(() => {});

    (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'auth', data: { token: 't' } })));
    (server as any).handleMessage(
      client,
      Buffer.from(JSON.stringify({ type: 'subscribe', data: { channel: 'system' } }))
    );
    (server as any).handleMessage(
      client,
      Buffer.from(JSON.stringify({ type: 'unsubscribe', data: { channel: 'system' } }))
    );
    (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'ping' })));

    expect(authSpy).toHaveBeenCalled();
    expect(subscribeSpy).toHaveBeenCalled();
    expect(unsubscribeSpy).toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'pong' }));
  });

  it('ignores invalid JSON and explicit pong messages', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleMessage(client, Buffer.from('not-json'));
    expect(client.close).not.toHaveBeenCalled();

    client.send.mockClear();
    await (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'pong' })));
    expect(client.send).not.toHaveBeenCalled();
  });

  it('enforces per-user limit during auth message flow', async () => {
    process.env.MAX_WEBSOCKET_PER_USER = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existing = createClient({ userId: 'user-1' });
    const client = createClient();
    (server as any).connectionsPerUser.set('user-1', new Set([existing]));

    await (server as any).handleAuth(client, { token: 'limit-token' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.message).toBe('User connection limit of 1 reached');
    expect(client.close).toHaveBeenCalledWith(1008, 'User connection limit of 1 reached');
  });

  it('authenticates via message, stores user mapping, and clears auth timeout', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    client.authTimeout = setTimeout(() => {}, 10_000);

    await (server as any).handleAuth(client, { token: 'ok-token' });

    expect(client.userId).toBe('user-1');
    expect(client.authTimeout).toBeUndefined();
    expect((server as any).connectionsPerUser.get('user-1')?.has(client)).toBe(true);
    const payload = parseLastSend(client);
    expect(payload.type).toBe('authenticated');
    expect(payload.data.success).toBe(true);
  });

  it('rejects wallet subscribe when unauthenticated and reports batch limit reached', async () => {
    process.env.MAX_WS_SUBSCRIPTIONS = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleSubscribe(client, { channel: 'wallet:abc123' });
    const singlePayload = parseLastSend(client);
    expect(singlePayload.type).toBe('error');
    expect(singlePayload.data.message).toBe('Authentication required for wallet subscriptions');

    client.subscriptions.add('system');
    await (server as any).handleSubscribeBatch(client, {
      channels: ['mempool'],
    });
    const batchPayload = parseLastSend(client);
    expect(batchPayload.type).toBe('subscribed_batch');
    expect(batchPayload.data.errors).toEqual([
      { channel: 'mempool', reason: 'Subscription limit reached' },
    ]);
  });

  it('clears auth timeout during disconnect cleanup', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    client.authTimeout = setTimeout(() => {}, 10_000);

    (server as any).handleDisconnect(client);

    expect(client.authTimeout).toBeUndefined();
  });

  it('returns false when sending to a non-open websocket', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ readyState: WebSocket.CLOSED });

    const accepted = (server as any).sendToClient(client, { type: 'event' });
    expect(accepted).toBe(false);
  });

  it('queues message without starting processor when queue is already processing', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      isProcessingQueue: true,
    });
    const processSpy = vi.spyOn(server as any, 'processClientQueue');

    const accepted = (server as any).sendToClient(client, { type: 'event' });

    expect(accepted).toBe(true);
    expect(client.messageQueue).toHaveLength(1);
    expect(processSpy).not.toHaveBeenCalled();
  });

  it('stops queue processing when client is closed or queue is empty', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      readyState: WebSocket.CLOSED,
      messageQueue: [JSON.stringify({ type: 'queued' })],
      isProcessingQueue: true,
    });

    (server as any).processClientQueue(client);

    expect(client.isProcessingQueue).toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('maps global and address channels for event fanout', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);

    expect((server as any).getChannelsForEvent({ type: 'block', data: {} })).toContain('blocks');
    expect((server as any).getChannelsForEvent({ type: 'mempool', data: {} })).toContain('mempool');
    expect((server as any).getChannelsForEvent({ type: 'modelDownload', data: {} })).toContain('system');
    expect((server as any).getChannelsForEvent({ type: 'sync', data: {} })).toContain('sync:all');
    expect((server as any).getChannelsForEvent({ type: 'log', data: {} })).toContain('logs:all');
    expect(
      (server as any).getChannelsForEvent({
        type: 'transaction',
        data: {},
        walletId: 'w1',
        addressId: 'a1',
      })
    ).toEqual(expect.arrayContaining(['transactions:all', 'wallet:w1', 'wallet:w1:transaction', 'address:a1']));
  });

  it('terminates dead clients during heartbeat and tolerates heartbeat exceptions', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const deadClient = createClient({ isAlive: false, connectionTime: Date.now() - 1000 });
    const throwingClient = createClient({
      isAlive: false,
      connectionTime: Date.now() - 1000,
      terminate: vi.fn(() => {
        throw new Error('terminate failed');
      }),
    });
    (server as any).clients.add(deadClient);

    vi.advanceTimersByTime(30_000);
    expect(deadClient.terminate).toHaveBeenCalled();

    (server as any).clients.add(throwingClient);
    expect(() => vi.advanceTimersByTime(30_000)).not.toThrow();
  });
};
