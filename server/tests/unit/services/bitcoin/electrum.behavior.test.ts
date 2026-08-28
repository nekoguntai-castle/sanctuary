import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as bitcoin from 'bitcoinjs-lib';

const createTimeoutHandle = () => ({}) as NodeJS.Timeout;

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
  ElectrumClient,
  getElectrumClient,
  getElectrumClientForNetwork,
  closeElectrumClient,
  closeElectrumClientForNetwork,
  closeAllElectrumClients,
  resetElectrumClient,
} from '../../../../src/services/bitcoin/electrum';
import { handleNotification } from '../../../../src/services/bitcoin/electrum/dataHandler';

class FakeSocket extends EventEmitter {
  write = vi.fn();
  destroy = vi.fn();
  setNoDelay = vi.fn();
  setKeepAlive = vi.fn();
}

const testAddress = 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx';
const rawTxHex =
  '01000000010000000000000000000000000000000000000000000000000000000000000000ffffffff4d04ffff001d0104455468652054696d65732030332f4a616e2f32303039204368616e63656c6c6f72206f6e206272696e6b206f66207365636f6e64206261696c6f757420666f722062616e6b73ffffffff0100f2052a01000000434104678afdb0fe5548271967f1a67130b7105cd6a828e03909a67962e0ea1f61deb649f6bc3f4cef38c4f35504e51ec112de5c384df7ba0b8d578a4c702b6bf11d5fac00000000';

