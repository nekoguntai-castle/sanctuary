import { expect, it } from 'vitest';

import {
  activeServers,
  createClient,
  loadServer,
  mockCheckWalletAccess,
  parseLastSend,
} from './clientServerLimitsTestHarness';

export const registerClientServerLimitSubscriptionContracts = () => {
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
};
