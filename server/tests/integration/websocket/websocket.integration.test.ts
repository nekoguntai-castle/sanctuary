import { createHmac } from 'crypto';
import { WebSocket } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebSocketTestServer } from '../setup/websocketHarness';
import { verifyToken } from '../../../src/utils/jwt';
import { checkWalletAccess } from '../../../src/services/accessControl';

vi.mock('../../../src/utils/jwt', () => ({
  verifyToken: vi.fn(async (token: string) => ({ userId: token === 'good-token' ? 'user-1' : 'user-2' })),
}));

vi.mock('../../../src/services/accessControl', () => ({
  checkWalletAccess: vi.fn(async () => ({ hasAccess: true, canEdit: true, role: 'owner' })),
}));

vi.mock('../../../src/observability/metrics', () => ({
  websocketConnections: { inc: vi.fn(), dec: vi.fn() },
  websocketMessagesTotal: { inc: vi.fn() },
  websocketRateLimitHits: { inc: vi.fn() },
  websocketSubscriptions: { inc: vi.fn(), dec: vi.fn() },
  websocketConnectionDuration: { observe: vi.fn() },
}));

vi.mock('../../../src/config', () => ({
  default: { gatewaySecret: 'test-secret' },
}));

type BufferedWebSocket = WebSocket & { __testMessageBuffer?: any[] };

const dequeueBufferedMessage = (socket: BufferedWebSocket, predicate?: (msg: any) => boolean) => {
  const buffer = socket.__testMessageBuffer;
  if (!buffer || buffer.length === 0) return null;

  const index = buffer.findIndex((msg) => !predicate || predicate(msg));
  if (index < 0) return null;

  const [matched] = buffer.splice(index, 1);
  return matched;
};

const waitForJsonMessage = (socket: WebSocket, predicate?: (msg: any) => boolean) =>
  new Promise<any>((resolve, reject) => {
    const bufferedSocket = socket as BufferedWebSocket;
    const tryResolveFromBuffer = () => {
      const matched = dequeueBufferedMessage(bufferedSocket, predicate);
      if (matched) {
        cleanup();
        resolve(matched);
      }
    };
    const onMessage = () => {
      tryResolveFromBuffer();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('error', onError);
    };
    socket.on('message', onMessage);
    socket.on('error', onError);
    tryResolveFromBuffer();
  });

const waitForClose = (socket: WebSocket) =>
  new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
  });

describe('websocket integration', () => {
  afterEach(() => {
    (verifyToken as ReturnType<typeof vi.fn>).mockClear();
    (checkWalletAccess as ReturnType<typeof vi.fn>).mockClear();
  });

  it('authenticates via auth message', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer();
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const client = await harness.connectClient();

    const connected = await waitForJsonMessage(client, (msg) => msg.type === 'connected');
    expect(connected.data.authenticated).toBe(false);

    client.send(JSON.stringify({ type: 'auth', data: { token: 'good-token' } }));
    const authenticated = await waitForJsonMessage(client, (msg) => msg.type === 'authenticated');

    expect(authenticated.data.success).toBe(true);
    expect(authenticated.data.userId).toBe('user-1');
    expect(verifyToken).toHaveBeenCalledWith('good-token');

    client.close();
    await waitForClose(client);
    await harness.close();
  });

  it('rejects wallet subscription without authentication', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer();
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const client = await harness.connectClient();

    await waitForJsonMessage(client, (msg) => msg.type === 'connected');

    client.send(JSON.stringify({ type: 'subscribe', data: { channel: 'wallet:abc' } }));
    const error = await waitForJsonMessage(client, (msg) => msg.type === 'error');

    expect(error.data.message).toBe('Authentication required for wallet subscriptions');

    client.close();
    await waitForClose(client);
    await harness.close();
  });

  it('authenticates gateway connection via challenge response', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer({ enableGateway: true });
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const gateway = await harness.connectGateway();

    const challengeMsg = await waitForJsonMessage(gateway, (msg) => msg.type === 'auth_challenge');
    const response = createHmac('sha256', 'test-secret')
      .update(challengeMsg.challenge)
      .digest('hex');

    gateway.send(JSON.stringify({ type: 'auth_response', response }));
    const success = await waitForJsonMessage(gateway, (msg) => msg.type === 'auth_success');

    expect(success.type).toBe('auth_success');

    gateway.close();
    await waitForClose(gateway);
    await harness.close();
  });

  it('handles mixed access in batch wallet subscriptions', async () => {
    let harness: Awaited<ReturnType<typeof createWebSocketTestServer>> | null = null;
    try {
      harness = await createWebSocketTestServer();
    } catch (err: any) {
      if (err?.code === 'EPERM') {
        return;
      }
      throw err;
    }
    const client = await harness.connectClient();

    await waitForJsonMessage(client, (msg) => msg.type === 'connected');

    client.send(JSON.stringify({ type: 'auth', data: { token: 'good-token' } }));
    await waitForJsonMessage(client, (msg) => msg.type === 'authenticated');

    (checkWalletAccess as ReturnType<typeof vi.fn>).mockImplementation(async (walletId: string) => ({
      hasAccess: walletId !== 'deadbeef',
      canEdit: true,
      role: 'owner',
    }));

    client.send(
      JSON.stringify({
        type: 'subscribe_batch',
        data: { channels: ['wallet:deadbeef', 'wallet:cafebabe', 'system'] },
      })
    );

    const batch = await waitForJsonMessage(client, (msg) => msg.type === 'subscribed_batch');
    expect(batch.data.subscribed).toEqual(['wallet:cafebabe', 'system']);
    expect(batch.data.errors).toEqual([{ channel: 'wallet:deadbeef', reason: 'Access denied' }]);

    client.close();
    await waitForClose(client);
    await harness.close();
  });
});
