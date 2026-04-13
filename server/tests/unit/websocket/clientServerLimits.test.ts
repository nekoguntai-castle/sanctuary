import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';

const mockCheckWalletAccess = vi.fn(async () => ({ hasAccess: true, canEdit: true, role: 'owner' }));
const mockVerifyToken = vi.fn(async () => ({ userId: 'user-1' }));
const mockPublishBroadcast = vi.fn();

const metricMocks = {
  websocketConnections: { inc: vi.fn(), dec: vi.fn() },
  websocketMessagesTotal: { inc: vi.fn() },
  websocketRateLimitHits: { inc: vi.fn() },
  websocketSubscriptions: { inc: vi.fn(), dec: vi.fn() },
  websocketConnectionDuration: { observe: vi.fn() },
};

vi.mock('../../../src/services/accessControl', () => ({
  checkWalletAccess: mockCheckWalletAccess,
}));

vi.mock('../../../src/utils/jwt', () => ({
  TokenAudience: {
    ACCESS: 'sanctuary:access',
  },
  verifyToken: mockVerifyToken,
}));

vi.mock('../../../src/websocket/redisBridge', () => ({
  redisBridge: {
    publishBroadcast: mockPublishBroadcast,
  },
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../src/observability/metrics', () => metricMocks);

const loadModule = async () => {
  vi.resetModules();
  return import('../../../src/websocket/clientServer');
};

const loadServer = async () => (await loadModule()).SanctauryWebSocketServer;

const createClient = (overrides: Record<string, unknown> = {}) => {
  const handlers = new Map<string, Array<(...args: any[]) => void>>();
  const client: any = {
    userId: undefined as string | undefined,
    subscriptions: new Set<string>(),
    isAlive: true,
    messageCount: 0,
    lastMessageReset: Date.now() - 2000,
    connectionTime: Date.now() - 6000,
    totalMessageCount: 0,
    messageQueue: [] as string[],
    isProcessingQueue: false,
    droppedMessages: 0,
    readyState: WebSocket.OPEN,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  };

  client.on = vi.fn((event: string, callback: (...args: any[]) => void) => {
    const list = handlers.get(event) || [];
    list.push(callback);
    handlers.set(event, list);
    return client;
  });

  client.once = vi.fn((event: string, callback: (...args: any[]) => void) => {
    const wrapper = (...args: any[]) => {
      callback(...args);
      const list = handlers.get(event) || [];
      handlers.set(event, list.filter(fn => fn !== wrapper));
    };
    const list = handlers.get(event) || [];
    list.push(wrapper);
    handlers.set(event, list);
    return client;
  });

  client.emit = (event: string, ...args: any[]) => {
    for (const cb of handlers.get(event) || []) {
      cb(...args);
    }
  };

  return Object.assign(client, overrides);
};

const parseLastSend = (client: { send: ReturnType<typeof vi.fn> }) => {
  const lastCall = client.send.mock.calls[client.send.mock.calls.length - 1];
  return JSON.parse(lastCall[0]);
};

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));
const activeServers: Array<{ close: () => void }> = [];

const createRequest = (overrides: Record<string, unknown> = {}) => ({
  headers: { host: 'localhost' } as Record<string, string>,
  url: '/ws',
  socket: { remoteAddress: '127.0.0.1' },
  ...overrides,
});

describe('SanctauryWebSocketServer limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MAX_WS_MESSAGES_PER_SECOND = '2';
    process.env.MAX_WS_SUBSCRIPTIONS = '10';
    process.env.MAX_WEBSOCKET_CONNECTIONS = '10000';
    process.env.MAX_WEBSOCKET_PER_USER = '10';
    process.env.WS_GRACE_PERIOD_LIMIT = '500';
    process.env.WS_MAX_QUEUE_SIZE = '100';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_oldest';
    mockCheckWalletAccess.mockResolvedValue({ hasAccess: true, canEdit: true, role: 'owner' });
    mockVerifyToken.mockResolvedValue({ userId: 'user-1' });
  });

  afterEach(() => {
    for (const server of activeServers.splice(0)) {
      server.close();
    }
    vi.useRealTimers();
  });

  it('closes connection when per-second rate limit is exceeded', async () => {
    process.env.MAX_WS_MESSAGES_PER_SECOND = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      messageCount: 1,
      lastMessageReset: Date.now(),
      connectionTime: Date.now() - 6000,
    });

    await (server as any).handleMessage(
      client,
      Buffer.from(JSON.stringify({ type: 'ping' }))
    );

    expect(client.send).toHaveBeenCalled();
    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(client.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    expect(client.closeReason).toBe('rate_limit');
  });

  it('batch subscribe rejects wallet channels without auth', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleMessage(
      client,
      Buffer.from(
        JSON.stringify({
          type: 'subscribe_batch',
          data: { channels: ['wallet:abc123', 'system', 'wallet:def456'] },
        })
      )
    );

    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed_batch');
    expect(payload.data.subscribed).toEqual(['system']);
    expect(payload.data.errors).toEqual([
      { channel: 'wallet:abc123', reason: 'Authentication required' },
      { channel: 'wallet:def456', reason: 'Authentication required' },
    ]);
  });

  it('batch subscribe reports access denied and keeps duplicates', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'user-1' });

    mockCheckWalletAccess.mockImplementation(
      async (walletId: string) => ({ hasAccess: walletId !== 'deadbeef', canEdit: true, role: 'owner' })
    );

    await (server as any).handleMessage(
      client,
      Buffer.from(
        JSON.stringify({
          type: 'subscribe_batch',
          data: { channels: ['wallet:deadbeef', 'wallet:cafebabe', 'wallet:cafebabe'] },
        })
      )
    );
    await flushMicrotasks();

    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed_batch');
    expect(payload.data.subscribed).toEqual(['wallet:cafebabe', 'wallet:cafebabe']);
    expect(payload.data.errors).toEqual([{ channel: 'wallet:deadbeef', reason: 'Access denied' }]);
  });

  it('batch subscribe preserves existing channel set and omits errors when all succeed', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existingClient = createClient();
    const client = createClient();
    (server as any).subscriptions.set('system', new Set([existingClient]));

    await (server as any).handleSubscribeBatch(client, {
      channels: ['system'],
    });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed_batch');
    expect(payload.data.subscribed).toEqual(['system']);
    expect(payload.data.errors).toBeUndefined();
    expect((server as any).subscriptions.get('system')?.has(existingClient)).toBe(true);
    expect((server as any).subscriptions.get('system')?.has(client)).toBe(true);
  });

  it('batch subscribe accepts wallet channel when wallet id regex does not match', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'user-1' });

    await (server as any).handleSubscribeBatch(client, {
      channels: ['wallet:INVALID_ID'],
    });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed_batch');
    expect(payload.data.subscribed).toEqual(['wallet:INVALID_ID']);
    expect(payload.data.errors).toBeUndefined();
    expect(mockCheckWalletAccess).not.toHaveBeenCalled();
  });

  it('drops oldest message when queue is full and policy is drop_oldest', async () => {
    process.env.WS_MAX_QUEUE_SIZE = '1';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_oldest';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      messageQueue: [JSON.stringify({ type: 'old' })],
      droppedMessages: 0,
    });

    const accepted = (server as any).sendToClient(client, { type: 'new' });
    expect(accepted).toBe(true);
    expect(client.droppedMessages).toBe(1);
    expect(client.messageQueue).toHaveLength(0);
    expect(client.send).toHaveBeenCalled();
  });

  it('rejects newest message when queue is full and policy is drop_newest', async () => {
    process.env.WS_MAX_QUEUE_SIZE = '1';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'drop_newest';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      messageQueue: [JSON.stringify({ type: 'old' })],
      droppedMessages: 0,
    });

    const accepted = (server as any).sendToClient(client, { type: 'new' });
    expect(accepted).toBe(false);
    expect(client.droppedMessages).toBe(1);
    expect(client.messageQueue).toHaveLength(1);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('disconnects client when queue is full and policy is disconnect', async () => {
    process.env.WS_MAX_QUEUE_SIZE = '1';
    process.env.WS_QUEUE_OVERFLOW_POLICY = 'disconnect';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      messageQueue: [JSON.stringify({ type: 'old' })],
      droppedMessages: 0,
    });

    const accepted = (server as any).sendToClient(client, { type: 'new' });
    expect(accepted).toBe(false);
    expect(client.closeReason).toBe('queue_overflow');
    expect(client.close).toHaveBeenCalledWith(4009, 'Message queue overflow');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('batch unsubscribe removes subscriptions and replies with list', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    client.subscriptions.add('wallet:abc');
    client.subscriptions.add('system');
    (server as any).subscriptions.set('wallet:abc', new Set([client]));
    (server as any).subscriptions.set('system', new Set([client]));

    await (server as any).handleMessage(
      client,
      Buffer.from(
        JSON.stringify({
          type: 'unsubscribe_batch',
          data: { channels: ['wallet:abc', 'system', 'missing'] },
        })
      )
    );

    const payload = parseLastSend(client);
    expect(payload.type).toBe('unsubscribed_batch');
    expect(payload.data.unsubscribed).toEqual(['wallet:abc', 'system']);
    expect(client.subscriptions.size).toBe(0);
    expect((server as any).subscriptions.has('wallet:abc')).toBe(false);
    expect((server as any).subscriptions.has('system')).toBe(false);
  });

  it('batch unsubscribe tolerates missing channel set and keeps shared channels with other subscribers', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    const other = createClient();

    client.subscriptions.add('ghost');
    client.subscriptions.add('shared');
    other.subscriptions.add('shared');
    (server as any).subscriptions.set('shared', new Set([client, other]));

    (server as any).handleUnsubscribeBatch(client, {
      channels: ['ghost', 'shared'],
    });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('unsubscribed_batch');
    expect(payload.data.unsubscribed).toEqual(['ghost', 'shared']);
    expect((server as any).subscriptions.has('ghost')).toBe(false);
    expect((server as any).subscriptions.has('shared')).toBe(true);
    expect((server as any).subscriptions.get('shared')?.has(other)).toBe(true);
  });

  it('enforces grace period message limit', async () => {
    process.env.WS_GRACE_PERIOD_LIMIT = '1';
    const mod = await loadModule();
    const server = new mod.SanctauryWebSocketServer();
    activeServers.push(server);
    const client = createClient({
      connectionTime: Date.now(),
      totalMessageCount: 1,
    });

    await (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'ping' })));

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(client.close).toHaveBeenCalledWith(1008, 'Rate limit exceeded');
    expect(mod.getRateLimitEvents()[0]?.reason).toBe('grace_period_exceeded');
  });

  it('allows messages during grace period while under the limit', async () => {
    process.env.WS_GRACE_PERIOD_LIMIT = '5';
    const mod = await loadModule();
    const server = new mod.SanctauryWebSocketServer();
    activeServers.push(server);
    const client = createClient({
      connectionTime: Date.now(),
      totalMessageCount: 0,
    });

    await (server as any).handleMessage(client, Buffer.from(JSON.stringify({ type: 'ping' })));

    const payload = parseLastSend(client);
    expect(payload.type).toBe('pong');
    expect(client.close).not.toHaveBeenCalled();
  });

  it('extracts auth token from Authorization header first, then sanctuary_access cookie (ADR 0001/0002 Phase 3)', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);

    // 1. Header-only: mobile/gateway path, unchanged behavior.
    const fromHeader = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer header-token' } })
    );
    expect(fromHeader).toBe('header-token');

    // 2. Cookie-only: browser path after Phase 2 cookie migration. Upgrade
    //    requests on same-origin connections automatically carry the
    //    sanctuary_access cookie, which Phase 3 now reads.
    const fromCookie = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', cookie: 'sanctuary_access=cookie-token' } })
    );
    expect(fromCookie).toBe('cookie-token');

    // 3. Both header and cookie present: header wins (matches the HTTP
    //    middleware precedence so the browser rollback path where both
    //    sources exist chooses the header consistently).
    const bothPresent = (server as any).extractToken(
      createRequest({
        headers: {
          host: 'localhost',
          authorization: 'Bearer header-token',
          cookie: 'sanctuary_access=cookie-token',
        },
      })
    );
    expect(bothPresent).toBe('header-token');

    // 4. Cookie header with multiple entries: the parser must pick
    //    sanctuary_access correctly and ignore unrelated cookies.
    const mixedCookies = (server as any).extractToken(
      createRequest({
        headers: {
          host: 'localhost',
          cookie: 'sanctuary_csrf=csrf-value; sanctuary_access=cookie-token; other=x',
        },
      })
    );
    expect(mixedCookies).toBe('cookie-token');

    // 5. Empty sanctuary_access cookie value: treat as absent, return null.
    const emptyCookie = (server as any).extractToken(
      createRequest({ headers: { host: 'localhost', cookie: 'sanctuary_access=' } })
    );
    expect(emptyCookie).toBeNull();

    // 6. Neither header nor cookie: return null, caller falls back to
    //    the auth-message-after-connect path.
    const none = (server as any).extractToken(createRequest());
    expect(none).toBeNull();

    // 7. Deprecated query parameter is no longer honored. Phase 3
    //    removed the `?token=<jwt>` entry point because query-string
    //    tokens leak via referer headers and server access logs.
    const queryParamRejected = (server as any).extractToken(
      createRequest({ url: '/ws?token=should-be-rejected' })
    );
    expect(queryParamRejected).toBeNull();

    // 8. Missing URL on the request still returns null cleanly (no
    //    regression from the old implementation which used `new URL(...)`).
    const missingUrl = (server as any).extractToken(
      createRequest({ url: undefined })
    );
    expect(missingUrl).toBeNull();
  });

  it('registers authenticated connection when token is provided on upgrade', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(
      client,
      createRequest({ headers: { host: 'localhost', authorization: 'Bearer test-token' } })
    );
    await flushMicrotasks();

    expect(client.userId).toBe('user-1');
    expect((server as any).clients.has(client)).toBe(true);
    const payload = parseLastSend(client);
    expect(payload.type).toBe('connected');
    expect(payload.data.authenticated).toBe(true);
  });

  it('reuses existing per-user connection set for token-auth upgrades', async () => {
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

    const userConnections: Set<unknown> = (server as any).connectionsPerUser.get('user-1');
    expect(userConnections.has(existingClient)).toBe(true);
    expect(userConnections.has(client)).toBe(true);
    expect(userConnections.size).toBe(2);
  });

  it('rejects new connection when total connection limit is reached', async () => {
    process.env.MAX_WEBSOCKET_CONNECTIONS = '0';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());

    expect(client.close).toHaveBeenCalledWith(1008, 'Server connection limit reached');
  });

  it('times out unauthenticated connections', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());
    vi.advanceTimersByTime(30000);

    expect(client.closeReason).toBe('auth_timeout');
    expect(client.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('does not close connection on auth-timeout timer once client is authenticated', async () => {
    vi.useFakeTimers();
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleConnection(client, createRequest());
    client.userId = 'late-auth-user';
    vi.advanceTimersByTime(30000);

    expect(client.close).not.toHaveBeenCalled();
  });

  it('returns already-authenticated response when auth is retried', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'existing-user' });

    await (server as any).handleAuth(client, { token: 'ignored' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('authenticated');
    expect(payload.data.message).toBe('Already authenticated');
  });

  it('sends auth error when token verification fails', async () => {
    mockVerifyToken.mockRejectedValueOnce(new Error('invalid'));
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleAuth(client, { token: 'bad-token' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.message).toBe('Authentication failed');
  });

  it('auth via message reuses existing user set without requiring auth timeout handle', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existing = createClient({ userId: 'user-1' });
    const client = createClient();
    (server as any).connectionsPerUser.set('user-1', new Set([existing]));

    await (server as any).handleAuth(client, { token: 'ok-token' });

    const userConnections: Set<unknown> = (server as any).connectionsPerUser.get('user-1');
    expect(userConnections.has(existing)).toBe(true);
    expect(userConnections.has(client)).toBe(true);
    expect(client.authTimeout).toBeUndefined();
  });

  it('enforces single subscribe limit and rejects extra subscriptions', async () => {
    process.env.MAX_WS_SUBSCRIPTIONS = '1';
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    client.subscriptions.add('system');

    await (server as any).handleSubscribe(client, { channel: 'mempool' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
  });

  it('rejects wallet subscription when access control denies user', async () => {
    mockCheckWalletAccess.mockResolvedValueOnce({ hasAccess: false, canEdit: false, role: 'viewer' });
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'user-1' });

    await (server as any).handleSubscribe(client, { channel: 'wallet:deadbeef' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('error');
    expect(payload.data.message).toBe('Access denied to this wallet');
  });

  it('subscribes and unsubscribes a regular channel', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    await (server as any).handleSubscribe(client, { channel: 'system' });
    expect(client.subscriptions.has('system')).toBe(true);
    expect((server as any).subscriptions.get('system')?.has(client)).toBe(true);

    (server as any).handleUnsubscribe(client, { channel: 'system' });
    const payload = parseLastSend(client);
    expect(payload.type).toBe('unsubscribed');
    expect(client.subscriptions.has('system')).toBe(false);
    expect((server as any).subscriptions.has('system')).toBe(false);
  });

  it('subscribes wallet channel when regex does not match and skips access check', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const existingClient = createClient();
    const client = createClient({ userId: 'user-1' });
    (server as any).subscriptions.set('wallet:INVALID_ID', new Set([existingClient]));

    await (server as any).handleSubscribe(client, { channel: 'wallet:INVALID_ID' });

    expect(mockCheckWalletAccess).not.toHaveBeenCalled();
    expect((server as any).subscriptions.get('wallet:INVALID_ID')?.has(existingClient)).toBe(true);
    expect((server as any).subscriptions.get('wallet:INVALID_ID')?.has(client)).toBe(true);
  });

  it('subscribes wallet channel when access check passes', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({ userId: 'user-1' });

    await (server as any).handleSubscribe(client, { channel: 'wallet:deadbeef' });

    expect(mockCheckWalletAccess).toHaveBeenCalledWith('deadbeef', 'user-1');
    const payload = parseLastSend(client);
    expect(payload.type).toBe('subscribed');
    expect(payload.data.channel).toBe('wallet:deadbeef');
  });

  it('returns early when unsubscribing a channel client is not subscribed to', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();

    (server as any).handleUnsubscribe(client, { channel: 'missing' });

    expect(client.send).not.toHaveBeenCalled();
  });

  it('unsubscribes even when server channel set is missing', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    client.subscriptions.add('ghost');

    (server as any).handleUnsubscribe(client, { channel: 'ghost' });

    const payload = parseLastSend(client);
    expect(payload.type).toBe('unsubscribed');
    expect(payload.data.channel).toBe('ghost');
    expect((server as any).subscriptions.has('ghost')).toBe(false);
  });

  it('keeps channel subscription set when other subscribers remain on unsubscribe', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient();
    const other = createClient();
    client.subscriptions.add('system');
    other.subscriptions.add('system');
    (server as any).subscriptions.set('system', new Set([client, other]));

    (server as any).handleUnsubscribe(client, { channel: 'system' });

    expect((server as any).subscriptions.has('system')).toBe(true);
    expect((server as any).subscriptions.get('system')?.has(other)).toBe(true);
  });

  it('re-queues when socket buffer is full and resumes on drain', async () => {
    const Server = await loadServer();
    const server = new Server();
    activeServers.push(server);
    const client = createClient({
      bufferedAmount: 70000,
      messageQueue: [JSON.stringify({ type: 'queued' })],
      isProcessingQueue: false,
    });

    (server as any).processClientQueue(client);

    expect(client.send).not.toHaveBeenCalled();
    expect(client.once).toHaveBeenCalledWith('drain', expect.any(Function));
    expect(client.messageQueue).toHaveLength(1);

    client.bufferedAmount = 0;
    client.emit('drain');
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'queued' }));
  });

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
});
