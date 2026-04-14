import { it, expect, vi } from 'vitest';
import { ElectrumClient, FakeSocket, netConnectMock } from './electrumConnectionTestHarness';

export function registerElectrumConnectionRequestContracts(): void {
  it('propagates request timeouts and removes pending request entries', async () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 25,
      batchRequestTimeoutMs: 60,
    });

    const socket = new FakeSocket();
    (client as any).socket = socket;
    (client as any).connected = true;

    const promise = (client as any).request('server.ping');
    const rejected = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(30);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Request timeout after 25ms');
    expect((client as any).pendingRequests.size).toBe(0);
  });

  it('no-ops request timeout callback when request was already removed', async () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 15,
      batchRequestTimeoutMs: 60,
    });

    const socket = new FakeSocket();
    (client as any).socket = socket;
    (client as any).connected = true;

    const promise = (client as any).request('server.ping');
    const id = (client as any).requestId;
    const pending = (client as any).pendingRequests.get(id);

    expect(pending).toBeDefined();
    (client as any).pendingRequests.delete(id);
    (pending as any).resolve('ok');

    await expect(promise).resolves.toBe('ok');
    await vi.advanceTimersByTimeAsync(20);
    expect((client as any).pendingRequests.has(id)).toBe(false);
  });

  it('propagates batch request timeouts', async () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 15,
    });

    const socket = new FakeSocket();
    (client as any).socket = socket;
    (client as any).connected = true;

    const promise = (client as any).batchRequest([
      { method: 'm1', params: [] },
      { method: 'm2', params: [] },
    ]);
    const rejected = promise.catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(20);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Batch request timeout after 15ms');
    expect((client as any).pendingRequests.size).toBeLessThanOrEqual(1);
  });

  it('no-ops batch timeout callback when request was already removed', async () => {
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 15,
    });

    const socket = new FakeSocket();
    (client as any).socket = socket;
    (client as any).connected = true;

    const promise = (client as any).batchRequest([{ method: 'm1', params: [] }]);
    const [entry] = Array.from((client as any).pendingRequests.entries()) as Array<[number, any]>;

    expect(entry).toBeDefined();
    const [id, pending] = entry;
    (client as any).pendingRequests.delete(id);
    pending.resolve('manual-result');

    await expect(promise).resolves.toEqual(['manual-result']);
    await vi.advanceTimersByTimeAsync(20);
    expect((client as any).pendingRequests.has(id)).toBe(false);
  });

  it('auto-connects when issuing requests while disconnected', async () => {
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
      const parsed = JSON.parse(message.trim());
      (client as any).handleData(
        Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null }) + '\n'),
      );
    });

    await expect((client as any).request('server.ping')).resolves.toBeNull();
    expect(connectSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects pending requests when socket closes', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('close');

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection closed unexpectedly');
    expect(client.isConnected()).toBe(false);
  });

  it('rejects pending requests when socket ends', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('end');

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection ended');
    expect(client.isConnected()).toBe(false);
  });

  it('rejects pending requests when socket emits error', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit('connect'));
      return socket;
    });

    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('error', new Error('socket exploded'));

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Socket error: socket exploded');
  });
}
