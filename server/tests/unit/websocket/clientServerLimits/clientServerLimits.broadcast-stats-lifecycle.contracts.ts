import { expect, it, vi } from 'vitest';

import {
  activeServers,
  createClient,
  createRequest,
  loadModule,
  loadServer,
  metricMocks,
  mockPublishBroadcast,
  mockCheckWalletAccess,
  mockIsTokenRevoked,
  mockLogger,
  mockResolveCurrentAccessTokenPayload,
  parseLastSend,
} from './clientServerLimitsTestHarness';

export const registerClientServerLimitBroadcastStatsLifecycleContracts = () => {
  it('broadcasts events locally and publishes to redis bridge', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0, authExpiresAt: Date.now() + 60_000,
      authClaims: { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' },
    });
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    server.broadcast({
      type: 'transaction',
      data: { txid: 'abc' },
      walletId: 'w1',
    });
    await new Promise((resolve) => setImmediate(resolve));

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

  it('revalidates private fanout once per client and wallet access once per user', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const claims = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 2, jti: 'j1' };
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 2, authExpiresAt: Date.now() + 60_000,
      authClaims: claims,
    });
    client.subscriptions.add('wallet:w1');
    client.subscriptions.add('wallet:w1:transaction');
    (server as any).clients.add(client);
    (server as any).subscriptions.set('wallet:w1', new Set([client]));
    (server as any).subscriptions.set('wallet:w1:transaction', new Set([client]));

    await server.localBroadcast({ type: 'transaction', data: { txid: 'abc' }, walletId: 'w1' });

    expect(mockResolveCurrentAccessTokenPayload).toHaveBeenCalledTimes(1);
    expect(mockIsTokenRevoked).toHaveBeenCalledTimes(1);
    expect(mockCheckWalletAccess).toHaveBeenCalledTimes(1);
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it('starts private authorization checks concurrently while preserving subscriber send order', async () => {
    const claimsA = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    const claimsB = { userId: 'u2', username: 'bob', isAdmin: false, sessionVersion: 0, jti: 'j2' };
    let releaseFirst!: (value: typeof claimsA) => void;
    const firstAuthorization = new Promise((resolve) => { releaseFirst = resolve; });
    mockResolveCurrentAccessTokenPayload
      .mockImplementationOnce(() => firstAuthorization)
      .mockImplementationOnce(async (claims) => claims);
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const clientA = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claimsA,
    });
    const clientB = createClient({
      userId: 'u2', authJti: 'j2', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claimsB,
    });
    (server as any).subscriptions.set('wallet:w1', new Set([clientA, clientB]));

    const broadcast = server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockResolveCurrentAccessTokenPayload).toHaveBeenCalledTimes(2);
    expect(clientA.send).not.toHaveBeenCalled();
    expect(clientB.send).not.toHaveBeenCalled();
    releaseFirst(claimsA);
    await broadcast;
    expect(clientA.send.mock.invocationCallOrder[0]).toBeLessThan(clientB.send.mock.invocationCallOrder[0]);
  });

  it('does not send to a client removed by a wallet control while another authorization is pending', async () => {
    const claimsA = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    const claimsB = { userId: 'u2', username: 'bob', isAdmin: false, sessionVersion: 0, jti: 'j2' };
    let releaseB!: (value: typeof claimsB) => void;
    const pendingB = new Promise<typeof claimsB>((resolve) => { releaseB = resolve; });
    mockResolveCurrentAccessTokenPayload
      .mockImplementationOnce(async () => claimsA)
      .mockImplementationOnce(() => pendingB);
    let accessForA = true;
    let markAEventAuthorized!: () => void;
    const aEventAuthorized = new Promise<void>((resolve) => { markAEventAuthorized = resolve; });
    mockCheckWalletAccess.mockImplementation(async (_walletId, userId) => {
      const hasAccess = userId === 'u2' || accessForA;
      if (userId === 'u1' && accessForA) markAEventAuthorized();
      return { hasAccess, canEdit: true, role: 'owner' };
    });
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const clientA = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claimsA,
    });
    const clientB = createClient({
      userId: 'u2', authJti: 'j2', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claimsB,
    });
    for (const client of [clientA, clientB]) client.subscriptions.add('wallet:w1');
    (server as any).clients.add(clientA);
    (server as any).clients.add(clientB);
    (server as any).subscriptions.set('wallet:w1', new Set([clientA, clientB]));

    const broadcast = server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });
    await aEventAuthorized;
    accessForA = false;
    await server.applyAuthorizationControl({ version: 1, type: 'wallet-access-changed', walletId: 'w1' });
    accessForA = true;
    await (server as any).handleSubscribe(clientA, { channel: 'wallet:w1' });
    releaseB(claimsB);
    await broadcast;

    const clientAEvents = clientA.send.mock.calls
      .map(([payload]: [string]) => JSON.parse(payload))
      .filter((message: { type: string }) => message.type === 'event');
    expect(clientAEvents).toHaveLength(0);
    expect(clientB.send).toHaveBeenCalledTimes(1);
  });

  it('serializes local broadcasts so a delayed event cannot be overtaken', async () => {
    const claims = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    let releaseFirst!: (value: typeof claims) => void;
    const firstAuthorization = new Promise<typeof claims>((resolve) => { releaseFirst = resolve; });
    mockResolveCurrentAccessTokenPayload
      .mockImplementationOnce(() => firstAuthorization)
      .mockImplementation(async () => claims);
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claims,
    });
    client.subscriptions.add('wallet:w1');
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    const first = server.localBroadcast({ type: 'balance', data: { sequence: 'A' }, walletId: 'w1' });
    const second = server.localBroadcast({ type: 'balance', data: { sequence: 'B' }, walletId: 'w1' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(mockResolveCurrentAccessTokenPayload).toHaveBeenCalledTimes(1);
    releaseFirst(claims);
    await Promise.all([first, second]);

    const sequences = client.send.mock.calls.map(([payload]: [string]) => JSON.parse(payload).data.sequence);
    expect(sequences).toEqual(['A', 'B']);
  });

  it('continues the broadcast queue after a rejected event', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    client.subscriptions.add('blocks');
    (server as any).subscriptions.set('blocks', new Set([client]));
    const originalContext = (server as any).authorizationContext.bind(server);
    vi.spyOn(server as any, 'authorizationContext')
      .mockImplementationOnce(() => { throw new Error('authorization context failed'); })
      .mockImplementation(() => originalContext());

    const rejected = server.localBroadcast({ type: 'block', data: { sequence: 'A' } });
    const recovered = server.localBroadcast({ type: 'block', data: { sequence: 'B' } });

    await expect(rejected).rejects.toThrow('authorization context failed');
    await expect(recovered).resolves.toBeUndefined();
    expect(JSON.parse(client.send.mock.calls[0][0]).data.sequence).toBe('B');
  });

  it('suppresses unavailable wallet checks without removing subscriptions', async () => {
    mockCheckWalletAccess.mockRejectedValue(new Error('database unavailable'));
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const claims = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claims,
    });
    client.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    await server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });
    await server.applyAuthorizationControl({ version: 1, type: 'wallet-access-changed', walletId: 'w1' });

    expect(client.send).not.toHaveBeenCalled();
    expect(client.subscriptions).toEqual(new Set(['wallet:w1']));
    expect((server as any).subscriptions.get('wallet:w1')).toContain(client);
  });

  it('fails private fanout closed and disconnects when current token validation fails', async () => {
    mockResolveCurrentAccessTokenPayload.mockRejectedValueOnce(new Error('revoked session'));
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 2, authExpiresAt: Date.now() + 60_000,
      authClaims: { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 2, jti: 'j1' },
    });
    client.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).connectionsPerUser.set('u1', new Set([client]));
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    await server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });

    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(4003, 'Authorization revoked');
  });

  it('fails private fanout closed when stored token claims are missing', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'u1' });
    client.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    await server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });

    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(4003, 'Authorization revoked');
  });

  it('fails private fanout closed when the current token identity changes', async () => {
    const claims = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    mockResolveCurrentAccessTokenPayload.mockResolvedValueOnce({ ...claims, userId: 'u2' });
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claims,
    });
    client.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    await server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });

    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(4003, 'Authorization revoked');
  });

  it('removes only matching wallet subscriptions after fanout access denial', async () => {
    mockCheckWalletAccess.mockResolvedValueOnce({ hasAccess: false, canEdit: false, role: 'viewer' });
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const claims = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claims,
    });
    client.subscriptions.add('system');
    client.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    await server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });

    expect(client.subscriptions).toEqual(new Set(['system']));
    expect((server as any).subscriptions.has('wallet:w1')).toBe(false);
  });

  it('does not double-decrement metrics when unsubscribe wins a denied access race', async () => {
    let resolveAccess!: (value: { hasAccess: boolean; canEdit: boolean; role: string }) => void;
    const pendingAccess = new Promise<{ hasAccess: boolean; canEdit: boolean; role: string }>(
      (resolve) => { resolveAccess = resolve; },
    );
    mockCheckWalletAccess.mockImplementationOnce(() => pendingAccess);
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const claims = { userId: 'u1', username: 'alice', isAdmin: false, sessionVersion: 0, jti: 'j1' };
    const client = createClient({
      userId: 'u1', authJti: 'j1', authSessionVersion: 0,
      authExpiresAt: Date.now() + 60_000, authClaims: claims,
    });
    client.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).subscriptions.set('wallet:w1', new Set([client]));

    const broadcast = server.localBroadcast({ type: 'balance', data: { balance: 1 }, walletId: 'w1' });
    await new Promise((resolve) => setImmediate(resolve));
    (server as any).handleUnsubscribe(client, { channel: 'wallet:w1' });
    resolveAccess({ hasAccess: false, canEdit: false, role: 'viewer' });
    await broadcast;

    const events = client.send.mock.calls
      .map(([payload]: [string]) => JSON.parse(payload))
      .filter((message: { type: string }) => message.type === 'event');
    expect(events).toHaveLength(0);
    expect(metricMocks.websocketSubscriptions.dec).toHaveBeenCalledTimes(1);
  });

  it('applies wallet and token authorization controls idempotently', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'u1', authJti: 'j1' });
    const authorizedClient = createClient({ userId: 'u2', authJti: 'j2' });
    client.subscriptions.add('wallet:w1');
    client.subscriptions.add('wallet:w1:balance');
    authorizedClient.subscriptions.add('wallet:w1');
    (server as any).clients.add(client);
    (server as any).clients.add(authorizedClient);
    (server as any).connectionsPerUser.set('u1', new Set([client]));
    (server as any).subscriptions.set('wallet:w1', new Set([client]));
    (server as any).subscriptions.set('wallet:w1:balance', new Set([client]));
    (server as any).subscriptions.get('wallet:w1').add(authorizedClient);
    mockCheckWalletAccess.mockImplementation(async (_walletId, userId) => ({
      hasAccess: userId === 'u2', canEdit: userId === 'u2', role: 'owner',
    }));

    await server.applyAuthorizationControl({ version: 1, type: 'wallet-access-changed', walletId: 'w1' });
    await server.applyAuthorizationControl({ version: 1, type: 'wallet-access-changed', walletId: 'w1' });
    expect(client.subscriptions.size).toBe(0);
    expect(authorizedClient.subscriptions).toEqual(new Set(['wallet:w1']));
    expect(metricMocks.websocketSubscriptions.dec).toHaveBeenCalledTimes(1);
    expect(metricMocks.websocketSubscriptions.dec).toHaveBeenCalledWith(2);

    await server.applyAuthorizationControl({ version: 1, type: 'access-token-revoked', jti: 'j1' });
    expect(client.close).toHaveBeenCalledWith(4003, 'Authorization revoked');
  });

  it('reuses wallet access checks for clients of the same user and handles nested subscriptions', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const first = createClient({ userId: 'u1' });
    const second = createClient({ userId: 'u1' });
    first.subscriptions.add('wallet:w1:balance');
    second.subscriptions.add('wallet:w1:transaction');
    (server as any).clients.add(first);
    (server as any).clients.add(second);
    (server as any).subscriptions.set('wallet:w1:balance', new Set([first]));
    (server as any).subscriptions.set('wallet:w1:transaction', new Set([second]));

    await server.applyAuthorizationControl({ version: 1, type: 'wallet-access-changed', walletId: 'w1' });

    expect(mockCheckWalletAccess).toHaveBeenCalledTimes(1);
    expect(first.subscriptions).toEqual(new Set(['wallet:w1:balance']));
    expect(second.subscriptions).toEqual(new Set(['wallet:w1:transaction']));
  });

  it('revokes all mapped user connections and ignores an absent user mapping', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const first = createClient({ userId: 'u1' });
    const second = createClient({ userId: 'u1' });
    (server as any).clients.add(first);
    (server as any).clients.add(second);
    (server as any).connectionsPerUser.set('u1', new Set([first, second]));

    await server.applyAuthorizationControl({ version: 1, type: 'user-access-revoked', userId: 'u1' });
    await server.applyAuthorizationControl({ version: 1, type: 'user-access-revoked', userId: 'missing' });

    expect(first.close).toHaveBeenCalledWith(4003, 'Authorization revoked');
    expect(second.close).toHaveBeenCalledWith(4003, 'Authorization revoked');
  });

  it('makes disconnect cleanup idempotent', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'u1' });
    (server as any).clients.add(client);
    (server as any).connectionsPerUser.set('u1', new Set([client]));

    (server as any).handleDisconnect(client);
    (server as any).handleDisconnect(client);

    expect(metricMocks.websocketConnections.dec).toHaveBeenCalledTimes(1);
    expect(metricMocks.websocketConnectionDuration.observe).toHaveBeenCalledTimes(1);
  });

  it('clears the token-expiry timer during disconnect cleanup', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const authExpiryTimeout = setTimeout(() => undefined, 60_000);
    const client = createClient({
      authExpiryTimeout,
    });
    (server as any).clients.add(client);
    const timerCountBeforeDisconnect = vi.getTimerCount();

    (server as any).handleDisconnect(client);

    expect(client.authExpiryTimeout).toBeUndefined();
    expect(vi.getTimerCount()).toBe(timerCountBeforeDisconnect - 1);
  });

  it('logs an asynchronous local broadcast failure from the public entry point', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    vi.spyOn(server as any, 'authorizationContext').mockImplementationOnce(() => {
      throw new Error('authorization context failed');
    });

    server.broadcast({ type: 'block', data: { height: 1 } });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockPublishBroadcast).toHaveBeenCalled();
    expect(mockLogger.error).toHaveBeenCalledWith(
      'Failed to broadcast WebSocket event locally',
      expect.objectContaining({ eventType: 'block' }),
    );
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
