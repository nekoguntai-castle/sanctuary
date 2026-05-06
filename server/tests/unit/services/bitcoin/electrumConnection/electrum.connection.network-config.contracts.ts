import { it, expect, vi } from "vitest";
import {
  ElectrumClient,
  FakeSocket,
  netConnectMock,
  tlsConnectMock,
  socksCreateConnectionMock,
  nodeConfigFindFirstMock,
} from "./electrumConnectionTestHarness";

export function registerElectrumConnectionNetworkConfigContracts(): void {
  it("connects via direct TCP and applies socket optimizations", async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });

    const client = new ElectrumClient({
      host: "tcp-host",
      port: 50001,
      protocol: "tcp",
      requestTimeoutMs: 20,
      batchRequestTimeoutMs: 30,
      connectionTimeoutMs: 25,
    });

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(netConnectMock).toHaveBeenCalledWith({
      host: "tcp-host",
      port: 50001,
    });
    expect(socket.setNoDelay).toHaveBeenCalledWith(true);
    expect(socket.setKeepAlive).toHaveBeenCalledWith(true, 30000);
  });

  it("loads mainnet singleton settings and proxy credentials from database config", async () => {
    const proxiedSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: false,
      mainnetSingletonHost: "mainnet-singleton-host",
      mainnetSingletonPort: 50003,
      mainnetSingletonSsl: false,
      allowSelfSignedCert: true,
      proxyEnabled: true,
      proxyHost: "127.0.0.1",
      proxyPort: 9050,
      proxyUsername: "tor-user",
      proxyPassword: "tor-pass",
    });
    socksCreateConnectionMock.mockResolvedValueOnce({ socket: proxiedSocket });

    const client = new ElectrumClient();
    await client.connect();

    expect(socksCreateConnectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        destination: {
          host: "mainnet-singleton-host",
          port: 50003,
        },
        proxy: expect.objectContaining({
          host: "127.0.0.1",
          port: 9050,
          userId: "tor-user",
          password: "tor-pass",
        }),
      }),
    );
  });

  it("uses mainnet legacy host, port, and useSsl when singleton fields are absent", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "mainnet-db-host",
      port: 55001,
      useSsl: true,
      mainnetSingletonHost: null,
      mainnetSingletonPort: null,
      mainnetSingletonSsl: null,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "mainnet-db-host",
      port: 55001,
    });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it("uses testnet3 Electrum defaults when singleton host and port are absent", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: false,
      testnet3SingletonSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    client.setNetwork("testnet3");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "electrum.blockstream.info",
      port: 60002,
    });
    expect(tlsConnectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        rejectUnauthorized: true,
      }),
      expect.any(Function),
    );
  });

  it("uses TLS for testnet3 when SSL setting is null", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: false,
      testnet3SingletonHost: "testnet-null-ssl-host",
      testnet3SingletonPort: 62002,
      testnet3SingletonSsl: null,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    client.setNetwork("testnet3");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "testnet-null-ssl-host",
      port: 62002,
    });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it("uses plain TCP for testnet3 when SSL is disabled", async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: true,
      testnet3SingletonHost: "testnet-plain-host",
      testnet3SingletonPort: 52001,
      testnet3SingletonSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork("testnet3");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "testnet-plain-host",
      port: 52001,
    });
    expect(tlsConnectMock).not.toHaveBeenCalled();
  });

  it("uses testnet4 defaults when singleton host, port, and SSL are absent", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: false,
      testnet4SingletonHost: null,
      testnet4SingletonPort: null,
      testnet4SingletonSsl: null,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    client.setNetwork("testnet4");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "",
      port: 60002,
    });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it("uses plain TCP for testnet4 when SSL is disabled", async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: true,
      testnet4SingletonHost: "testnet4-plain-host",
      testnet4SingletonPort: 52001,
      testnet4SingletonSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork("testnet4");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "testnet4-plain-host",
      port: 52001,
    });
    expect(tlsConnectMock).not.toHaveBeenCalled();
  });

  it("uses signet Electrum defaults when singleton host and port are absent", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: false,
      signetSingletonSsl: null,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    client.setNetwork("signet");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "electrum.mutinynet.com",
      port: 50002,
    });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it("uses TLS for signet when SSL is enabled", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: false,
      signetSingletonHost: "signet-ssl-host",
      signetSingletonPort: 60002,
      signetSingletonSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    client.setNetwork("signet");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "signet-ssl-host",
      port: 60002,
    });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it("uses plain TCP for signet when SSL is disabled", async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "db-host",
      port: 50001,
      useSsl: true,
      signetSingletonHost: "signet-plain-host",
      signetSingletonPort: 60001,
      signetSingletonSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork("signet");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "signet-plain-host",
      port: 60001,
    });
    expect(tlsConnectMock).not.toHaveBeenCalled();
  });

  it("uses regtest legacy host and port from database config", async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "regtest-host",
      port: 60401,
      useSsl: false,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });

    const client = new ElectrumClient();
    client.setNetwork("regtest");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "regtest-host",
      port: 60401,
    });
  });

  it("uses TLS for regtest when useSsl is true", async () => {
    const baseSocket = new FakeSocket();
    const tlsSocket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "electrum",
      host: "regtest-ssl-host",
      port: 60402,
      useSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => baseSocket.emit("connect"));
      return baseSocket;
    });
    tlsConnectMock.mockImplementationOnce(
      (options: any, onSecureConnect: () => void) => {
        queueMicrotask(() => onSecureConnect());
        return tlsSocket;
      },
    );

    const client = new ElectrumClient();
    client.setNetwork("regtest");
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "regtest-ssl-host",
      port: 60402,
    });
    expect(tlsConnectMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to environment electrum settings when db default is non-electrum", async () => {
    const socket = new FakeSocket();
    nodeConfigFindFirstMock.mockResolvedValueOnce({
      type: "bitcoin-core",
      host: "ignored",
      port: 18443,
      useSsl: true,
    });
    netConnectMock.mockImplementationOnce(() => {
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    });

    const client = new ElectrumClient();
    await client.connect();

    expect(netConnectMock).toHaveBeenCalledWith({
      host: "fallback-host",
      port: 50001,
    });
  });

  it("times out connection attempts when socket never connects", async () => {
    const socket = new FakeSocket();
    netConnectMock.mockImplementationOnce(() => socket);

    const client = new ElectrumClient({
      host: "tcp-timeout-host",
      port: 50001,
      protocol: "tcp",
      connectionTimeoutMs: 25,
    });

    const rejected = client.connect().catch((err: Error) => err);
    await vi.advanceTimersByTimeAsync(30);

    const error = await rejected;
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Connection timeout after 25ms");
  });
}
