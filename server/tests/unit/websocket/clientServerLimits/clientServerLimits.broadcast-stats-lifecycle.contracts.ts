import { expect, it, vi } from 'vitest';

import {
  activeServers,
  createClient,
  createRequest,
  loadModule,
  loadServer,
  metricMocks,
  mockPublishBroadcast,
  parseLastSend,
} from './clientServerLimitsTestHarness';

export const registerClientServerLimitBroadcastStatsLifecycleContracts = () => {
  it('broadcasts events locally and publishes to redis bridge', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    server.broadcast({
      type: 'transaction',
      data: { txid: 'abc' },
      walletId: 'w1',
    });

    expect(mockPublishBroadcast).toHaveBeenCalledWith({
      type: 'transaction',
      data: { txid: 'abc' },
      walletId: 'w1',
    });
    const payload = parseLastSend(client);
    expect(payload.type).toBe('event');
    expect(payload.channel).toBe('wallet:w1');
    expect(payload.event).toBe('transaction');
  });

  it('reports aggregate stats including queue data', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);

    const clientA = createClient({
      userId: 'u1',
      messageQueue: ['a', 'b'],
      droppedMessages: 2,
    });
    clientA.subscriptions.add('system');
    const clientB = createClient({
      userId: 'u2',
      messageQueue: ['c'],
      droppedMessages: 1,
    });
    clientB.subscriptions.add('wallet:w1');

    (server as any).clients.add(clientA);
    (server as any).clients.add(clientB);
    (server as any).connectionsPerUser.set('u1', new Set([clientA]));
    (server as any).connectionsPerUser.set('u2', new Set([clientB]));
    (server as any).subscriptions.set('system', new Set([clientA]));
    (server as any).subscriptions.set('wallet:w1', new Set([clientB]));

    const stats = server.getStats();

    expect(stats.clients).toBe(2);
    expect(stats.subscriptions).toBe(2);
    expect(stats.channels).toBe(2);
    expect(stats.uniqueUsers).toBe(2);
    expect(stats.messageQueue.totalQueuedMessages).toBe(3);
    expect(stats.messageQueue.maxClientQueueSize).toBe(2);
    expect(stats.messageQueue.totalDroppedMessages).toBe(3);
  });

  it('cleans up user/subscriptions on disconnect and records metrics', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'user-1',
      connectionTime: Date.now() - 5000,
      closeReason: 'error',
    });
    client.subscriptions.add('system');
    client.subscriptions.add('wallet:abc');

    (server as any).clients.add(client);
    (server as any).connectionsPerUser.set('user-1', new Set([client]));
    (server as any).subscriptions.set('system', new Set([client]));
    (server as any).subscriptions.set('wallet:abc', new Set([client]));

    (server as any).handleDisconnect(client);

    expect((server as any).clients.size).toBe(0);
    expect((server as any).connectionsPerUser.has('user-1')).toBe(false);
    expect((server as any).subscriptions.has('system')).toBe(false);
    expect((server as any).subscriptions.has('wallet:abc')).toBe(false);
    expect(metricMocks.websocketConnections.dec).toHaveBeenCalledWith({ type: 'main' });
    expect(metricMocks.websocketSubscriptions.dec).toHaveBeenCalledWith(2);
    expect(metricMocks.websocketConnectionDuration.observe).toHaveBeenCalledWith(
      { close_reason: 'error' },
      expect.any(Number)
    );
  });

  it('handles disconnect when user mapping is absent', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'missing-user',
      connectionTime: Date.now() - 3000,
    });
    (server as any).clients.add(client);

    (server as any).handleDisconnect(client);

    expect((server as any).clients.has(client)).toBe(false);
  });

  it('keeps per-user and channel sets when other entries remain during disconnect', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'user-1',
      connectionTime: Date.now() - 3000,
    });
    const otherUserClient = createClient({ userId: 'user-1' });
    const otherChannelClient = createClient();

    client.subscriptions.add('shared');
    client.subscriptions.add('foreign');
    (server as any).clients.add(client);
    (server as any).connectionsPerUser.set('user-1', new Set([client, otherUserClient]));
    (server as any).subscriptions.set('shared', new Set([client, otherChannelClient]));
    (server as any).subscriptions.set('foreign', new Set([otherChannelClient]));

    (server as any).handleDisconnect(client);

    expect((server as any).connectionsPerUser.has('user-1')).toBe(true);
    expect((server as any).connectionsPerUser.get('user-1')?.has(otherUserClient)).toBe(true);
    expect((server as any).subscriptions.has('shared')).toBe(true);
    expect((server as any).subscriptions.get('shared')?.has(otherChannelClient)).toBe(true);
    expect((server as any).subscriptions.has('foreign')).toBe(true);
  });

  it('closes all client sockets and the server instance', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const clientA = createClient();
    const clientB = createClient();
    (server as any).clients.add(clientA);
    (server as any).clients.add(clientB);
    const wssCloseSpy = vi.spyOn((server as any).wss, 'close');

    server.close();

    expect(clientA.close).toHaveBeenCalledWith(1000, 'Server closing');
    expect(clientB.close).toHaveBeenCalledWith(1000, 'Server closing');
    expect(wssCloseSpy).toHaveBeenCalled();
  });

  it('caps in-memory rate limit event history at MAX_RATE_LIMIT_EVENTS', async () => {
    process.env.MAX_WS_MESSAGES_PER_SECOND = '0';
    const mod = await loadModule();
    const server = new mod.SanctauryWebSocketServer();
    activeServers.push(server);
    const client = createClient({
      connectionTime: Date.now() - 6000,
      lastMessageReset: Date.now(),
      messageCount: 0,
    });

    for (let i = 0; i < 55; i++) {
      await (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'ping' })));
    }

    const events = mod.getRateLimitEvents();
    expect(events).toHaveLength(50);
    expect(events.every((event: { reason: string }) => event.reason === 'per_second_exceeded')).toBe(true);
  });

  it('routes websocket upgrade requests through the internal websocket server', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const request = createRequest();
    const socket = createClient();
    const wss = (server as any).wss;

    wss.handleUpgrade = vi.fn((_req: unknown, _socket: unknown, _head: Buffer, cb: (ws: unknown) => void) => {
      cb(socket);
    });
    wss.emit = vi.fn();

    server.handleUpgrade(request as any, {} as any, Buffer.alloc(0));

    expect(wss.handleUpgrade).toHaveBeenCalled();
    expect(wss.emit).toHaveBeenCalledWith('connection', socket, request);
  });
};
