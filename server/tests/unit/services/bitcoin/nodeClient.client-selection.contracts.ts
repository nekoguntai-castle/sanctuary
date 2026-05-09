import { expect, it, vi } from "vitest";
import type { NodeClientTestContext } from "./nodeClientTestContext";

export function registerNodeClientSelectionTests(
  context: NodeClientTestContext,
): void {
  const {
    buildNodeConfig,
    getNodeClient,
    mainnetSingleton,
    mockPrismaClient,
    mocks,
    poolFacade,
    poolSubscriptionClient,
    resetNodeClient,
    testnetSingleton,
  } = context;

  it("uses pool mode for mainnet and reuses cached connected client", async () => {
    const first = await getNodeClient("mainnet");
    const second = await getNodeClient("mainnet");

    expect(first).toBe(poolSubscriptionClient);
    expect(second).toBe(first);
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
  });

  it("disconnects uncached clients that fail network identity verification", async () => {
    mocks.verifyNodeClientNetwork.mockRejectedValueOnce(
      new Error("Testnet4 chain identity mismatch"),
    );
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnet4Enabled: true,
        testnet4Mode: "singleton",
      }),
    );
    const testnet4Singleton = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi
        .fn()
        .mockImplementationOnce(() => {
          throw new Error("disconnect failed");
        })
        .mockImplementation(() => undefined),
      isConnected: vi.fn().mockReturnValue(true),
      getBlockHeight: vi.fn(),
    };
    mocks.getElectrumClientForNetwork.mockImplementation((network: string) => {
      if (network === "testnet4") return testnet4Singleton;
      return mainnetSingleton;
    });

    await expect(getNodeClient("testnet4")).rejects.toThrow(
      "Testnet4 chain identity mismatch",
    );

    expect(testnet4Singleton.disconnect).toHaveBeenCalledTimes(1);
    await expect(getNodeClient("testnet4")).resolves.toBe(testnet4Singleton);
    expect(mocks.getElectrumClientForNetwork).toHaveBeenCalledTimes(2);
  });

  it("falls back to singleton client when pool initialization fails", async () => {
    mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(
      new Error("pool unavailable"),
    );
    mainnetSingleton.isConnected.mockReturnValue(false);

    const client = await getNodeClient("mainnet");

    expect(client).toBe(mainnetSingleton);
    expect(mainnetSingleton.connect).toHaveBeenCalledTimes(1);
    expect(mocks.getElectrumClientForNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("uses singleton mode for testnet when configured", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnetMode: "singleton",
        testnetEnabled: true,
      }),
    );
    testnetSingleton.isConnected.mockReturnValue(false);

    const client = await getNodeClient("testnet3");

    expect(client).toBe(testnetSingleton);
    expect(testnetSingleton.connect).toHaveBeenCalledTimes(1);
    expect(mocks.getElectrumPoolForNetwork).not.toHaveBeenCalled();
  });

  it("uses testnet singleton defaults when per-network testnet fields are null", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnetEnabled: true,
        testnetMode: null,
        testnetSingletonHost: null,
        testnetSingletonPort: null,
        testnetSingletonSsl: null,
        testnetPoolMin: null,
        testnetPoolMax: null,
        testnetPoolLoadBalancing: null,
      }),
    );
    testnetSingleton.isConnected.mockReturnValue(true);

    const client = await getNodeClient("testnet3");

    expect(client).toBe(testnetSingleton);
    expect(testnetSingleton.connect).not.toHaveBeenCalled();
    expect(mocks.getElectrumPoolForNetwork).not.toHaveBeenCalled();
  });

  it("fails fast when signet is disabled in DB config", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        signetEnabled: false,
        signetMode: "pool",
      }),
    );
    const signetSingleton = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
      getBlockHeight: vi.fn(),
    };
    mocks.getElectrumClientForNetwork.mockImplementation((network: string) => {
      if (network === "signet") return signetSingleton;
      return mainnetSingleton;
    });

    await expect(getNodeClient("signet")).rejects.toThrow(
      "Signet sync is off in Node Configuration",
    );

    expect(signetSingleton.connect).not.toHaveBeenCalled();
    expect(mocks.getElectrumPoolForNetwork).not.toHaveBeenCalled();
  });

  it("fails fast when testnet is disabled in DB config", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnetEnabled: false,
        testnetMode: "pool",
      }),
    );
    testnetSingleton.isConnected.mockReturnValue(false);

    await expect(getNodeClient("testnet3")).rejects.toThrow(
      "Testnet3 sync is off in Node Configuration",
    );

    expect(testnetSingleton.connect).not.toHaveBeenCalled();
    expect(mocks.getElectrumPoolForNetwork).not.toHaveBeenCalled();
  });

  it("fails fast when testnet4 is disabled in DB config", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnet4Enabled: false,
        testnet4Mode: "pool",
      }),
    );

    await expect(getNodeClient("testnet4")).rejects.toThrow(
      "Testnet4 sync is off in Node Configuration",
    );

    expect(mocks.getElectrumPoolForNetwork).not.toHaveBeenCalled();
  });

  it("uses singleton mode for regtest with legacy host/port config", async () => {
    const regtestSingleton = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
      getBlockHeight: vi.fn(),
    };
    mocks.getElectrumClientForNetwork.mockImplementation((network: string) => {
      if (network === "regtest") return regtestSingleton;
      return mainnetSingleton;
    });
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        host: "127.0.0.1",
        port: 60401,
        useSsl: false,
      }),
    );

    const client = await getNodeClient("regtest");

    expect(client).toBe(regtestSingleton);
    expect(regtestSingleton.connect).toHaveBeenCalledTimes(1);
  });

  it("falls back to default mode selection when node config does not exist", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(null);
    testnetSingleton.isConnected.mockReturnValue(false);

    const mainnetClient = await getNodeClient("mainnet");
    const testnet3Client = await getNodeClient("testnet3");

    expect(mainnetClient).toBe(poolSubscriptionClient);
    expect(testnet3Client).toBe(testnetSingleton);
    expect(testnetSingleton.connect).toHaveBeenCalledTimes(1);
  });

  it("uses default mode branch for unknown network values", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());

    const unknownClient = await getNodeClient("unknownnet" as any);
    expect(unknownClient).toBe(poolSubscriptionClient);
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledWith("unknownnet");
  });

  it("supports signet pool mode and defaulted null per-network values", async () => {
    const signetPoolClient = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      getBlockHeight: vi.fn(),
    };
    const signetPool = {
      getSubscriptionConnection: vi.fn().mockResolvedValue(signetPoolClient),
      isPoolInitialized: vi.fn().mockReturnValue(true),
    };

    mocks.getElectrumPoolForNetwork.mockImplementation(
      async (network: string) => {
        if (network === "signet") return signetPool as any;
        return poolFacade as any;
      },
    );

    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        signetEnabled: true,
        signetMode: "pool",
        signetSingletonHost: null,
        signetSingletonPort: null,
        signetSingletonSsl: null,
        signetPoolMin: null,
        signetPoolMax: null,
        signetPoolLoadBalancing: null,
      }),
    );

    const client = await getNodeClient("signet");
    expect(client).toBe(signetPoolClient);
    expect(
      (signetPool.getSubscriptionConnection as any).mock.calls.length,
    ).toBe(1);
  });

  it("supports testnet4 pool mode and defaulted null per-network values", async () => {
    const testnet4PoolClient = {
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      getBlockHeight: vi.fn(),
    };
    const testnet4Pool = {
      getSubscriptionConnection: vi.fn().mockResolvedValue(testnet4PoolClient),
      isPoolInitialized: vi.fn().mockReturnValue(true),
    };

    mocks.getElectrumPoolForNetwork.mockImplementation(
      async (network: string) => {
        if (network === "testnet4") return testnet4Pool as any;
        return poolFacade as any;
      },
    );

    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnet4Enabled: true,
        testnet4Mode: "pool",
        testnet4SingletonHost: null,
        testnet4SingletonPort: null,
        testnet4SingletonSsl: null,
        testnet4PoolMin: null,
        testnet4PoolMax: null,
        testnet4PoolLoadBalancing: null,
      }),
    );

    const client = await getNodeClient("testnet4");
    expect(client).toBe(testnet4PoolClient);
    expect(
      (testnet4Pool.getSubscriptionConnection as any).mock.calls.length,
    ).toBe(1);
  });

  it("uses signet singleton defaults when signet mode is null", async () => {
    const signetSingleton = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
      getBlockHeight: vi.fn(),
    };
    mocks.getElectrumClientForNetwork.mockImplementation((network: string) => {
      if (network === "signet") return signetSingleton;
      if (network === "testnet3") return testnetSingleton;
      return mainnetSingleton;
    });
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        signetEnabled: true,
        signetMode: null,
      }),
    );

    const client = await getNodeClient("signet");
    expect(client).toBe(signetSingleton);
    expect(signetSingleton.connect).not.toHaveBeenCalled();
  });

  it("uses fallback defaults for null mainnet network-mode fields", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        mainnetMode: null,
        mainnetSingletonHost: null,
        mainnetSingletonPort: null,
        mainnetSingletonSsl: null,
        mainnetPoolMin: null,
        mainnetPoolMax: null,
        mainnetPoolLoadBalancing: null,
      }),
    );

    const client = await getNodeClient("mainnet");
    expect(client).toBe(poolSubscriptionClient);
  });

  it("resets a single network client and reconnects on next request", async () => {
    const disconnectCallsBefore =
      poolSubscriptionClient.disconnect.mock.calls.length;
    await getNodeClient("mainnet");
    await resetNodeClient("mainnet");
    await getNodeClient("mainnet");

    expect(poolSubscriptionClient.disconnect.mock.calls.length).toBe(
      disconnectCallsBefore + 1,
    );
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledWith("mainnet");
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
  });

  it("resetNodeClient handles uncached network clients without disconnecting", async () => {
    const disconnectCallsBefore =
      poolSubscriptionClient.disconnect.mock.calls.length;
    await resetNodeClient("signet");

    expect(poolSubscriptionClient.disconnect.mock.calls.length).toBe(
      disconnectCallsBefore,
    );
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledWith("signet");
  });
}
