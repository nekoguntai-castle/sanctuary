import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { z } from 'zod';

const mockLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../../../../src/config', () => ({
  __esModule: true,
  default: {
    bitcoin: {
      electrum: {
        host: 'localhost',
        port: 50001,
        protocol: 'tcp',
      },
    },
  },
  getConfig: () => ({
    electrumClient: {
      requestTimeoutMs: 50,
      batchRequestTimeoutMs: 75,
      connectionTimeoutMs: 40,
      torTimeoutMultiplier: 3,
    },
  }),
}));

vi.mock('../../../../src/models/prisma', () => ({
  __esModule: true,
  default: {
    nodeConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    electrumServer: {
      update: vi.fn().mockResolvedValue({}),
    },
  },
}));

vi.mock('../../../../src/utils/logger', () => ({
  createLogger: () => mockLogger,
}));

import {
  closeAllElectrumClients,
  ElectrumClient,
} from '../../../../src/services/bitcoin/electrum';
import { ELECTRUM_MAX_HISTORY_ITEMS } from '../../../../src/services/bitcoin/electrum/methods';
import {
  ELECTRUM_MAX_HISTORY_BATCH_RESPONSE_BYTES,
  ELECTRUM_MAX_HISTORY_FRAME_BYTES,
  ElectrumFrameDecoder,
} from '../../../../src/services/bitcoin/electrum/protocol';
import { validateResponse } from '../../../../src/services/bitcoin/electrum/types';

class FakeSocket extends EventEmitter {
  write = vi.fn();
  destroy = vi.fn();
  setNoDelay = vi.fn();
  setKeepAlive = vi.fn();
}

const testAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';

function makeClient(): ElectrumClient {
  return new ElectrumClient({
    host: 'localhost',
    port: 50001,
    protocol: 'tcp',
    network: 'testnet3',
    requestTimeoutMs: 30,
    batchRequestTimeoutMs: 50,
  });
}

function attachFakeSocket(client: ElectrumClient): FakeSocket {
  const socket = new FakeSocket();
  (client as any).socket = socket;
  (client as any).connected = true;
  return socket;
}

describe('Electrum history response bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllElectrumClients();
  });

  afterEach(() => {
    closeAllElectrumClients();
    vi.useRealTimers();
  });
