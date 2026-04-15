import { describe, expect, it, vi } from 'vitest';

import {
  setupBackendEventsTestHarness,
  startBackendEvents,
  stopBackendEvents,
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
