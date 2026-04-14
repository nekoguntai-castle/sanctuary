import { it, expect } from 'vitest';
import { ElectrumClient, FakeSocket, netConnectMock, tlsConnectMock } from './electrumConnectionTestHarness';

export function registerElectrumConnectionTlsContracts(): void {
  it('connects via TLS and honors allowSelfSignedCert flag', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });

    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-host',
      port: 50002,
      protocol: 'ssl',
      allowSelfSignedCert: true,
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socket: baseSocket,
        rejectUnauthorized: false,
        servername: 'tls-host',
      }),
      expect.any(Function),
    );
    expect(tlsSocket.setNoDelay).toHaveBeenCalledWith(true);
    expect(tlsSocket.setKeepAlive).toHaveBeenCalledWith(true, 30000);
  });

  it('ignores duplicate TLS secureConnect callbacks after connection settles', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => {
        onSecureConnect();
        onSecureConnect();
      });
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-duplicate-secureconnect-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 25,
    });

    await expect(client.connect()).resolves.toBeUndefined();
    expect(client.isConnected()).toBe(true);
  });

  it('connects via TLS with certificate verification enabled by default', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-verified-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 25,
    });

    await client.connect();
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });

  it('fails TLS connection when TLS socket emits error', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => tlsSocket.emit('error', new Error('tls exploded')));
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-error-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 25,
    });

    await expect(client.connect()).rejects.toThrow('tls exploded');
  });

  it('ignores late TLS errors after connection has already succeeded', async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();

    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit('connect'));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'tls-late-error-host',
      port: 50002,
      protocol: 'ssl',
      connectionTimeoutMs: 25,
    });

    await client.connect();
    expect(() => tlsSocket.emit('error', new Error('late tls error'))).not.toThrow();
  });
}
