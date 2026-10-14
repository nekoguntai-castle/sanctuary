/**
 * WebSocket frame-size caps
 *
 * `ws` buffers a whole frame before the rate limiter or schema runs, and `/ws`
 * accepts unauthenticated sockets, so both servers must pass a small
 * `maxPayload`. Uses real `ws` sockets on an ephemeral port.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import { WebSocket } from 'ws';

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock('../../../src/config', () => ({
  __esModule: true,
  default: { gatewaySecret: 'gateway-secret', jwtSecret: 'test-secret' },
}));
vi.mock('../../../src/websocket/gatewayEventMapper', () => ({
  mapGatewayEvent: vi.fn(async (event: unknown) => event),
}));

import { SanctauryWebSocketServer } from '../../../src/websocket/clientServer';
import { GatewayWebSocketServer } from '../../../src/websocket/gatewayServer';
import {
  CLIENT_WS_MAX_PAYLOAD_BYTES,
  GATEWAY_WS_MAX_PAYLOAD_BYTES,
} from '../../../src/websocket/types';

type UpgradeHandler = { handleUpgrade(req: any, socket: any, head: Buffer): void };

function listen(target: UpgradeHandler): Promise<{ http: Server; url: string }> {
  const http = createServer();
  http.on('upgrade', (req, socket, head) => target.handleUpgrade(req, socket, head));
  return new Promise((resolve) => {
    http.listen(0, '127.0.0.1', () => {
      resolve({ http, url: `ws://127.0.0.1:${(http.address() as AddressInfo).port}` });
    });
  });
}

function open(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));

describe('websocket maxPayload', () => {
  const uncaught = vi.fn();
  let http: Server | undefined;
  let stop: (() => void) | undefined;

  beforeEach(() => process.on('uncaughtException', uncaught));
  afterEach(() => {
    process.off('uncaughtException', uncaught);
    uncaught.mockClear();
    stop?.();
    http?.closeAllConnections();
    http?.close();
  });

  it('keeps the caps small relative to the ws default of 100 MiB', () => {
    expect(CLIENT_WS_MAX_PAYLOAD_BYTES).toBe(1024 * 1024);
    expect(GATEWAY_WS_MAX_PAYLOAD_BYTES).toBe(64 * 1024);
  });

  it('closes an unauthenticated client socket with 1009 on an oversized frame and keeps serving', async () => {
    const server = new SanctauryWebSocketServer();
    stop = () => server.close?.();
    const listening = await listen(server as unknown as UpgradeHandler);
    http = listening.http;

    const oversized = await open(`${listening.url}/ws`);
    const closed = closeCode(oversized);
    oversized.send(Buffer.alloc(CLIENT_WS_MAX_PAYLOAD_BYTES + 1, 0x61));
    await expect(closed).resolves.toBe(1009);

    const next = await open(`${listening.url}/ws`);
    expect(next.readyState).toBe(WebSocket.OPEN);
    next.close();
    expect(uncaught).not.toHaveBeenCalled();
  });

  it('closes a gateway socket with 1009 on a frame above 64 KiB', async () => {
    const server = new GatewayWebSocketServer();
    stop = () => server.close?.();
    const listening = await listen(server as unknown as UpgradeHandler);
    http = listening.http;

    const oversized = await open(`${listening.url}/gateway`);
    const closed = closeCode(oversized);
    oversized.send(Buffer.alloc(GATEWAY_WS_MAX_PAYLOAD_BYTES + 1, 0x61));
    await expect(closed).resolves.toBe(1009);

    const next = await open(`${listening.url}/gateway`);
    expect(next.readyState).toBe(WebSocket.OPEN);
    next.close();
    expect(uncaught).not.toHaveBeenCalled();
  });
});
