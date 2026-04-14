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

    (client as any).handleData(Buffer.from('{"jsonrpc":"2.0","id":null,"method":"blockchain.headers.subscribe","params":[{"height":101,"hex":"abcd"}]}\n'));

    expect(newBlock).toHaveBeenCalledWith({ height: 101, hex: 'abcd' });
  });
}