+  it('rejects address histories beyond the bounded item budget before schema traversal', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'batchRequest').mockResolvedValue([
      Array.from({ length: ELECTRUM_MAX_HISTORY_ITEMS + 1 }, () => ({
        tx_hash: 'a'.repeat(64),
        height: 1,
      })),
    ]);

    await expect(client.getAddressHistoryBatch([testAddress])).rejects.toThrow(
      `history exceeded ${ELECTRUM_MAX_HISTORY_ITEMS} items`,
    );
    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Electrum address history exceeded the item limit',
      expect.objectContaining({ items: ELECTRUM_MAX_HISTORY_ITEMS + 1 }),
    );
  });

  it('keeps invalid wide-object log previews bounded', () => {
    const wide = Object.fromEntries(Array.from(
      { length: 10_000 },
      (_, index) => [`key-${index}`, 'x'.repeat(1_000)],
    ));

    expect(() => validateResponse(z.object({ required: z.string() }), wide, 'wide')).toThrow(
      'Invalid Electrum response',
    );
    const [, metadata] = mockLogger.warn.mock.calls.at(-1)!;
    expect(metadata.dataPreview.length).toBeLessThanOrEqual(500);
    expect(metadata.dataPreview).not.toContain('key-9999');
  });

  it('rejects pending work and destroys the socket on an oversized frame', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    (client as any).frameDecoder = new ElectrumFrameDecoder(16);
    const pending = (client as any).request('server.ping') as Promise<unknown>;

    (client as any).handleData(Buffer.alloc(17, 0x61));

    await expect(pending).rejects.toThrow('exceeded 16 bytes');
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(false);
    expect((client as any).socket).toBeNull();
    expect((client as any).pendingRequests.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);

    vi.spyOn(client as any, 'establishConnection').mockImplementation(async () => {
      attachFakeSocket(client);
    });
    const recovery = (client as any).request('server.ping') as Promise<unknown>;
    await vi.advanceTimersByTimeAsync(0);
    const recoveryId = [...(client as any).pendingRequests.keys()][0] as number;
    (client as any).handleData(Buffer.from(
      `${JSON.stringify({ id: recoveryId })}\n`,
    ));
    await expect(recovery).resolves.toBeUndefined();
    expect(client.isConnected()).toBe(true);
  });

  it('rejects an oversized history frame before JSON parsing', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const pending = (client as any).request(
      'blockchain.scripthash.get_history',
      ['a'.repeat(64)],
    ) as Promise<unknown>;
    const id = [...(client as any).pendingRequests.keys()][0] as number;
    const frame = Buffer.from(`${JSON.stringify({
      id,
      result: 'x'.repeat(ELECTRUM_MAX_HISTORY_FRAME_BYTES),
    })}\n`);

    (client as any).handleData(frame);

    await expect(pending).rejects.toThrow(
      `exceeded ${ELECTRUM_MAX_HISTORY_FRAME_BYTES} bytes`,
    );
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect((client as any).pendingRequests.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails ambiguous oversized frames closed while history work is pending', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const pending = (client as any).request(
      'blockchain.scripthash.get_history',
      ['a'.repeat(64)],
    ) as Promise<unknown>;
    const frame = Buffer.from(`${JSON.stringify({
      result: 'x'.repeat(ELECTRUM_MAX_HISTORY_FRAME_BYTES),
    })}\n`);

    (client as any).handleData(frame);

    await expect(pending).rejects.toThrow(
      `exceeded ${ELECTRUM_MAX_HISTORY_FRAME_BYTES} bytes`,
    );
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('fails oversized duplicate-id frames closed while history work is pending', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const pending = (client as any).request(
      'blockchain.scripthash.get_history',
      ['a'.repeat(64)],
    ) as Promise<unknown>;
    const id = [...(client as any).pendingRequests.keys()][0] as number;
    const frame = Buffer.from(
      `{"id":null,"result":"${'x'.repeat(ELECTRUM_MAX_HISTORY_FRAME_BYTES)}","id":${id}}\n`,
    );

    (client as any).handleData(frame);

    await expect(pending).rejects.toThrow(
      `exceeded ${ELECTRUM_MAX_HISTORY_FRAME_BYTES} bytes`,
    );
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('fails oversized escaped-id-key frames closed while history work is pending', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const pending = (client as any).request(
      'blockchain.scripthash.get_history',
      ['a'.repeat(64)],
    ) as Promise<unknown>;
    const id = [...(client as any).pendingRequests.keys()][0] as number;
    const frame = Buffer.from(
      `{"id":null,"result":"${'x'.repeat(ELECTRUM_MAX_HISTORY_FRAME_BYTES)}","\\u0069d":${id}}\n`,
    );

    (client as any).handleData(frame);

    await expect(pending).rejects.toThrow(
      `exceeded ${ELECTRUM_MAX_HISTORY_FRAME_BYTES} bytes`,
    );
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('closes a history connection when a partial response outlives its request', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const pending = (client as any).request(
      'blockchain.scripthash.get_history',
      ['a'.repeat(64)],
    ) as Promise<unknown>;
    const id = [...(client as any).pendingRequests.keys()][0] as number;
    (client as any).handleData(Buffer.from(`{"id":${id},"result":"partial`));
    const outcome = pending.then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    );

    await vi.advanceTimersByTimeAsync(30);

    await expect(outcome).resolves.toMatchObject({
      status: 'rejected',
      error: { message: 'Request timeout after 30ms' },
    });
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(client.isConnected()).toBe(false);
    expect((client as any).frameDecoder.bufferedBytes).toBe(0);
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('does not apply a pending history limit to an identified non-history frame', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const ping = (client as any).request('server.ping') as Promise<unknown>;
    const pingId = [...(client as any).pendingRequests.keys()][0] as number;
    const controller = new AbortController();
    const history = (client as any).request(
      'blockchain.scripthash.get_history',
      ['a'.repeat(64)],
      { signal: controller.signal },
    ) as Promise<unknown>;

    (client as any).handleData(Buffer.from(`${JSON.stringify({
      id: pingId,
      result: 'x'.repeat(ELECTRUM_MAX_HISTORY_FRAME_BYTES),
    })}\n`));

    await expect(ping).resolves.toHaveLength(ELECTRUM_MAX_HISTORY_FRAME_BYTES);
    expect(client.isConnected()).toBe(true);
    controller.abort(new Error('history cancelled'));
    await expect(history).rejects.toThrow('history cancelled');
    expect(socket.destroy).toHaveBeenCalledOnce();
  });

  it('tears down a batch before retaining responses beyond its aggregate budget', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    Object.defineProperty(client, 'maxBatchResponseBytes', { value: 100 });
    const batch = (client as any).batchRequest([
      { method: 'server.ping', params: [] },
      { method: 'server.ping', params: [] },
    ]) as Promise<unknown[]>;
    const ids = [...(client as any).pendingRequests.keys()] as number[];

    (client as any).handleData(Buffer.from(
      `${JSON.stringify({ id: ids[0], result: 'x'.repeat(40) })}\n`,
    ));
    (client as any).handleData(Buffer.from(
      `${JSON.stringify({ id: ids[1], result: 'x'.repeat(40) })}\n`,
    ));

    await expect(batch).rejects.toThrow('batch responses exceeded 100 bytes');
    expect(client.isConnected()).toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect((client as any).pendingRequests.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the smaller aggregate response budget for history batches', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const requests = Array.from({ length: 5 }, () => ({
      method: 'blockchain.scripthash.get_history',
      params: ['a'.repeat(64)],
    }));
    const batch = (client as any).batchRequest(requests) as Promise<unknown[]>;
    const ids = [...(client as any).pendingRequests.keys()] as number[];
    const payloadLength = Math.floor(ELECTRUM_MAX_HISTORY_BATCH_RESPONSE_BYTES / 5);

    for (const id of ids) {
      (client as any).handleData(Buffer.from(
        `${JSON.stringify({ id, result: 'x'.repeat(payloadLength) })}\n`,
      ));
    }

    await expect(batch).rejects.toThrow(
      `batch responses exceeded ${ELECTRUM_MAX_HISTORY_BATCH_RESPONSE_BYTES} bytes`,
    );
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect((client as any).pendingRequests.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes a history batch connection on caller cancellation', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const controller = new AbortController();
    const batch = (client as any).batchRequest([{
      method: 'blockchain.scripthash.get_history',
      params: ['a'.repeat(64)],
    }], { signal: controller.signal }) as Promise<unknown[]>;
    const outcome = batch.catch(error => error as Error);

    controller.abort(new Error('batch history cancelled'));

    await expect(outcome).resolves.toMatchObject({ message: 'batch history cancelled' });
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect((client as any).pendingRequests.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes a history batch connection when its response times out', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const batch = (client as any).batchRequest([{
      method: 'blockchain.scripthash.get_history',
      params: ['a'.repeat(64)],
    }]) as Promise<unknown[]>;
    const outcome = batch.catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(75);

    await expect(outcome).resolves.toMatchObject({
      message: expect.stringContaining('Batch request timeout after 50ms'),
    });
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect((client as any).pendingRequests.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('normalizes non-Error decoder failures before fail-closed teardown', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    (client as any).frameDecoder = {
      push: () => { throw 'invalid decoder failure'; },
      reset: vi.fn(),
    };
    const pending = (client as any).request('server.ping') as Promise<unknown>;

    (client as any).handleData(Buffer.from('ignored'));

    await expect(pending).rejects.toThrow('Electrum protocol framing failed');
    expect(client.isConnected()).toBe(false);
    expect(socket.destroy).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

});
