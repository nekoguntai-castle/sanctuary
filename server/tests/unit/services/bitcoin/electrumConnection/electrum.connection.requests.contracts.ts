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
    const closeListener = vi.fn();
    client.on('close', closeListener);
    (client as any).serverVersion = { server: 'cached', protocol: '1.4' };
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('close');

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection closed unexpectedly');
    expect(client.isConnected()).toBe(false);
    expect((client as any).serverVersion).toBeNull();
    expect(closeListener).toHaveBeenCalledOnce();
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
    const closeListener = vi.fn();
    client.on('close', closeListener);
    socket.write.mockImplementation(() => undefined);

    const pending = (client as any).request('server.ping').catch((err: Error) => err);
    socket.emit('end');

    const error = await pending;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('Connection ended');
    expect(client.isConnected()).toBe(false);
    socket.emit('close');
    expect(closeListener).toHaveBeenCalledOnce();
  });

  it('coalesces overlapping connects and ignores a replaced socket closing late', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    netConnectMock
      .mockImplementationOnce(() => {
        queueMicrotask(() => firstSocket.emit('connect'));
        return firstSocket;
      })
      .mockImplementationOnce(() => {
        queueMicrotask(() => secondSocket.emit('connect'));
        return secondSocket;
      });
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await Promise.all([client.connect(), client.connect()]);
    expect(netConnectMock).toHaveBeenCalledTimes(1);
    await client.connect();
    expect(netConnectMock).toHaveBeenCalledTimes(1);

    firstSocket.emit('end');
    expect(client.isConnected()).toBe(false);
    await client.connect();
    expect(netConnectMock).toHaveBeenCalledTimes(2);
    expect(client.isConnected()).toBe(true);

    firstSocket.emit('data', Buffer.from('stale socket data\n'));
    firstSocket.emit('error', new Error('stale socket error'));
    firstSocket.emit('end');
    firstSocket.emit('close');
    expect(client.isConnected()).toBe(true);
    expect((client as any).socket).toBe(secondSocket);
    expect((client as any).frameDecoder.bufferedBytes).toBe(0);
  });

  it.each(['close', 'end'] as const)(
    'does not announce a %s from a socket that never finished connecting',
    (event) => {
      const socket = new FakeSocket();
      const client = new ElectrumClient({
        host: 'localhost',
        port: 50001,
        protocol: 'tcp',
      });
      const closeListener = vi.fn();
      client.on('close', closeListener);
      (client as any).socket = socket;
      (client as any).connected = false;
      (client as any).attachSocketHandlers(socket);

      socket.emit(event);

      expect(closeListener).not.toHaveBeenCalled();
      expect((client as any).socket).toBeNull();
    },
  );

  it('does not carry an incomplete response frame into a replacement socket', async () => {
    const firstSocket = new FakeSocket();
    const secondSocket = new FakeSocket();
    netConnectMock
      .mockImplementationOnce(() => {
        queueMicrotask(() => firstSocket.emit('connect'));
        return firstSocket;
      })
      .mockImplementationOnce(() => {
        queueMicrotask(() => secondSocket.emit('connect'));
        return secondSocket;
      });
    const client = new ElectrumClient({
      host: 'localhost',
      port: 50001,
      protocol: 'tcp',
      requestTimeoutMs: 40,
      batchRequestTimeoutMs: 40,
    });

    await client.connect();
    firstSocket.emit('data', Buffer.from('{"jsonrpc":"2.0"'));
    firstSocket.emit('end');
    await client.connect();
    secondSocket.write.mockImplementation((message: string) => {
      const parsed = JSON.parse(message.trim());
      secondSocket.emit('data', Buffer.from(
        `${JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: null })}\n`,
      ));
    });

    await expect((client as any).request('server.ping')).resolves.toBeNull();
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
