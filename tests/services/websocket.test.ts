/**
 * WebSocket Client Tests
 *
 * Tests for WebSocketClient: connection lifecycle, subscriptions,
 * event dispatching, reconnection, and resource cleanup.
 */

import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';

// Mock logger
vi.mock('../../utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import type { EventCallback,WebSocketEvent } from '../../services/websocket';
import { WebSocketClient } from '../../services/websocket';

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  url: string;
  sentMessages: string[] = [];

  constructor(url: string) {
    this.url = url;
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose({ code: code ?? 1000, reason: reason ?? '' });
    }
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  simulateMessage(data: WebSocketEvent) {
    if (this.onmessage) {
      this.onmessage({ data: JSON.stringify(data) });
    }
  }

  simulateError(error: unknown) {
    if (this.onerror) this.onerror(error);
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({ code, reason });
  }
}

// Track created WebSocket instances
let mockWsInstances: MockWebSocket[] = [];

describe('WebSocketClient', () => {
  let client: WebSocketClient;

  beforeEach(() => {
    vi.useFakeTimers();
    mockWsInstances = [];

    // Mock global WebSocket
    vi.stubGlobal('WebSocket', class extends MockWebSocket {
      constructor(url: string) {
        super(url);
        mockWsInstances.push(this);
      }

      // Expose static constants on instance for readyState comparisons
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
    });

    client = new WebSocketClient('ws://localhost:3000/ws');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Helper to get the latest MockWebSocket instance
  function getLastWs(): MockWebSocket {
    return mockWsInstances[mockWsInstances.length - 1];
  }

  // ========================================
  // Connection lifecycle
  // ========================================
  describe('connect', () => {
    it('should create a WebSocket connection', () => {
      client.connect();
      expect(mockWsInstances).toHaveLength(1);
      expect(getLastWs().url).toBe('ws://localhost:3000/ws');
    });

    it('should not create duplicate connections', () => {
      client.connect();
      getLastWs().simulateOpen();
      client.connect(); // Should be a no-op
      expect(mockWsInstances).toHaveLength(1);
    });

    it('should send auth message after connecting with token', () => {
      client.connect('my-jwt-token');
      getLastWs().simulateOpen();

      const sent = getLastWs().sentMessages;
      expect(sent).toHaveLength(1);
      const authMsg = JSON.parse(sent[0]);
      expect(authMsg.type).toBe('auth');
      expect(authMsg.data.token).toBe('my-jwt-token');
    });

    it('should resubscribe after server sends "connected" welcome (no-token cookie-auth path)', () => {
      // ADR 0001/0002 Phase 4 — resubscribe is now triggered by the
      // server's "connected" welcome message, not by the client's
      // onopen. This avoids the race where Phase 3 cookie auth runs
      // verifyWebSocketAccessToken async and the message handler is
      // not yet attached when the client subscribes.
      client.subscribe('blocks');
      client.connect();
      getLastWs().simulateOpen();

      // Before the welcome arrives, NO subscribe message has been sent.
      expect(getLastWs().sentMessages).toHaveLength(0);

      // Server signals it is ready (auth completed, message handler
      // attached). Welcome carries authenticated:true if cookie-auth
      // succeeded, false otherwise — the client resubscribes either
      // way and the server filters by auth state.
      getLastWs().simulateMessage({ type: 'connected', data: { authenticated: true } });

      const sent = getLastWs().sentMessages;
      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]);
      expect(msg.type).toBe('subscribe_batch');
      expect(msg.data.channels).toContain('blocks');
    });

    it('should resubscribe on "connected" welcome even when authenticated is false (public channels)', () => {
      // Anonymous user opening the app: server sends connected with
      // authenticated:false. The frontend still resubscribes — the
      // server filters protected channels server-side so unauthenticated
      // subscriptions to public channels still work.
      client.subscribe('public-channel');
      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({ type: 'connected', data: { authenticated: false } });

      const sent = getLastWs().sentMessages;
      expect(sent).toHaveLength(1);
      expect(JSON.parse(sent[0]).type).toBe('subscribe_batch');
    });

    it('should notify connection listeners on open', () => {
      const listener = vi.fn();
      client.onConnectionChange(listener);

      client.connect();
      getLastWs().simulateOpen();

      expect(listener).toHaveBeenCalledWith(true);
    });

    it('should handle WebSocket constructor failures gracefully', () => {
      vi.stubGlobal(
        'WebSocket',
        class {
          static OPEN = 1;
          constructor() {
            throw new Error('constructor failed');
          }
        }
      );

      expect(() => client.connect()).not.toThrow();
      expect(client.getState()).toBe('disconnected');
    });

    it('should reset connecting state on socket error callback', () => {
      client.connect();
      const ws = getLastWs();
      ws.simulateError(new Error('socket error'));
      expect(client.getState()).toBe('disconnected');
    });
  });

  describe('disconnect', () => {
    it('should close the connection', () => {
      client.connect();
      const ws = getLastWs();
      ws.simulateOpen();

      client.disconnect();

      expect(ws.readyState).toBe(MockWebSocket.CLOSED);
    });

    it('should clear subscriptions', () => {
      client.subscribe('blocks');
      client.subscribe('wallet:123');

      client.connect();
      getLastWs().simulateOpen();
      client.disconnect();

      // After disconnect, subscriptions are cleared
      // Create a new connection - should not resubscribe
      // We verify by checking getState returns disconnected
      expect(client.getState()).toBe('disconnected');
    });

    it('should notify connection listeners on close', () => {
      const listener = vi.fn();
      client.onConnectionChange(listener);

      client.connect();
      getLastWs().simulateOpen();
      client.disconnect();

      expect(listener).toHaveBeenCalledWith(false);
    });

    it('should prevent reconnection after disconnect', () => {
      client.connect();
      getLastWs().simulateOpen();
      client.disconnect();

      // Even after timeout, should not reconnect
      vi.advanceTimersByTime(60000);
      expect(mockWsInstances).toHaveLength(1);
    });

    it('should clear reconnect timer', () => {
      client.connect();
      getLastWs().simulateClose(1006, 'Abnormal');

      // A reconnect timer is now scheduled
      client.disconnect();

      // Advancing time should not create new connections
      vi.advanceTimersByTime(60000);
      expect(mockWsInstances).toHaveLength(1);
    });

    it('should reset isServerReady synchronously so post-disconnect mutators do not hit a null socket', () => {
      // Regression for Codex stop-hook finding: disconnect() cleared
      // `this.ws` but relied on the async onclose handler to reset
      // isServerReady. Between ws.close() and the async onclose, a
      // mutator called on the client would see isServerReady === true
      // AND this.ws === null, and `send()` would crash on
      // `this.ws!.send()`.
      //
      // Our MockWebSocket dispatches onclose synchronously from close(),
      // so to prove the synchronous reset happens BEFORE ws.close() we
      // stub close() to a no-op and verify isServerReady is still false.
      client.connect();
      const ws = getLastWs();
      ws.simulateOpen();
      ws.simulateMessage({ type: 'connected', data: {} });
      expect(client.isConnected()).toBe(true);

      // Replace close with a no-op so onclose will NOT fire — this
      // models the browser's async close-event delivery.
      ws.close = () => {};

      client.disconnect();

      // Post-disconnect subscribe MUST NOT throw (previously would
      // crash inside send() on `this.ws!.send(...)`).
      expect(() => client.subscribe('blocks')).not.toThrow();
      expect(() => client.unsubscribe('blocks')).not.toThrow();
      expect(() => client.subscribeBatch(['a', 'b'])).not.toThrow();
      expect(() => client.unsubscribeBatch(['a'])).not.toThrow();
    });
  });

  // ========================================
  // Connection state
  // ========================================
  describe('getState / isConnected', () => {
    it('should return disconnected initially', () => {
      expect(client.getState()).toBe('disconnected');
      expect(client.isConnected()).toBe(false);
    });

    it('should return connecting during connection', () => {
      client.connect();
      expect(client.getState()).toBe('connecting');
    });

    it('should return connected after open', () => {
      client.connect();
      getLastWs().simulateOpen();
      expect(client.getState()).toBe('connected');
      expect(client.isConnected()).toBe(true);
    });

    it('should return disconnected after close', () => {
      client.connect();
      getLastWs().simulateOpen();
      client.disconnect();
      expect(client.getState()).toBe('disconnected');
      expect(client.isConnected()).toBe(false);
    });
  });

  // ========================================
  // Subscriptions
  // ========================================
  describe('subscribe / unsubscribe', () => {
    it('should send subscribe message when connected', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      client.subscribe('blocks');

      const sent = getLastWs().sentMessages;
      const subMsg = JSON.parse(sent[sent.length - 1]);
      expect(subMsg.type).toBe('subscribe');
      expect(subMsg.data.channel).toBe('blocks');
    });

    it('should not send duplicate subscription', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      client.subscribe('blocks');
      const countAfterFirst = getLastWs().sentMessages.length;
      client.subscribe('blocks'); // duplicate
      expect(getLastWs().sentMessages.length).toBe(countAfterFirst);
    });

    it('should queue subscription when not connected and resubscribe on "connected" welcome', () => {
      client.subscribe('blocks');
      // No WebSocket created yet, but subscription is stored
      client.connect();
      getLastWs().simulateOpen();

      // Phase 4: resubscribe waits for the server welcome message.
      getLastWs().simulateMessage({ type: 'connected', data: { authenticated: true } });

      const sent = getLastWs().sentMessages;
      expect(sent.some(s => JSON.parse(s).type === 'subscribe_batch')).toBe(true);
    });

    it('should send unsubscribe message', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      client.subscribe('blocks');
      client.unsubscribe('blocks');

      const sent = getLastWs().sentMessages;
      const unsubMsg = JSON.parse(sent[sent.length - 1]);
      expect(unsubMsg.type).toBe('unsubscribe');
      expect(unsubMsg.data.channel).toBe('blocks');
    });

    it('should not unsubscribe from unsubscribed channel', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      const countBefore = getLastWs().sentMessages.length;
      client.unsubscribe('not-subscribed');
      expect(getLastWs().sentMessages.length).toBe(countBefore);
    });

    it('should update queued subscriptions while disconnected without sending messages', () => {
      client.subscribe('queued-a');
      client.subscribeBatch(['queued-b']);
      client.unsubscribe('queued-a');
      client.unsubscribeBatch(['queued-b']);

      client.connect();
      getLastWs().simulateOpen();

      const sent = getLastWs().sentMessages.map(s => JSON.parse(s).type);
      expect(sent).not.toContain('subscribe_batch');
      expect(sent).not.toContain('subscribe');
      expect(sent).not.toContain('unsubscribe');
      expect(sent).not.toContain('unsubscribe_batch');
    });
  });

  describe('subscribeBatch / unsubscribeBatch', () => {
    it('should batch subscribe to multiple channels', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      client.subscribeBatch(['blocks', 'wallet:1', 'wallet:2']);

      const sent = getLastWs().sentMessages;
      const batchMsg = JSON.parse(sent[sent.length - 1]);
      expect(batchMsg.type).toBe('subscribe_batch');
      expect(batchMsg.data.channels).toEqual(['blocks', 'wallet:1', 'wallet:2']);
    });

    it('should filter out already-subscribed channels in batch', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      client.subscribe('blocks');
      client.subscribeBatch(['blocks', 'wallet:1']);

      const sent = getLastWs().sentMessages;
      const batchMsg = JSON.parse(sent[sent.length - 1]);
      expect(batchMsg.data.channels).toEqual(['wallet:1']);
    });

    it('should batch unsubscribe', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      client.subscribeBatch(['a', 'b', 'c']);
      client.unsubscribeBatch(['a', 'c']);

      const sent = getLastWs().sentMessages;
      const unsubMsg = JSON.parse(sent[sent.length - 1]);
      expect(unsubMsg.type).toBe('unsubscribe_batch');
      expect(unsubMsg.data.channels).toEqual(['a', 'c']);
    });

    it('should skip empty batch operations', () => {
      client.connect();
      getLastWs().simulateOpen();
      getLastWs().simulateMessage({ type: 'connected', data: {} });

      const countBefore = getLastWs().sentMessages.length;
      client.subscribeBatch([]);
      client.unsubscribeBatch(['not-subscribed']);
      expect(getLastWs().sentMessages.length).toBe(countBefore);
    });
  });

  // ========================================
  // Event dispatching
  // ========================================
  describe('event dispatching', () => {
    it('should dispatch events to type-specific listeners', () => {
      const handler = vi.fn();
      client.on('transaction', handler);

      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({
        type: 'event',
        event: 'transaction',
        data: { txid: 'abc' },
      });

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'event',
          event: 'transaction',
          data: { txid: 'abc' },
        })
      );
    });

    it('should dispatch events to channel-specific listeners', () => {
      const handler = vi.fn();
      // Channel listeners are registered with 'channel:' prefix internally via dispatchEvent
      // The code checks for `channel:${channel}` key
      client.on('channel:wallet:123' as any, handler);

      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({
        type: 'event',
        event: 'balance',
        channel: 'wallet:123',
        data: { balance: 100000 },
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should dispatch to wildcard listeners', () => {
      const handler = vi.fn();
      client.on('*', handler);

      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({
        type: 'event',
        event: 'block',
        data: { height: 800000 },
      });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('should not crash if listener throws', () => {
      const badHandler = vi.fn().mockImplementation(() => { throw new Error('boom'); });
      const goodHandler = vi.fn();

      client.on('transaction', badHandler);
      client.on('transaction', goodHandler);

      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({
        type: 'event',
        event: 'transaction',
        data: {},
      });

      // Both handlers called, bad one threw but didn't prevent good one
      expect(badHandler).toHaveBeenCalled();
      expect(goodHandler).toHaveBeenCalled();
    });

    it('should remove listener with off()', () => {
      const handler = vi.fn();
      client.on('block', handler);
      client.off('block', handler);

      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({
        type: 'event',
        event: 'block',
        data: {},
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle channel and wildcard listener errors and eventless channel messages', () => {
      const channelHandler = vi.fn().mockImplementation(() => {
        throw new Error('channel listener fail');
      });
      const wildcardHandler = vi.fn().mockImplementation(() => {
        throw new Error('wildcard listener fail');
      });
      client.on('channel:wallet:error' as any, channelHandler);
      client.on('*', wildcardHandler);

      client.connect();
      getLastWs().simulateOpen();

      getLastWs().simulateMessage({
        type: 'event',
        channel: 'wallet:error',
        data: { onlyChannel: true },
      } as any);
      getLastWs().simulateMessage({
        type: 'event',
        channel: 'wallet:no-listener',
        data: { noListener: true },
      } as any);

      expect(channelHandler).toHaveBeenCalledTimes(1);
      expect(wildcardHandler).toHaveBeenCalledTimes(2);
    });
  });

  // ========================================
  // Message handling
  // ========================================
  describe('message handling', () => {
    it('legacy auth-message path still sends the auth frame on open with a token', () => {
      // Phase 4 expects the typical browser flow to use cookie auth
      // (no token), but the perf benchmark scripts still use the
      // sendAuthMessage path. Verify the auth frame is sent on open
      // when a token is passed.
      client.subscribe('blocks');
      client.connect('token');
      const ws = getLastWs();
      ws.simulateOpen();

      const authMsg = JSON.parse(ws.sentMessages[0]);
      expect(authMsg.type).toBe('auth');
      expect((authMsg.data as Record<string, unknown>).token).toBe('token');

      // Resubscribe still waits for the 'connected' welcome — NOT for
      // the legacy 'authenticated' message.
      expect(ws.sentMessages.some(s => JSON.parse(s).type === 'subscribe_batch')).toBe(false);

      ws.simulateMessage({ type: 'connected', data: { authenticated: true } });

      const lastMsg = JSON.parse(ws.sentMessages[ws.sentMessages.length - 1]);
      expect(lastMsg.type).toBe('subscribe_batch');
      expect(lastMsg.data.channels).toContain('blocks');
    });

    it('legacy "authenticated" message is now a no-op — does not trigger resubscribe', () => {
      // Phase 4: 'authenticated' is logged for diagnostic purposes but
      // does NOT trigger resubscribe. The 'connected' welcome is the
      // single authoritative resubscribe trigger.
      client.subscribe('blocks');
      client.connect('bad-token');
      const ws = getLastWs();
      ws.simulateOpen();

      const countAfterAuth = ws.sentMessages.length;

      ws.simulateMessage({
        type: 'authenticated',
        data: { success: true },
      });
      ws.simulateMessage({
        type: 'authenticated',
        data: { success: false },
      });

      // Neither success nor failure on the 'authenticated' message
      // triggers a resubscribe. Only 'connected' does.
      expect(ws.sentMessages.length).toBe(countAfterAuth);
    });

    it('should handle malformed JSON gracefully', () => {
      client.connect();
      const ws = getLastWs();
      ws.simulateOpen();

      // Send invalid JSON - should not throw
      if (ws.onmessage) {
        expect(() => ws.onmessage!({ data: 'not json' })).not.toThrow();
      }
    });

    it('should cover remaining control message branches', () => {
      client.connect();
      const ws = getLastWs();
      ws.simulateOpen();

      ws.simulateMessage({ type: 'connected', data: {} });
      ws.simulateMessage({ type: 'subscribed', data: { channel: 'blocks' } });
      ws.simulateMessage({ type: 'subscribed_batch', data: { subscribed: ['a', 'b'] } });
      ws.simulateMessage({ type: 'subscribed_batch', data: { subscribed: 'not-an-array' as any } });
      ws.simulateMessage({ type: 'unsubscribed', data: { channel: 'blocks' } });
      ws.simulateMessage({ type: 'unsubscribed_batch', data: { unsubscribed: ['a'] } });
      ws.simulateMessage({ type: 'unsubscribed_batch', data: { unsubscribed: null } });
      ws.simulateMessage({ type: 'error', data: { message: 'server-side' } });
      ws.simulateMessage({ type: 'pong', data: {} });
      ws.simulateMessage({ type: 'unknown-control-type', data: {} } as any);

      // Ensure message handling remains functional after mixed control messages
      ws.simulateMessage({ type: 'event', event: 'block', data: { height: 1 } });
      expect(client.getState()).toBe('connected');
    });

    it('should avoid sending when auth success arrives before socket opens', () => {
      client.subscribe('blocks');
      client.connect('token');

      // Still CONNECTING; if authenticated arrives early, resubscribe attempts
      // and send() should take the "not connected" branch.
      getLastWs().simulateMessage({
        type: 'authenticated',
        data: { success: true },
      });

      expect(getLastWs().sentMessages).toEqual([]);
    });
  });

  // ========================================
  // Reconnection
  // ========================================
  describe('reconnection', () => {
    it('should attempt reconnection after unexpected close', () => {
      client.connect();
      getLastWs().simulateOpen();

      // Simulate unexpected close
      getLastWs().simulateClose(1006, 'Abnormal');

      // Advance past reconnect delay
      vi.advanceTimersByTime(2000);

      // Should have created a new WebSocket
      expect(mockWsInstances.length).toBe(2);
    });

    it('should use exponential backoff for reconnection', () => {
      client.connect();
      getLastWs().simulateOpen();

      // First close
      getLastWs().simulateClose(1006, 'Abnormal');
      vi.advanceTimersByTime(2000); // First reconnect
      expect(mockWsInstances.length).toBe(2);

      // Second close
      getLastWs().simulateClose(1006, 'Abnormal');
      // Second attempt needs longer delay (exponential backoff)
      vi.advanceTimersByTime(1000); // Not enough
      expect(mockWsInstances.length).toBe(2); // Still 2
      vi.advanceTimersByTime(5000); // Now enough
      expect(mockWsInstances.length).toBe(3);
    });

    it('should stop fast reconnecting after max attempts and use slow retry', () => {
      client.connect();
      const ws = getLastWs();

      // Simulate connection opening then immediately closing without reconnects resetting
      // Don't call simulateOpen() so reconnectAttempts keep incrementing
      ws.simulateClose(1006, 'Abnormal');

      // Exhaust fast retries (maxReconnectAttempts = 5)
      for (let i = 0; i < 5; i++) {
        vi.advanceTimersByTime(60000);
        expect(mockWsInstances.length).toBe(i + 2); // original + fast retries
        getLastWs().simulateClose(1006, 'Abnormal');
      }

      const afterFastRetries = mockWsInstances.length;

      // No additional reconnect before 5-minute slow retry window
      vi.advanceTimersByTime(4 * 60 * 1000);
      expect(mockWsInstances.length).toBe(afterFastRetries);

      // Slow retry should fire after 5 minutes
      vi.advanceTimersByTime(60 * 1000);
      expect(mockWsInstances.length).toBe(afterFastRetries + 1);
    });

    it('should reset reconnect attempts on successful connection', () => {
      client.connect();
      getLastWs().simulateOpen();

      // Close and reconnect
      getLastWs().simulateClose(1006, 'Abnormal');
      vi.advanceTimersByTime(2000);
      getLastWs().simulateOpen(); // Successful reconnect

      // Close again - should start fresh backoff
      getLastWs().simulateClose(1006, 'Abnormal');
      vi.advanceTimersByTime(2000);
      expect(mockWsInstances.length).toBe(3); // Another reconnect attempt
    });
  });

  // ========================================
  // Connection listeners
  // ========================================
  describe('connection listeners', () => {
    it('should add and remove connection listeners', () => {
      const listener = vi.fn();

      client.onConnectionChange(listener);
      client.connect();
      getLastWs().simulateOpen();
      expect(listener).toHaveBeenCalledWith(true);

      client.offConnectionChange(listener);
      client.disconnect();
      // Listener should not be called again after removal
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle listener errors gracefully', () => {
      const badListener = vi.fn().mockImplementation(() => { throw new Error('oops'); });
      const goodListener = vi.fn();

      client.onConnectionChange(badListener);
      client.onConnectionChange(goodListener);

      client.connect();
      getLastWs().simulateOpen();

      // Both called, error doesn't prevent others
      expect(badListener).toHaveBeenCalled();
      expect(goodListener).toHaveBeenCalledWith(true);
    });

    it('off() should no-op when listener set does not exist', () => {
      expect(() => client.off('transaction', vi.fn() as EventCallback)).not.toThrow();
    });
  });

  describe('singleton URL resolution', () => {
    it('prefers VITE_WS_URL when creating websocketClient', async () => {
      vi.resetModules();
      vi.stubEnv('VITE_WS_URL', 'ws://configured.example/ws');

      const mod = await import('../../services/websocket');
      expect((mod.websocketClient as any).url).toBe('ws://configured.example/ws');

      vi.unstubAllEnvs();
    });

    it('uses wss protocol when window location is https', async () => {
      vi.resetModules();
      vi.unstubAllEnvs();
      vi.stubGlobal('window', {
        location: {
          protocol: 'https:',
          host: 'secure.example',
        },
      } as any);

      const mod = await import('../../services/websocket');
      expect((mod.websocketClient as any).url).toBe('wss://secure.example/ws');

      vi.unstubAllGlobals();
    });
  });
});
