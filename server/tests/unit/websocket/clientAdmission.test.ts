import { describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { isClientLiveForAdmission } from '../../../src/websocket/clientAdmission';
import type { AuthenticatedWebSocket } from '../../../src/websocket/types';

function client(readyState: number, isQueueStopped: boolean): AuthenticatedWebSocket {
  return { readyState, isQueueStopped } as AuthenticatedWebSocket;
}

describe('WebSocket admission liveness', () => {
  it('accepts only open clients with an active message queue', () => {
    expect(isClientLiveForAdmission(client(WebSocket.OPEN, false))).toBe(true);
    expect(isClientLiveForAdmission(client(WebSocket.OPEN, true))).toBe(false);
    expect(isClientLiveForAdmission(client(WebSocket.CLOSING, false))).toBe(false);
    expect(isClientLiveForAdmission(client(WebSocket.CLOSED, false))).toBe(false);
  });
});