function makeClient() {
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('ElectrumClient behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    closeAllElectrumClients();
  });

  afterEach(() => {
    closeAllElectrumClients();
    vi.useRealTimers();
  });

  it('supports network getter/setter', () => {
    const client = makeClient();
    expect(client.getNetwork()).toBe('testnet3');
    client.setNetwork('mainnet');
    expect(client.getNetwork()).toBe('mainnet');
  });

  it('validates and parses address-level RPC responses', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'request')
      .mockResolvedValueOnce({ confirmed: 12, unconfirmed: 1 })
      .mockResolvedValueOnce([{ tx_hash: 'a'.repeat(64), height: 100 }])
      .mockResolvedValueOnce([{ tx_hash: 'b'.repeat(64), tx_pos: 0, height: 101, value: 1000 }]);

    await expect(client.getAddressBalance(testAddress)).resolves.toEqual({ confirmed: 12, unconfirmed: 1 });
    await expect(client.getAddressHistory(testAddress)).resolves.toEqual([{ tx_hash: 'a'.repeat(64), height: 100 }]);
    await expect(client.getAddressUTXOs(testAddress)).resolves.toEqual([{ tx_hash: 'b'.repeat(64), tx_pos: 0, height: 101, value: 1000 }]);
  });

  it('throws on invalid validated responses', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'request').mockResolvedValueOnce({ bad: true });
    await expect(client.getAddressBalance(testAddress)).rejects.toThrow('Invalid Electrum response');
  });

  it('handles transaction and fee methods', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'request')
      .mockResolvedValueOnce(rawTxHex)
      .mockResolvedValueOnce('broadcast-txid')
      .mockResolvedValueOnce(0.00012)
      .mockResolvedValueOnce('pong');

    const tx = await client.getTransaction('a'.repeat(64));
    expect(tx.txid).toBeDefined();
    await expect(client.broadcastTransaction('0102')).resolves.toBe('broadcast-txid');
    await expect(client.estimateFee(6)).resolves.toBe(12);
    await expect(client.ping()).resolves.toBe('pong');
  });

  it('fails transaction decoding for invalid raw tx', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'request').mockResolvedValueOnce('invalid-raw-tx');
    await expect(client.getTransaction('a'.repeat(64))).rejects.toThrow('Failed to decode transaction');
  });

  it('tracks address subscriptions and header subscriptions', async () => {
    const client = makeClient();
    const status = 'a'.repeat(64);
    vi.spyOn(client as any, 'request')
      .mockResolvedValueOnce(status)
      .mockResolvedValueOnce({ height: 123, hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
      .mockResolvedValueOnce('headerhex')
      .mockResolvedValueOnce({ count: 2, hex: `${'00'.repeat(80)}${'ab'.repeat(80)}` })
      .mockResolvedValueOnce({ height: 456 });
    vi.spyOn(client as any, 'batchRequest')
      .mockResolvedValueOnce([status, null])
      .mockResolvedValueOnce([[{ tx_hash: 'a'.repeat(64), height: 1 }], []])
      .mockResolvedValueOnce([[{ tx_hash: 'b'.repeat(64), tx_pos: 0, height: 2, value: 500 }], []]);

    await expect(client.subscribeAddress(testAddress)).resolves.toBe(status);
    expect(client.getSubscribedAddresses()).toContain(testAddress);
    client.unsubscribeAddress(testAddress);
    expect(client.getSubscribedAddresses()).not.toContain(testAddress);

    const batch = await client.subscribeAddressBatch([testAddress, testAddress]);
    expect(batch.size).toBe(1);
    expect((await client.getAddressHistoryBatch([testAddress])).get(testAddress)).toBeDefined();
    expect((await client.getAddressUTXOsBatch([testAddress])).get(testAddress)).toBeDefined();

    await expect(client.subscribeHeaders()).resolves.toEqual({ height: 123, hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(client.isSubscribedToHeaders()).toBe(true);
    await expect(client.getBlockHeader(100)).resolves.toBe('headerhex');
    await expect(client.getBlockHeaders(100, 2)).resolves.toEqual([
      '00'.repeat(80),
      'ab'.repeat(80),
    ]);
    await expect(client.getBlockHeight()).resolves.toBe(456);

    expect((await client.subscribeAddressBatch([])).size).toBe(0);
    expect((await client.getAddressHistoryBatch([])).size).toBe(0);
    expect((await client.getAddressUTXOsBatch([])).size).toBe(0);
  });

  it('rejects malformed single subscription statuses and omits malformed batch statuses', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'request').mockResolvedValueOnce({ malformed: true });
    vi.spyOn(client as any, 'batchRequest').mockResolvedValueOnce([undefined]);

    await expect(client.subscribeAddress(testAddress)).rejects.toThrow(
      'Invalid Electrum response for subscribeAddress: malformed status',
    );
    await expect(client.subscribeAddressBatch([testAddress])).resolves.toEqual(new Map());
  });

  it('caches server version responses', async () => {
    const client = makeClient();
    const requestSpy = vi.spyOn(client as any, 'request').mockResolvedValue(['server-x', '1.4']);

    const first = await client.getServerVersion();
    const second = await client.getServerVersion();

    expect(first).toEqual({ server: 'server-x', protocol: '1.4' });
    expect(second).toEqual(first);
    expect(requestSpy).toHaveBeenCalledTimes(1);
  });

  it('requests and validates server feature advertisements', async () => {
    const client = makeClient();
    const requestSpy = vi.spyOn(client as any, 'request')
      .mockResolvedValueOnce({ server_version: 'Frigate', silent_payments: [0] });

    await expect(client.getServerFeatures()).resolves.toEqual({
      server_version: 'Frigate',
      silent_payments: [0],
    });
    expect(requestSpy).toHaveBeenCalledWith('server.features', undefined);
  });

  it('tests verbose support outcomes', async () => {
    const client = makeClient();
    const requestSpy = vi.spyOn(client as any, 'request');

    requestSpy.mockResolvedValueOnce({ vin: [], vout: [] });
    await expect(client.testVerboseSupport()).resolves.toBe(true);

    requestSpy.mockResolvedValueOnce('raw-hex');
    await expect(client.testVerboseSupport()).resolves.toBe(false);

    requestSpy.mockResolvedValueOnce({ txid: 'no-vin-vout' });
    await expect(client.testVerboseSupport()).resolves.toBe(false);

    requestSpy.mockRejectedValueOnce(new Error('unsupported'));
    await expect(client.testVerboseSupport()).resolves.toBe(false);
  });

  it('retries timed-out transaction batches and maps results', async () => {
    const client = makeClient();
    const batchSpy = vi.spyOn(client as any, 'batchRequest')
      .mockRejectedValueOnce(new Error('request timeout'))
      .mockResolvedValueOnce([rawTxHex, rawTxHex]);

    vi.useFakeTimers();
    const pending = client.getTransactionsBatch(['a'.repeat(64), 'b'.repeat(64)]);
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;

    expect(batchSpy).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(2);
    expect((await client.getTransactionsBatch([], true)).size).toBe(0);
  });

  it('aborts one pending request, clears its timer/listener, and ignores a late reply', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    attachFakeSocket(client);
    const controller = new AbortController();
    const abortReason = new Error('attempt cancelled');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');

    const request = (client as any).request(
      'server.ping',
      [],
      { signal: controller.signal },
    ) as Promise<unknown>;
    const outcome = request.then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    );
    const requestId = [...(client as any).pendingRequests.keys()][0] as number;

    controller.abort(abortReason);
    const pendingAfterAbort = (client as any).pendingRequests.size;
    const timersAfterAbort = vi.getTimerCount();
    (client as any).handleData(Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', id: requestId, result: 'late' })}\n`,
    ));
    await vi.runAllTimersAsync();

    await expect(outcome).resolves.toEqual({
      status: 'rejected',
      error: abortReason,
    });
    expect(pendingAfterAbort).toBe(0);
    expect(timersAfterAbort).toBe(0);
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('aborts all IDs from one pending batch without touching the shared socket', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const socket = attachFakeSocket(client);
    const controller = new AbortController();
    const abortReason = new Error('batch cancelled');
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const requests = Array.from({ length: 100 }, (_, index) => ({
      method: 'blockchain.transaction.get',
      params: [index.toString(16).padStart(64, '0'), false],
    }));

    const batch = (client as any).batchRequest(requests, {
      signal: controller.signal,
    }) as Promise<unknown[]>;
    const outcome = batch.then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    );
    const requestIds = [...(client as any).pendingRequests.keys()] as number[];

    controller.abort(abortReason);
    const pendingAfterAbort = (client as any).pendingRequests.size;
    const timersAfterAbort = vi.getTimerCount();
    for (const id of requestIds) {
      (client as any).handleData(Buffer.from(
        `${JSON.stringify({ jsonrpc: '2.0', id, result: rawTxHex })}\n`,
      ));
    }
    await vi.runAllTimersAsync();

    await expect(outcome).resolves.toEqual({
      status: 'rejected',
      error: abortReason,
    });
    expect(requestIds).toHaveLength(100);
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(pendingAfterAbort).toBe(0);
    expect(timersAfterAbort).toBe(0);
    expect(socket.destroy).not.toHaveBeenCalled();
  });

  it('normalizes a non-Error cancellation reason', async () => {
    const client = makeClient();
    attachFakeSocket(client);
    const controller = new AbortController();
    const request = (client as any).request(
      'server.ping',
      [],
      { signal: controller.signal },
    ) as Promise<unknown>;

    controller.abort('cancelled by caller');

    await expect(request).rejects.toMatchObject({ message: 'cancelled by caller' });
  });

  it('provides a stable cancellation error for a legacy signal without a reason', async () => {
    const client = makeClient();
    attachFakeSocket(client);
    let abortListener!: () => void;
    const signal = {
      aborted: false,
      reason: undefined,
      throwIfAborted: () => undefined,
      addEventListener: (_event: string, listener: () => void) => { abortListener = listener; },
      removeEventListener: vi.fn(),
    } as unknown as AbortSignal;
    const request = (client as any).request('server.ping', [], { signal }) as Promise<unknown>;

    abortListener();

    await expect(request).rejects.toThrow('Electrum request cancelled');
  });

  it('cleans a single request after its low-level timeout', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    attachFakeSocket(client);
    const request = (client as any).request('server.ping') as Promise<unknown>;
    const outcome = request.catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(30);

    await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('timeout') });
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('cleans every batch entry after low-level timeouts', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    attachFakeSocket(client);
    const request = (client as any).batchRequest([
      { method: 'server.ping', params: [] },
      { method: 'server.ping', params: [] },
    ]) as Promise<unknown>;
    const outcome = request.catch(error => error as Error);

    await vi.advanceTimersByTimeAsync(50);

    await expect(outcome).resolves.toMatchObject({ message: expect.stringContaining('timeout') });
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it.each([new Error('socket closed'), 'socket closed'])(
    'cleans a single request when socket write throws %p',
    async (failure) => {
      vi.useFakeTimers();
      const client = makeClient();
      const socket = attachFakeSocket(client);
      socket.write.mockImplementationOnce(() => { throw failure; });

      await expect((client as any).request('server.ping')).rejects.toThrow('socket closed');

      expect((client as any).pendingRequests.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([new Error('batch socket closed'), 'batch socket closed'])(
    'cleans a batch when socket write throws %p',
    async (failure) => {
      vi.useFakeTimers();
      const client = makeClient();
      const socket = attachFakeSocket(client);
      socket.write.mockImplementationOnce(() => { throw failure; });

      await expect((client as any).batchRequest([
        { method: 'server.ping', params: [] },
        { method: 'server.ping', params: [] },
      ])).rejects.toThrow('batch socket closed');

      expect((client as any).pendingRequests.size).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('detaches one aborted caller from a shared deferred connection attempt', async () => {
    const client = makeClient();
    const connection = deferred<void>();
    vi.spyOn(client as any, 'establishConnection').mockReturnValue(connection.promise);
    const disconnect = vi.spyOn(client, 'disconnect');
    const controller = new AbortController();
    const abortReason = new Error('caller cancelled');
    let callerAState: unknown = 'pending';

    const callerA = (client as any).request(
      'server.ping',
      [],
      { signal: controller.signal },
    ) as Promise<unknown>;
    void callerA.then(
      () => { callerAState = 'resolved'; },
      error => { callerAState = error; },
    );
    const callerB = (client as any).request('server.version', []) as Promise<unknown>;

    controller.abort(abortReason);
    await new Promise<void>(resolve => setImmediate(resolve));
    const stateAfterAbort = callerAState;
    attachFakeSocket(client);
    connection.resolve();
    await new Promise<void>(resolve => setImmediate(resolve));
    const callerBRequestId = [...(client as any).pendingRequests.keys()][0] as number;
    (client as any).handleData(Buffer.from(
      `${JSON.stringify({ jsonrpc: '2.0', id: callerBRequestId, result: 'connected' })}\n`,
    ));
    await expect(callerB).resolves.toBe('connected');
    await callerA.catch(() => undefined);

    expect(stateAfterAbort).toBe(abortReason);
    expect(disconnect).not.toHaveBeenCalled();
    expect((client as any).establishConnection).toHaveBeenCalledTimes(1);
  });

  it('stops a transaction batch retry delay when its caller aborts', async () => {
    vi.useFakeTimers();
    const client = makeClient();
    const batchRequest = vi.spyOn(client as any, 'batchRequest')
      .mockRejectedValue(new Error('request timeout'));
    const controller = new AbortController();
    const abortReason = new Error('attempt timed out');

    const pending = (client as any).getTransactionsBatch(
      ['a'.repeat(64)],
      false,
      { signal: controller.signal },
    ) as Promise<Map<string, unknown>>;
    await vi.advanceTimersByTimeAsync(0);
    controller.abort(abortReason);
    const outcome = pending.then(
      value => ({ status: 'resolved' as const, value }),
      error => ({ status: 'rejected' as const, error }),
    );
    await vi.runAllTimersAsync();

    await expect(outcome).resolves.toEqual({
      status: 'rejected',
      error: abortReason,
    });
    expect(batchRequest).toHaveBeenCalledTimes(1);
  });

  it('throws non-timeout batch errors', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'batchRequest').mockRejectedValue(new Error('permission denied'));
    await expect(client.getTransactionsBatch(['a'.repeat(64)], true)).rejects.toThrow('permission denied');
  });

  it('returns empty array for empty low-level batch requests', async () => {
    const client = makeClient();
    await expect((client as any).batchRequest([])).resolves.toEqual([]);
  });

  it('rejects missing history evidence while retaining the legacy empty UTXO mapping', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'batchRequest')
      .mockResolvedValueOnce([undefined])
      .mockResolvedValueOnce([undefined]);

    await expect(client.getAddressHistoryBatch([testAddress])).rejects.toThrow(
      'Invalid Electrum response',
    );
    const utxos = await client.getAddressUTXOsBatch([testAddress]);

    expect(utxos.get(testAddress)).toEqual([]);
  });

  it('handles notifications and raw response parsing', async () => {
    const client = makeClient();
    const newBlock = vi.fn();
    const addrActivity = vi.fn();
    client.on('newBlock', newBlock);
    client.on('addressActivity', addrActivity);

    (client as any).scriptHashToAddress.set('hash1', testAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'blockchain.headers.subscribe',
      params: [{ height: 999, hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }],
    }, client, (client as any).scriptHashToAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'blockchain.scripthash.subscribe',
      params: ['hash1', '1'.repeat(64)],
    }, client, (client as any).scriptHashToAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'custom.unknown',
      params: [],
    }, client, (client as any).scriptHashToAddress);

    expect(newBlock).toHaveBeenCalledWith({ height: 999, hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(addrActivity).toHaveBeenCalledWith(expect.objectContaining({
      scriptHash: 'hash1',
      address: testAddress,
    }));

    const timeout = createTimeoutHandle();
    const resolve = vi.fn();
    const reject = vi.fn();
    (client as any).pendingRequests.set(10, { resolve, reject, timeoutId: timeout });

    (client as any).handleData(Buffer.from('{"jsonrpc":"2.0","id":10,"result":{"ok":true}}\n'));
    expect(resolve).toHaveBeenCalledWith({ ok: true });

    (client as any).pendingRequests.set(11, { resolve, reject, timeoutId: createTimeoutHandle() });
    (client as any).handleData(Buffer.from('{"jsonrpc":"2.0","id":11,"error":{"message":"bad"}}\n'));
    expect(reject).toHaveBeenCalledWith(expect.any(Error));

    // Invalid JSON is fail-closed at the connection boundary.
    (client as any).handleData(Buffer.from('not-json\n'));
  });

  it('treats undefined-id payloads as notifications and skips blank lines', () => {
    const client = makeClient();
    const addrActivity = vi.fn();
    client.on('addressActivity', addrActivity);

    (client as any).scriptHashToAddress.set('hash-undefined', testAddress);
    (client as any).handleData(
      Buffer.from('\n{"jsonrpc":"2.0","method":"blockchain.scripthash.subscribe","params":["hash-undefined"]}\n')
    );

    expect(addrActivity).not.toHaveBeenCalled();
  });

  it('ignores orphan responses that have neither id nor method', () => {
    const client = makeClient();
    const reject = vi.fn();
    (client as any).pendingRequests.set(9, {
      resolve: vi.fn(),
      reject,
      timeoutId: createTimeoutHandle(),
    });

    (client as any).handleData(Buffer.from('{"jsonrpc":"2.0","result":"orphan"}\n'));
    expect(reject).not.toHaveBeenCalled();
    expect((client as any).pendingRequests.has(9)).toBe(true);
  });

  it('handles notifications with missing params gracefully', () => {
    const client = makeClient();
    const newBlock = vi.fn();
    const addrActivity = vi.fn();
    client.on('newBlock', newBlock);
    client.on('addressActivity', addrActivity);

    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'blockchain.headers.subscribe',
      params: [],
    }, client, (client as any).scriptHashToAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'blockchain.scripthash.subscribe',
      params: [],
    }, client, (client as any).scriptHashToAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'blockchain.scripthash.subscribe',
      params: ['unknown-hash', '2'.repeat(64)],
    }, client, (client as any).scriptHashToAddress);

    expect(newBlock).not.toHaveBeenCalled();
    expect(addrActivity).toHaveBeenCalledWith(expect.objectContaining({
      scriptHash: 'unknown-hash',
      address: undefined,
      status: '2'.repeat(64),
    }));
  });

  it('falls back to serialized error payload when error.message is missing', () => {
    const client = makeClient();
    const reject = vi.fn();

    (client as any).pendingRequests.set(22, {
      resolve: vi.fn(),
      reject,
      timeoutId: createTimeoutHandle(),
    });
    (client as any).handleData(
      Buffer.from('{"jsonrpc":"2.0","id":22,"error":{"code":-32000}}\n')
    );

    expect(reject).toHaveBeenCalledWith(expect.objectContaining({
      message: '{"code":-32000}',
    }));
  });

  it('decodes outputs without addresses as empty address arrays', () => {
    const client = makeClient();
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 0x01), 0xffffffff, 0xffffffff, Buffer.alloc(0));
    tx.addOutput(Buffer.from([0x6a, 0x01, 0x01]), BigInt(0));

    const decoded = (client as any).decodeRawTransaction(tx.toHex());
    expect(decoded.vout[0].scriptPubKey.address).toBeUndefined();
    expect(decoded.vout[0].scriptPubKey.addresses).toEqual([]);
  });

  it('decodes outputs with recognized addresses', () => {
    const client = makeClient();
    const tx = new bitcoin.Transaction();
    tx.addInput(Buffer.alloc(32, 0x02), 0xffffffff, 0xffffffff, Buffer.alloc(0));
    tx.addOutput(
      bitcoin.payments.p2wpkh({
        hash: Buffer.alloc(20, 0x55),
        network: bitcoin.networks.testnet,
      }).output!,
      BigInt(1000)
    );

    const decoded = (client as any).decodeRawTransaction(tx.toHex());
    expect(decoded.vout[0].scriptPubKey.address).toBeDefined();
    expect(decoded.vout[0].scriptPubKey.addresses).toHaveLength(1);
  });

  it('retries timed-out transaction batches up to the final attempt then throws', async () => {
    const client = makeClient();
    const batchSpy = vi.spyOn(client as any, 'batchRequest').mockRejectedValue(new Error('request timeout'));

    vi.useFakeTimers();
    const expectation = expect(client.getTransactionsBatch(['a'.repeat(64)])).rejects.toThrow('request timeout');
    await vi.advanceTimersByTimeAsync(2000);

    await expectation;
    expect(batchSpy).toHaveBeenCalledTimes(3);
  });

  it('omits txids whose decoded batch transaction is falsy', async () => {
    const client = makeClient();
    const txids = ['a'.repeat(64), 'b'.repeat(64)];
    vi.spyOn(client as any, 'batchRequest').mockResolvedValueOnce(['raw1', 'raw2']);
    vi.spyOn(client as any, 'decodeRawTransaction')
      .mockReturnValueOnce({ txid: 'decoded1' })
      .mockReturnValueOnce(undefined as any);

    const result = await client.getTransactionsBatch(txids);

    expect(result.size).toBe(1);
    expect(result.get(txids[0])).toEqual({ txid: 'decoded1' });
    expect(result.has(txids[1])).toBe(false);
  });

  it('fetches raw transaction evidence without calling the synchronous decoder', async () => {
    const client = makeClient();
    const txid = 'a'.repeat(64);
    const request = vi.spyOn(client as any, 'request').mockResolvedValue('0102');
    const batchRequest = vi.spyOn(client as any, 'batchRequest').mockResolvedValue(['0304']);
    const decode = vi.spyOn(client as any, 'decodeRawTransaction');

    await expect(client.getRawTransactionEvidence(txid)).resolves.toMatchObject({
      txid,
      hex: '0102',
    });
    await expect(client.getRawTransactionEvidenceBatch([txid])).resolves.toEqual(new Map([[
      txid,
      { txid, hex: '0304', vin: [], vout: [] },
    ]]));

    expect(request).toHaveBeenCalledWith(
      'blockchain.transaction.get',
      [txid, false],
      undefined,
    );
    expect(batchRequest).toHaveBeenCalledWith([{
      method: 'blockchain.transaction.get',
      params: [txid, false],
    }], undefined);
    expect(decode).not.toHaveBeenCalled();
  });

  it('disconnects and rejects pending requests', () => {
    const client = makeClient();
    const socket = new FakeSocket();
    (client as any).socket = socket as any;
    (client as any).connected = true;
    (client as any).serverVersion = { server: 'x', protocol: '1.4' };
    (client as any).scriptHashToAddress.set('h', 'a');

    const reject = vi.fn();
    const timeout = createTimeoutHandle();
    (client as any).pendingRequests.set(1, { resolve: vi.fn(), reject, timeoutId: timeout });

    expect(client.isConnected()).toBe(true);
    client.disconnect();

    expect(reject).toHaveBeenCalledWith(expect.any(Error));
    expect(socket.destroy).toHaveBeenCalled();
    expect(client.isConnected()).toBe(false);
    expect(client.getSubscribedAddresses()).toEqual([]);
  });
});

