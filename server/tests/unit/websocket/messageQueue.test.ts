import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { AuthenticatedWebSocket } from '../../../src/websocket/types';

const mocks = vi.hoisted(() => ({
  metric: vi.fn(), dropped: vi.fn(), rateLimit: vi.fn(), error: vi.fn(),
}));
vi.mock('../../../src/observability/metrics', () => ({ websocketMessagesTotal: { inc: mocks.metric } }));
vi.mock('../../../src/websocket/rateLimiter', () => ({
  recordRateLimitEvent: mocks.rateLimit, incrementDroppedMessages: mocks.dropped,
}));
vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ error: mocks.error, debug: vi.fn(), warn: vi.fn() }),
}));

type Completion = (error?: Error) => void;
function createClient() {
  // Real ws event surface; substitute only public send/close and transport observations.
  const client = new WebSocket(null!, undefined, { autoPong: true }) as AuthenticatedWebSocket;
  Object.defineProperty(client, 'readyState', { value: WebSocket.OPEN, writable: true });
  Object.defineProperty(client, 'bufferedAmount', { value: 70000, writable: true });
  client.messageQueue = [];
  client.isProcessingQueue = false;
  client.isQueueStopped = false;
  client.droppedMessages = 0;
  const callbacks: Completion[] = [];
  const send = vi.spyOn(client, 'send').mockImplementation((_data, callback) => {
    callbacks.push(callback as Completion);
  });
  const close = vi.spyOn(client, 'close').mockImplementation(() => {});
  return { client, callbacks, send, close };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('WS_MAX_QUEUE_SIZE', '2');
  vi.stubEnv('WS_QUEUE_OVERFLOW_POLICY', 'drop_oldest');
});
afterEach(() => vi.unstubAllEnvs());

describe('callback-driven WebSocket queue', () => {
  it('resumes high-buffer transport on send completion without a fabricated drain event', async () => {
    const { sendToClient, processClientQueue } = await import('../../../src/websocket/messageQueue');
    const { client, callbacks, send } = createClient();
    sendToClient(client, { sequence: 1 });
    sendToClient(client, { sequence: 2 });
    processClientQueue(client);
    expect(send).toHaveBeenCalledTimes(1);
    expect(client.listenerCount('drain')).toBe(0);
    expect(client.messageQueue).toEqual(['{"sequence":2}']);
    expect(mocks.metric).toHaveBeenCalledTimes(1);
    callbacks[0]();
    await Promise.resolve();
    expect(send.mock.calls.map(call => call[0])).toEqual(['{"sequence":1}', '{"sequence":2}']);
    callbacks[1]();
    await Promise.resolve();
    expect(client.isProcessingQueue).toBe(false);
  });
  it('keeps one owner through synchronous callbacks without recursive sends', async () => {
    const { processClientQueue } = await import('../../../src/websocket/messageQueue');
    const { client, send } = createClient();
    client.messageQueue = Array.from({ length: 1000 }, (_, index) => String(index));
    let depth = 0;
    let maxDepth = 0;
    send.mockImplementation((_data, callback) => {
      depth++;
      maxDepth = Math.max(maxDepth, depth);
      (callback as Completion)();
      processClientQueue(client);
      depth--;
    });
    processClientQueue(client);
    expect(send).toHaveBeenCalledTimes(1);
    await new Promise(resolve => setImmediate(resolve));
    expect(send).toHaveBeenCalledTimes(1000);
    expect(send.mock.calls.map(call => call[0])).toEqual(Array.from({ length: 1000 }, (_, index) => String(index)));
    expect(maxDepth).toBe(1);
    expect(client.isProcessingQueue).toBe(false);
    expect(client.messageQueue).toEqual([]);
  });

  it.each(['throw', 'callback'] as const)('stops and closes when send reports a %s error', async failure => {
    const { sendToClient } = await import('../../../src/websocket/messageQueue');
    const { client, callbacks, send, close } = createClient();
    if (failure === 'throw') send.mockImplementationOnce(() => { throw new Error('write failed'); });
    sendToClient(client, 'first');
    if (failure === 'callback') {
      sendToClient(client, 'pending');
      callbacks[0](new Error('write failed'));
    }
    expect(client.messageQueue).toEqual([]);
    expect(client.isProcessingQueue).toBe(false);
    expect(client.isQueueStopped).toBe(true);
    expect(client.closeReason).toBe('error');
    expect(close).toHaveBeenCalledWith(1011, 'Message delivery failed');
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.metric).toHaveBeenCalledTimes(failure === 'throw' ? 0 : 1);
    expect(sendToClient(client, 'later')).toBe(false);
  });

  it.each(['success', 'error'] as const)('ignores a late %s completion after terminal cleanup', async outcome => {
    const { sendToClient, processClientQueue, stopClientQueue } = await import('../../../src/websocket/messageQueue');
    const { client, callbacks, send, close } = createClient();
    sendToClient(client, 'first');
    sendToClient(client, 'pending');
    stopClientQueue(client);
    callbacks[0](outcome === 'error' ? new Error('late failure') : undefined);
    await Promise.resolve();
    processClientQueue(client);
    expect(send).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(client.messageQueue).toEqual([]);
    expect(client.isProcessingQueue).toBe(false);
    expect(sendToClient(client, 'later')).toBe(false);
  });

  it.each(['success', 'error'] as const)('preserves intentional closure before a late %s completion', async outcome => {
    const { sendToClient } = await import('../../../src/websocket/messageQueue');
    const { client, callbacks, send, close } = createClient();
    sendToClient(client, 'first');
    sendToClient(client, 'pending');
    client.closeReason = 'auth_expired';
    Object.defineProperty(client, 'readyState', { value: WebSocket.CLOSING });
    callbacks[0](outcome === 'error' ? new Error('socket closed during write') : undefined);
    await Promise.resolve();
    expect(client.isQueueStopped).toBe(true);
    expect(client.messageQueue).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(client.closeReason).toBe('auth_expired');
    expect(close).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(['drop_oldest', 'drop_newest', 'disconnect'] as const)('preserves %s overflow policy during a stalled write', async policy => {
    vi.stubEnv('WS_QUEUE_OVERFLOW_POLICY', policy);
    const { sendToClient } = await import('../../../src/websocket/messageQueue');
    const { client, callbacks, send, close } = createClient();
    sendToClient(client, 1);
    sendToClient(client, 2);
    sendToClient(client, 3);
    const accepted = sendToClient(client, 4);
    expect(accepted).toBe(policy === 'drop_oldest');
    expect(client.messageQueue).toEqual(policy === 'drop_oldest' ? ['3', '4'] : policy === 'drop_newest' ? ['2', '3'] : []);
    expect(mocks.dropped).toHaveBeenCalledTimes(policy === 'disconnect' ? 0 : 1);
    if (policy === 'disconnect') {
      expect(close).toHaveBeenCalledWith(4009, 'Message queue overflow');
      expect(client.isQueueStopped).toBe(true);
      callbacks[0]();
      await Promise.resolve();
      expect(send).toHaveBeenCalledTimes(1);
    } else {
      callbacks[0]();
      await Promise.resolve();
      callbacks[1]();
      await Promise.resolve();
      callbacks[2]();
      await Promise.resolve();
      expect(send.mock.calls.map(call => call[0])).toEqual(policy === 'drop_oldest' ? ['1', '3', '4'] : ['1', '2', '3']);
      expect(client.messageQueue).toEqual([]);
      expect(client.isProcessingQueue).toBe(false);
    }
  });

});
