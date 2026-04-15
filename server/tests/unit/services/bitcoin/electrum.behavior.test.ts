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
    network: 'testnet',
    requestTimeoutMs: 30,
    batchRequestTimeoutMs: 50,
  });
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
    expect(client.getNetwork()).toBe('testnet');
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
    vi.spyOn(client as any, 'request')
      .mockResolvedValueOnce('status-1')
      .mockResolvedValueOnce({ height: 123, hex: 'abcd' })
      .mockResolvedValueOnce('headerhex')
      .mockResolvedValueOnce({ height: 456 });
    vi.spyOn(client as any, 'batchRequest')
      .mockResolvedValueOnce(['s1', null])
      .mockResolvedValueOnce([[{ tx_hash: 'a'.repeat(64), height: 1 }], []])
      .mockResolvedValueOnce([[{ tx_hash: 'b'.repeat(64), tx_pos: 0, height: 2, value: 500 }], []]);

    await expect(client.subscribeAddress(testAddress)).resolves.toBe('status-1');
    expect(client.getSubscribedAddresses()).toContain(testAddress);
    client.unsubscribeAddress(testAddress);
    expect(client.getSubscribedAddresses()).not.toContain(testAddress);

    const batch = await client.subscribeAddressBatch([testAddress, testAddress]);
    expect(batch.size).toBe(1);
    expect((await client.getAddressHistoryBatch([testAddress])).get(testAddress)).toBeDefined();
    expect((await client.getAddressUTXOsBatch([testAddress])).get(testAddress)).toBeDefined();

    await expect(client.subscribeHeaders()).resolves.toEqual({ height: 123, hex: 'abcd' });
    expect(client.isSubscribedToHeaders()).toBe(true);
    await expect(client.getBlockHeader(100)).resolves.toBe('headerhex');
    await expect(client.getBlockHeight()).resolves.toBe(456);

    expect((await client.subscribeAddressBatch([])).size).toBe(0);
    expect((await client.getAddressHistoryBatch([])).size).toBe(0);
    expect((await client.getAddressUTXOsBatch([])).size).toBe(0);
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

  it('throws non-timeout batch errors', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'batchRequest').mockRejectedValue(new Error('permission denied'));
    await expect(client.getTransactionsBatch(['a'.repeat(64)], true)).rejects.toThrow('permission denied');
  });

  it('returns empty array for empty low-level batch requests', async () => {
    const client = makeClient();
    await expect((client as any).batchRequest([])).resolves.toEqual([]);
  });

  it('maps missing history and UTXO batch entries to empty arrays', async () => {
    const client = makeClient();
    vi.spyOn(client as any, 'batchRequest')
      .mockResolvedValueOnce([undefined])
      .mockResolvedValueOnce([undefined]);

    const history = await client.getAddressHistoryBatch([testAddress]);
    const utxos = await client.getAddressUTXOsBatch([testAddress]);

    expect(history.get(testAddress)).toEqual([]);
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
      params: [{ height: 999, hex: 'beef' }],
    }, client, (client as any).scriptHashToAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'blockchain.scripthash.subscribe',
      params: ['hash1', 'status-1'],
    }, client, (client as any).scriptHashToAddress);
    handleNotification({
      jsonrpc: '2.0',
      id: null,
      method: 'custom.unknown',
      params: [],
    }, client, (client as any).scriptHashToAddress);

    expect(newBlock).toHaveBeenCalledWith({ height: 999, hex: 'beef' });
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

    // Invalid JSON line should be swallowed
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

    expect(addrActivity).toHaveBeenCalledWith(expect.objectContaining({
      scriptHash: 'hash-undefined',
      address: testAddress,
      status: undefined,
    }));
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
      params: ['unknown-hash', 'status-value'],
    }, client, (client as any).scriptHashToAddress);

    expect(newBlock).not.toHaveBeenCalled();
    expect(addrActivity).toHaveBeenCalledWith(expect.objectContaining({
      scriptHash: 'unknown-hash',
      address: undefined,
      status: 'status-value',
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
    const test = getElectrumClientForNetwork('testnet');

    expect(main).toBe(main2);
    expect(main).not.toBe(test);

    const disconnectSpyMain = vi.spyOn(main, 'disconnect');
    const disconnectSpyTest = vi.spyOn(test, 'disconnect');

    closeElectrumClientForNetwork('testnet');
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