describe('Electrum client registry helpers', () => {
  beforeEach(() => {
    closeAllElectrumClients();
  });

  afterEach(() => {
    closeAllElectrumClients();
  });

  it('returns network-keyed singleton instances and closes them', () => {
    const main = getElectrumClient();
    const main2 = getElectrumClientForNetwork('mainnet');
    const test = getElectrumClientForNetwork('testnet3');

    expect(main).toBe(main2);
    expect(main).not.toBe(test);

    const disconnectSpyMain = vi.spyOn(main, 'disconnect');
    const disconnectSpyTest = vi.spyOn(test, 'disconnect');

    closeElectrumClientForNetwork('testnet3');
    expect(disconnectSpyTest).toHaveBeenCalledTimes(1);

    closeElectrumClient();
    expect(disconnectSpyMain).toHaveBeenCalledTimes(1);
  });

  it('does nothing when closing a network client that does not exist', () => {
    const main = getElectrumClientForNetwork('mainnet');
    const disconnectSpyMain = vi.spyOn(main, 'disconnect');

    closeElectrumClientForNetwork('regtest');

    expect(disconnectSpyMain).not.toHaveBeenCalled();
  });

  it('closes all clients and supports reset alias', () => {
    const main = getElectrumClientForNetwork('mainnet');
    const signet = getElectrumClientForNetwork('signet');
    const spyMain = vi.spyOn(main, 'disconnect');
    const spySignet = vi.spyOn(signet, 'disconnect');

    closeAllElectrumClients();
    expect(spyMain).toHaveBeenCalledTimes(1);
    expect(spySignet).toHaveBeenCalledTimes(1);

    const newMain = getElectrumClientForNetwork('mainnet');
    const spyNewMain = vi.spyOn(newMain, 'disconnect');
    resetElectrumClient();
    expect(spyNewMain).toHaveBeenCalledTimes(1);
  });
});
