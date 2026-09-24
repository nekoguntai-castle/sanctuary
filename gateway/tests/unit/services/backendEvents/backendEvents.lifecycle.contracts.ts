import { describe, expect, it, vi } from 'vitest';

import {
  setupBackendEventsTestHarness,
  startBackendEvents,
  stopBackendEvents,
  logger,
  mockDeviceFetchResponse,
  mockFetch,
  push,
  wsConstructorSpy,
  wsInstances,
} from './backendEventsTestHarness';

describe('Backend Events Service lifecycle', () => {
  setupBackendEventsTestHarness();

  describe('startBackendEvents', () => {
    it('should create WebSocket connection to backend', () => {
      startBackendEvents();

      expect(wsConstructorSpy).toHaveBeenCalledWith('ws://localhost:3000/gateway');
    });

    it('should set up event handlers on WebSocket', () => {
      startBackendEvents();

      const ws = wsInstances[0];
      expect(ws.listenerCount('open')).toBe(1);
      expect(ws.listenerCount('message')).toBe(1);
      expect(ws.listenerCount('close')).toBe(1);
      expect(ws.listenerCount('error')).toBe(1);
    });
  });

  describe('stopBackendEvents', () => {
    it('should close WebSocket connection', () => {
      startBackendEvents();
      const ws = wsInstances[0];

      stopBackendEvents();

      expect(ws.close).toHaveBeenCalled();
    });

    it('should clear reconnect timer', () => {
      startBackendEvents();

      const ws = wsInstances[0];
      ws.simulateClose();

      stopBackendEvents();

      vi.advanceTimersByTime(10000);

      expect(wsInstances.length).toBe(1);
    });

    it('waits for an accepted device lookup before stopping', async () => {
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 50000 },
        },
      });

      let stopped = false;
      const stopping = stopBackendEvents().then(() => { stopped = true; });
      await Promise.resolve();
      expect(stopped).toBe(false);

      resolveFetch({ ok: true, json: () => Promise.resolve([]) });
      await stopping;
      expect(stopped).toBe(true);
    });

    it('waits for every accepted event before stopping', async () => {
      let resolveFirst!: (value: unknown) => void;
      let resolveSecond!: (value: unknown) => void;
      mockFetch
        .mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
        .mockReturnValueOnce(new Promise(resolve => { resolveSecond = resolve; }));
      startBackendEvents();
      const ws = wsInstances[0];
      for (const txid of ['first', 'second']) {
        ws.simulateMessage({
          type: 'event',
          event: {
            type: 'transaction',
            walletId: 'wallet-1',
            userId: 'user-123',
            data: { txid, type: 'received', amount: 1 },
          },
        });
      }
      const stopping = stopBackendEvents();
      let stopped = false;
      void stopping.then(() => { stopped = true; });

      resolveFirst({ ok: true, json: () => Promise.resolve([]) });
      await Promise.resolve();
      await Promise.resolve();
      expect(stopped).toBe(false);
      resolveSecond({ ok: true, json: () => Promise.resolve([]) });
      await stopping;
      expect(stopped).toBe(true);
    });

    it('defers a restart until accepted work has drained', async () => {
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
      startBackendEvents();
      wsInstances[0].simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 1 },
        },
      });

      const stopping = stopBackendEvents();
      startBackendEvents();
      expect(wsInstances).toHaveLength(1);
      resolveFetch({ ok: true, json: () => Promise.resolve([]) });
      await stopping;
      await Promise.resolve();

      expect(wsInstances).toHaveLength(2);
    });

    it('cancels a deferred restart when stop is requested again', async () => {
      let resolveFetch!: (value: unknown) => void;
      mockFetch.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));
      startBackendEvents();
      wsInstances[0].simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 1 },
        },
      });

      const firstStop = stopBackendEvents();
      startBackendEvents();
      const secondStop = stopBackendEvents();
      expect(secondStop).toBe(firstStop);
      resolveFetch({ ok: true, json: () => Promise.resolve([]) });
      await secondStop;
      await Promise.resolve();

      expect(wsInstances).toHaveLength(1);
    });

    it('ignores buffered messages from a retired socket after restart', async () => {
      startBackendEvents();
      const retiredSocket = wsInstances[0];
      await stopBackendEvents();
      startBackendEvents();
      expect(wsInstances).toHaveLength(2);

      retiredSocket.simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          userId: 'user-123',
          data: { txid: 'stale', type: 'received', amount: 1 },
        },
      });
      retiredSocket.simulateMessage({
        type: 'auth_challenge',
        challenge: 'stale-challenge',
      });
      await Promise.resolve();

      expect(mockFetch).not.toHaveBeenCalled();
      expect(retiredSocket.send).not.toHaveBeenCalled();

      retiredSocket.simulateClose();
      vi.advanceTimersByTime(5000);
      expect(wsInstances).toHaveLength(2);
    });

    it('waits for accepted provider delivery and ignores later events', async () => {
      let resolveDelivery!: (value: unknown) => void;
      mockDeviceFetchResponse();
      push.sendToDevices.mockReturnValue(new Promise(resolve => { resolveDelivery = resolve; }));
      startBackendEvents();
      const ws = wsInstances[0];
      const event = {
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 50000 },
        },
      };
      ws.simulateMessage(event);
      await vi.waitFor(() => expect(push.sendToDevices).toHaveBeenCalledOnce());

      let stopped = false;
      const stopping = stopBackendEvents().then(() => { stopped = true; });
      ws.simulateMessage(event);
      await Promise.resolve();
      expect(stopped).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      resolveDelivery({ success: 1, failed: 0, invalidTokens: [] });
      await stopping;
      expect(stopped).toBe(true);
    });

    it('contains rejected accepted work and removes it from the drain', async () => {
      mockDeviceFetchResponse();
      push.sendToDevices.mockRejectedValue(new Error('provider unavailable'));
      startBackendEvents();
      wsInstances[0].simulateMessage({
        type: 'event',
        event: {
          type: 'transaction',
          walletId: 'wallet-1',
          walletName: 'Main Wallet',
          userId: 'user-123',
          data: { txid: 'abc123', type: 'received', amount: 50000 },
        },
      });

      await stopBackendEvents();

      expect(logger.error).toHaveBeenCalledWith('Error handling backend event', {
        error: 'provider unavailable',
      });
      await expect(stopBackendEvents()).resolves.toBeUndefined();
    });
  });

  describe('HMAC authentication', () => {
    it('should respond to auth_challenge with HMAC signature', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({
        type: 'auth_challenge',
        challenge: 'test-challenge-123',
      });

      expect(ws.send).toHaveBeenCalled();
      const sentData = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sentData.type).toBe('auth_response');
      expect(sentData.response).toBeDefined();
      expect(typeof sentData.response).toBe('string');
      expect(sentData.response.length).toBe(64);
    });

    it('should handle auth_success message', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({ type: 'auth_success' });
    });

    it('should handle auth_challenge without challenge data', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({ type: 'auth_challenge' });

      expect(ws.send).not.toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    it('should schedule reconnection after connection close', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateClose(1000, 'Normal closure');

      expect(wsInstances.length).toBe(1);

      vi.advanceTimersByTime(5000);

      expect(wsInstances.length).toBe(2);
    });

    it('should not reconnect when shutting down', () => {
      startBackendEvents();
      const ws = wsInstances[0];

      stopBackendEvents();
      ws.simulateClose();

      vi.advanceTimersByTime(10000);

      expect(wsInstances.length).toBe(1);
    });

    it('should handle WebSocket errors gracefully', () => {
      startBackendEvents();
      const ws = wsInstances[0];

      ws.simulateError(new Error('Connection failed'));

      expect(wsInstances.length).toBe(1);
    });
  });

  describe('message parsing', () => {
    it('should handle invalid JSON messages', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.emit('message', 'not valid json');
    });

    it('should handle unknown message types', () => {
      startBackendEvents();
      const ws = wsInstances[0];
      ws.simulateOpen();

      ws.simulateMessage({ type: 'unknown_type', data: {} });
    });
  });
});
