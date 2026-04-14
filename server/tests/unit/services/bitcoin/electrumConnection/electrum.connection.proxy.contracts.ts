import { it, expect, vi } from 'vitest';
import { ElectrumClient, FakeSocket, tlsConnectMock, socksCreateConnectionMock, nodeConfigFindFirstMock } from './electrumConnectionTestHarness';

export function registerElectrumConnectionProxyContracts(): void {
  it('connects through SOCKS5 proxy when proxy is enabled', async () => {
    const proxiedSocket = new FakeSocket();
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });

    const client = new ElectrumClient({
      host: 'target-host',
      port: 50001,
      protocol: 'tcp',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
        username: 'u',
        password: 'p',
      },
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(socksCreateConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        proxy: expect.objectContaining({
          host: '127.0.0.1',
          port: 9050,
          type: 5,
          userId: 'u',
          password: 'p',
        }),
        destination: {
          host: 'target-host',
          port: 50001,
        },
        command: 'connect',
        timeout: 25,
      }),
    );
  });

  it('surfaces proxied connection failures', async () => {
    socksCreateConnectionMock.mockRejectedValueOnce(new Error('proxy unavailable'));

    const client = new ElectrumClient({
      host: 'target-host',
      port: 50001,
      protocol: 'tcp',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await expect(client.connect()).rejects.toThrow('proxy unavailable');
  });

  it('times out proxy connection attempts and reports proxy context', async () => {
    socksCreateConnectionMock.mockImplementationOnce(() => new Promise(() => undefined));

    const client = new ElectrumClient({
      host: 'target-host',
      port: 50001,
      protocol: 'tcp',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      connectionTimeoutMs: 25,
    });

    const rejected = client.connect().catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(30);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain('via proxy');
  });

  it('supports TLS over proxied sockets', async () => {
    const proxiedSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'proxy-tls-host',
      port: 50002,
      protocol: 'ssl',
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      connectionTimeoutMs: 25,
    });

    await client.connect();
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socket: proxiedSocket,
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });

  it('supports self-signed TLS over proxied sockets', async () => {
    const proxiedSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });
    tlsConnectMock.mockImplementationOnce((options: any, onSecureConnect: () => void) => {
      queueMicrotask(() => onSecureConnect());
      return tlsSocket;
    });

    const client = new ElectrumClient({
      host: 'proxy-self-signed-host',
      port: 50002,
      protocol: 'ssl',
      allowSelfSignedCert: true,
      proxy: {
        enabled: true,
        host: '127.0.0.1',
        port: 9050,
      },
      connectionTimeoutMs: 25,
    });

    await client.connect();
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        socket: proxiedSocket,
        rejectUnauthorized: false,
      }),
      expect.any(Function),
    );
  });

  it('creates proxy config without credentials when username/password are absent', async () => {
    const proxiedSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: 'electrum',
      host: 'db-host',
      port: 50001,
      useSsl: false,
      mainnetSingletonHost: 'mainnet-proxy-host',
      mainnetSingletonPort: 50003,
      mainnetSingletonSsl: false,
      proxyEnabled: true,
      proxyHost: '127.0.0.1',
      proxyPort: 9050,
      proxyUsername: null,
      proxyPassword: null,
    });
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });

    const client = new ElectrumClient();
    await client.connect();

    const socksOptions = socksCreateConnectionMock.mock.calls[0][0];
    expect(socksOptions.proxy.userId).toBeUndefined();
    expect(socksOptions.proxy.password).toBeUndefined();
  });
}
