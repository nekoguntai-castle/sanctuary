import { it, expect, vi } from 'vitest';
import { ElectrumClient, FakeSocket, netConnectMock, tlsConnectMock, loggerDebugMock } from './electrumConnectionTestHarness';

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

  it('destroys and discards a TCP socket that connects after the attempt already timed out', async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => socket);

    const client = new ElectrumClient({
      host: 'tcp-late-connect-host',
      port: 50001,
      protocol: 'tcp',
      connectionTimeoutMs: 10,
    });

    const rejected = client.connect().catch((err: Error) => err);

    // Let the connection timeout fire before the socket ever connects.
    await vi.advanceTimersByTimeAsync(15);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error('Expected the connection timeout to reject with an Error');
    }
    expect(error.message).toContain('Connection timeout after 10ms');

    // The socket finally connects late, after the attempt already settled.
    socket.emit('connect');
    await vi.advanceTimersByTimeAsync(0);

    expect(socket.destroy).toHaveBeenCalled();
    expect((client as any).socket).not.toBe(socket);
    expect(client.isConnected()).toBe(false);
  });

  it('destroys and discards a TLS socket that completes its handshake after the attempt already timed out', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    let onSecureConnect: (() => void) | undefined;

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, callback: () => void) => {
      onSecureConnect = callback;
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-late-secureconnect-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 10,
    });

    const rejected = client.connect().catch((err: Error) => err);

    // Let the connection timeout fire before the TLS handshake ever completes.
    await vi.advanceTimersByTimeAsync(15);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    if (!(error instanceof Error)) {
      throw new Error('Expected the connection timeout to reject with an Error');
    }
    expect(error.message).toContain('Connection timeout after 10ms');

    // handleError already destroyed this.socket when the timeout fired; reset
    // the spy so the assertion below proves the late-success branch's own
    // destroy call, not that earlier one.
    tlsSocket.destroy.mockClear();

    // The TLS handshake finally completes late, after the attempt already settled.
    expect(onSecureConnect).toBeDefined();
    onSecureConnect?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(tlsSocket.destroy).toHaveBeenCalledTimes(1);
    expect((client as any).socket).not.toBe(tlsSocket);
    expect(client.isConnected()).toBe(false);
  });

  it('does not clobber a newer live connection when an older timed-out attempt finally connects late', async () => {
    const staleSocket = new FakeSocket();
    const liveSocket = new FakeSocket();

    // First connect() attempt: its base socket never connects until we say so.
    netConnectMock.mockImplementationOnce(() => {
      // Deliberately never emits 'connect' until triggered below.
      return staleSocket;
    });

    const client = new ElectrumClient({
      host: 'tcp-interleaved-attempts-host',
      port: 50001,
      protocol: 'tcp',
      connectionTimeoutMs: 10,
    });

    const firstRejected = client.connect().catch((err: Error) => err);

    // Let the first attempt's connection timeout fire while its socket is
    // still pending (never connected).
    await vi.advanceTimersByTimeAsync(15);
    const firstError = await firstRejected;
    expect(firstError).toBeInstanceOf(Error);

    // A second, independent connect() attempt starts now that the first has
    // settled and connectionPromise was cleared. It succeeds normally.
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => liveSocket.emit('connect'));
      return liveSocket;
    });
    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect((client as any).socket).toBe(liveSocket);

    // The first (stale, already-timed-out) attempt's socket finally connects
    // late. It must be discarded without disturbing the second attempt's now
    // -live connection.
    staleSocket.emit('connect');
    await vi.advanceTimersByTimeAsync(0);

    expect(staleSocket.destroy).toHaveBeenCalled();
    expect((client as any).socket).toBe(liveSocket);
    expect(client.isConnected()).toBe(true);
  });

  it('discards a stale TLS handshake that resolves after a second connect already replaced this.socket', async () => {
    const staleBaseSocket = new FakeSocket();
    const staleTlsSocket = new FakeSocket();
    const liveBaseSocket = new FakeSocket();
    const liveTlsSocket = new FakeSocket();
    let staleSecureConnect: (() => void) | undefined;

    // First connect() attempt: its base socket connects promptly (before the
    // timeout), so finishTlsConnection assigns this.socket = staleTlsSocket,
    // but its TLS handshake never completes until triggered below.
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => staleBaseSocket.emit('connect'));
      return staleBaseSocket;
    });
    tlsConnectMock.mockImplementationOnce((_options: any, callback: () => void) => {
      staleSecureConnect = callback;
      return staleTlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-stale-handshake-after-replacement-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 10,
    });

    const firstRejected = client.connect().catch((err: Error) => err);

    // Let the base socket connect (installing this.socket = staleTlsSocket),
    // then let the connection timeout fire while the handshake is still
    // pending. handleError destroys staleTlsSocket but does not null
    // this.socket, so it still points at the (now-destroyed) stale socket.
    await vi.advanceTimersByTimeAsync(15);
    const firstError = await firstRejected;
    expect(firstError).toBeInstanceOf(Error);
    expect((client as any).socket).toBe(staleTlsSocket);
    expect(staleSecureConnect).toBeDefined();

    // A second, independent connect() attempt starts now that the first has
    // settled and connectionPromise was cleared. It succeeds normally,
    // replacing this.socket with the new, live TLS socket.
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => liveBaseSocket.emit('connect'));
      return liveBaseSocket;
    });
    tlsConnectMock.mockImplementationOnce((_options: any, callback: () => void) => {
      queueMicrotask(() => callback());
      return liveTlsSocket;
    });

    await client.connect();
    expect(client.isConnected()).toBe(true);
    expect((client as any).socket).toBe(liveTlsSocket);

    loggerDebugMock.mockClear();
    staleTlsSocket.destroy.mockClear();

    // The first (stale) attempt's TLS handshake finally resolves late. Since
    // this.socket no longer equals the stale socket (`this.socket === socket`
    // is false), handleSuccess's late-arrival branch must destroy the stale
    // socket and log it, without touching the now-live connection.
    staleSecureConnect?.();
    await vi.advanceTimersByTimeAsync(0);

    expect(staleTlsSocket.destroy).toHaveBeenCalledTimes(1);
    expect((client as any).socket).toBe(liveTlsSocket);
    expect(client.isConnected()).toBe(true);
    expect(loggerDebugMock).toHaveBeenCalledWith(
      'Discarding late-arriving Electrum socket after connect attempt already settled',
      expect.objectContaining({ host: 'tls-stale-handshake-after-replacement-host', port: 50002, protocol: 'ssl' }),
    );
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

  it('resolves subscription responses without misclassifying them as live activity', async () => {
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
    const responseMarker = vi.fn();
    client.on('addressActivity', ({ status }: { status: string }) => {
      observations.push(status);
    });
    client.on('subscriptionResponse', responseMarker);
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
    expect(observations).toEqual([newerStatus]);
    expect(responseMarker).toHaveBeenCalledWith({
      address: 'bc1qordered',
      sequence: 1,
    });
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

    expect(activity).not.toHaveBeenCalled();
  });

  it('ignores malformed subscription response and notification statuses', async () => {
    const socket = new FakeSocket();
    const client = new ElectrumClient({ host: 'localhost', port: 50001, protocol: 'tcp' });
    const scriptHash = 'd'.repeat(64);
    (client as any).socket = socket;
    (client as any).connected = true;
    (client as any).scriptHashToAddress.set(scriptHash, 'address-malformed');
    const activity = vi.fn();
    const subscriptionResponse = vi.fn();
    client.on('addressActivity', activity);
    client.on('subscriptionResponse', subscriptionResponse);
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
    expect(subscriptionResponse).not.toHaveBeenCalled();
  });
}
