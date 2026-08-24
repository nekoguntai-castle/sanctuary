import { it, expect, vi } from 'vitest';
import { ElectrumClient, FakeSocket, netConnectMock } from './electrumConnectionTestHarness';

export function registerElectrumConnectionEdgeDataContracts(): void {
  it('surfaces synchronous connection setup failures', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => {
      throw new Error('timer creation failed');
    });

    try {
      const client = new ElectrumClient({
        host: 'localhost',
        port: 50001,
        protocol: 'tcp',
      });

      await expect(client.connect()).rejects.toThrow('timer creation failed');
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('auto-connects before sending batch requests when disconnected', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    const connectSpy = vi.spyOn(client as any, 'connect').mockImplementation(async () => {
      (client as any).socket = socket;
      (client as any).connected = true;
    });

    socket.write.mockImplementation((message: string) => {
      const lines = message.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        const parsed = JSON.parse(line);
        (client as any).handleData(
          Buffer.from(
            JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: `${parsed.method}-ok` }) + '\n'
          )
        );
      }
    });

    const result = await (client as any).batchRequest([
      { method: 'm1', params: [] },
      { method: 'm2', params: [] },
    ]);

    expect(connectSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(['m1-ok', 'm2-ok']);
  });

  it('routes socket data events through handleData', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      connectionTimeoutMs: 25,
    });

    await client.connect();
    const handleDataSpy = vi.spyOn(client as any, 'handleData');
    const payload = Buffer.from('{"jsonrpc":"2.0","id":1,"result":null}\n');

    socket.emit('data', payload);
    expect(handleDataSpy).toHaveBeenCalledWith(payload);
  });

  it('ignores late socket errors after connection already timed out', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => socket);

    const client = new ElectrumClient({
      host: 'tcp-double-error-host',
      port: 50001,
      protocol: 'tcp',
      connectionTimeoutMs: 10,
    });

    const rejected = client.connect().catch((err: Error) => err);

    // Let the connection timeout fire first (handleError #1)
    await vi.advanceTimersByTimeAsync(15);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error('Expected the connection timeout to reject with an Error');
    }
    expect(error.message).toContain('Connection timeout after 10ms');

    // Now emit a socket error after the connection is already settled (handleError #2 → early return)
    expect(() => socket.emit('error', new Error('late socket error'))).not.toThrow();
  });

  it('routes JSON-RPC notifications from handleData', () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
    });

    const newBlock = vi.fn();
    client.on('newBlock', newBlock);

    (client as any).handleData(Buffer.from('{"jsonrpc":"2.0","id":null,"method":"blockchain.headers.subscribe","params":[{"height":101,"hex":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}\n'));

    expect(newBlock).toHaveBeenCalledWith({ height: 101, hex: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  });

  it('emits subscription responses before later notifications from the same wire buffer', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
    });
    const scriptHash = 'a'.repeat(64);
    const olderStatus = 'b'.repeat(64);
    const newerStatus = 'c'.repeat(64);
    (client as any).socket = socket;
    (client as any).connected = true;
    (client as any).scriptHashToAddress.set(scriptHash, 'bc1qordered');
    const observations: string[] = [];
    client.on('addressActivity', ({ status }: { status: string }) => {
      observations.push(status);
    });
    socket.write.mockImplementationOnce((message: string) => {
      const { id } = JSON.parse(message.trim());
      (client as any).handleData(Buffer.from([
        JSON.stringify({ jsonrpc: '2.0', id, result: olderStatus }),
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          method: 'blockchain.scripthash.subscribe',
          params: [scriptHash, newerStatus],
        }),
        '',
      ].join('\n')));
    });

    await expect((client as any).batchRequest([{
      method: 'blockchain.scripthash.subscribe',
      params: [scriptHash],
    }])).resolves.toEqual([olderStatus]);
    expect(observations).toEqual([olderStatus, newerStatus]);
  });

  it('normalizes null subscription responses and ignores missing script-hash metadata', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' });
    (client as any).socket = socket;
    (client as any).connected = true;
    const activity = vi.fn();
    client.on('addressActivity', activity);
    socket.write.mockImplementation((message: string) => {
      const requests = message.trim().split('\n').map((line) => JSON.parse(line));
      (client as any).handleData(Buffer.from(requests.map(({ id }: { id: number }) => (
        JSON.stringify({ jsonrpc: '2.0', id, result: null })
      )).join('\n') + '\n'));
    });

    await (client as any).batchRequest([
      { method: 'blockchain.scripthash.subscribe', params: ['b'.repeat(64)] },
      { method: 'blockchain.scripthash.subscribe', params: [] },
    ]);

    expect(activity).toHaveBeenCalledOnce();
    expect(activity).toHaveBeenCalledWith(expect.objectContaining({
      scriptHash: 'b'.repeat(64), status: null,
    }));
  });

  it('ignores malformed subscription response and notification statuses', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' });
    const scriptHash = 'd'.repeat(64);
    (client as any).socket = socket;
    (client as any).connected = true;
    const activity = vi.fn();
    client.on('addressActivity', activity);
    socket.write.mockImplementation((message: string) => {
      const { id } = JSON.parse(message.trim());
      (client as any).handleData(Buffer.from([
        JSON.stringify({ jsonrpc: '2.0', id, result: { malformed: true } }),
        JSON.stringify({
          jsonrpc: '2.0', id: null, method: 'blockchain.scripthash.subscribe',
          params: [scriptHash, 'too-short'],
        }),
        '',
      ].join('\n')));
    });

    await (client as any).batchRequest([{
      method: 'blockchain.scripthash.subscribe', params: [scriptHash],
    }]);

    expect(activity).not.toHaveBeenCalled();
  });
}
