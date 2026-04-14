import { expect, it } from 'vitest';

import {
  activeServers,
  createClient,
  flushMicrotasks,
  loadModule,
  loadServer,
  mockCheckWalletAccess,
  parseLastSend,
} from './clientServerLimitsTestHarness';

export const registerClientServerLimitBatchRateContracts = () => {
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
};
