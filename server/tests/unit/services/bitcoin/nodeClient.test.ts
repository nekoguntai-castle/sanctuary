import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockPrismaClient, resetPrismaMocks } from "../../../mocks/prisma";

const mocks = vi.hoisted(() => ({
  getElectrumPoolForNetwork: vi.fn(),
  getElectrumPool: vi.fn(),
  resetElectrumPool: vi.fn(),
  resetElectrumPoolForNetwork: vi.fn(),
  initializeElectrumPool: vi.fn(),
  getElectrumClientForNetwork: vi.fn(),
  resetElectrumClient: vi.fn(),
  electrumClientCtor: vi.fn(),
  verifyNodeClientNetwork: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/models/prisma", async () => {
  const { mockPrismaClient: prisma } = await import("../../../mocks/prisma");
  return {
    __esModule: true,
    default: prisma,
  };
});

const mockSaveAsDefault = vi.fn<any>().mockResolvedValue(undefined);

vi.mock("../../../../src/repositories", async () => {
  const { mockPrismaClient: prisma } = await import("../../../mocks/prisma");
  return {
    nodeConfigRepository: {
      findDefault: (...args: unknown[]) => prisma.nodeConfig.findFirst(...args),
      findDefaultWithServers: (...args: unknown[]) =>
        prisma.nodeConfig.findFirst(...args),
      findOrCreateDefault: vi.fn(),
      update: vi.fn(),
      saveAsDefault: (...args: unknown[]) => mockSaveAsDefault(...args),
      electrumServer: {
        updateHealth: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock("../../../../src/services/bitcoin/electrumPool", () => ({
  initializeElectrumPool: mocks.initializeElectrumPool,
  resetElectrumPool: mocks.resetElectrumPool,
  getElectrumPool: mocks.getElectrumPool,
  getElectrumPoolForNetwork: mocks.getElectrumPoolForNetwork,
  resetElectrumPoolForNetwork: mocks.resetElectrumPoolForNetwork,
}));

vi.mock("../../../../src/services/bitcoin/electrum", () => ({
  ElectrumClient: function MockElectrumClient(...args: unknown[]) {
    return mocks.electrumClientCtor(...args);
  },
  getElectrumClientForNetwork: mocks.getElectrumClientForNetwork,
  resetElectrumClient: mocks.resetElectrumClient,
}));

vi.mock("../../../../src/services/bitcoin/networkIdentity", () => ({
  verifyNodeClientNetwork: mocks.verifyNodeClientNetwork,
}));

vi.mock("../../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../../src/utils/errors", () => ({
  getErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));

import {
  getNodeClient,
  getActiveNodeConfig,
  getElectrumClientIfActive,
  resetNodeClient,
  saveNodeConfig,
  testNodeConfig,
} from "../../../../src/services/bitcoin/nodeClient";

function buildNodeConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: "default",
    isDefault: true,
    host: "electrum.mainnet.example",
    port: 50002,
    useSsl: true,
    poolEnabled: true,
    mainnetMode: "pool",
    mainnetSingletonHost: "electrum.mainnet.example",
    mainnetSingletonPort: 50002,
    mainnetSingletonSsl: true,
    mainnetPoolMin: 1,
    mainnetPoolMax: 5,
    mainnetPoolLoadBalancing: "round_robin",
    testnetEnabled: true,
    testnetMode: "singleton",
    testnetSingletonHost: "electrum.testnet.example",
    testnetSingletonPort: 60002,
    testnetSingletonSsl: true,
    testnetPoolMin: 1,
    testnetPoolMax: 3,
    testnetPoolLoadBalancing: "round_robin",
    testnet4Enabled: true,
    testnet4Mode: "singleton",
    testnet4SingletonHost: "electrum.testnet4.example",
    testnet4SingletonPort: 60004,
    testnet4SingletonSsl: true,
    testnet4PoolMin: 1,
    testnet4PoolMax: 3,
    testnet4PoolLoadBalancing: "round_robin",
    signetEnabled: true,
    signetMode: "singleton",
    signetSingletonHost: "electrum.signet.example",
    signetSingletonPort: 60003,
    signetSingletonSsl: true,
    signetPoolMin: 1,
    signetPoolMax: 3,
    signetPoolLoadBalancing: "round_robin",
    ...overrides,
  };
}

describe("nodeClient service", () => {
  const mainnetSingleton = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getBlockHeight: vi.fn(),
  };
  const testnetSingleton = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getBlockHeight: vi.fn(),
  };
  const poolSubscriptionClient = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(),
    getBlockHeight: vi.fn(),
  };
  const poolFacade = {
    getSubscriptionConnection: vi.fn(),
    isPoolInitialized: vi.fn(),
  };

  beforeEach(async () => {
    resetPrismaMocks();
    vi.clearAllMocks();

    mainnetSingleton.connect.mockResolvedValue(undefined);
    mainnetSingleton.disconnect.mockImplementation(() => undefined);
    mainnetSingleton.isConnected.mockReturnValue(true);

    testnetSingleton.connect.mockResolvedValue(undefined);
    testnetSingleton.disconnect.mockImplementation(() => undefined);
    testnetSingleton.isConnected.mockReturnValue(true);

    poolSubscriptionClient.isConnected.mockReturnValue(true);
    poolFacade.getSubscriptionConnection.mockResolvedValue(
      poolSubscriptionClient,
    );
    poolFacade.isPoolInitialized.mockReturnValue(true);

    mocks.getElectrumClientForNetwork.mockImplementation((network: string) => {
      if (network === "testnet3") return testnetSingleton;
      return mainnetSingleton;
    });
    mocks.getElectrumPoolForNetwork.mockResolvedValue(poolFacade);
    mocks.getElectrumPool.mockReturnValue(poolFacade);
    mocks.resetElectrumPool.mockResolvedValue(undefined);
    mocks.resetElectrumPoolForNetwork.mockResolvedValue(undefined);
    mocks.resetElectrumClient.mockImplementation(() => undefined);
    mocks.electrumClientCtor.mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getBlockHeight: vi.fn().mockResolvedValue(850000),
      getBlockHeader: vi.fn(),
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    }));

    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());

    await resetNodeClient();
  });

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

    expect(mainnetClient).toBe(poolSubscriptionClient); // default mainnet mode -> pool
    expect(testnet3Client).toBe(testnetSingleton); // default non-mainnet mode -> singleton
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

  it("returns pool subscription connection for active client when pool is enabled", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({ poolEnabled: true }),
    );

    const client = await getElectrumClientIfActive();

    expect(client).toBe(poolSubscriptionClient);
    expect(poolFacade.isPoolInitialized).toHaveBeenCalledTimes(1);
  });

  it("falls back to active singleton when pool is enabled but not initialized", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({ poolEnabled: true }),
    );
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({
        poolEnabled: false,
        mainnetMode: "singleton",
      }),
    );
    mainnetSingleton.isConnected.mockReturnValue(false);
    await getNodeClient("mainnet");

    poolFacade.isPoolInitialized.mockReturnValue(false);
    const active = await getElectrumClientIfActive();
    expect(active).toBe(mainnetSingleton);
  });

  it("swallows pool errors in getElectrumClientIfActive and returns singleton fallback", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({
        poolEnabled: false,
        mainnetMode: "singleton",
      }),
    );
    mainnetSingleton.isConnected.mockReturnValue(false);
    await getNodeClient("mainnet");

    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({ poolEnabled: true }),
    );
    mocks.getElectrumPool.mockImplementationOnce(() => {
      throw new Error("pool unavailable");
    });

    const active = await getElectrumClientIfActive();
    expect(active).toBe(mainnetSingleton);
  });

  it("falls back to active singleton client when pool mode is disabled", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        poolEnabled: false,
        mainnetMode: "singleton",
      }),
    );
    mainnetSingleton.isConnected.mockReturnValue(false);

    await getNodeClient("mainnet");
    const active = await getElectrumClientIfActive();

    expect(active).toBe(mainnetSingleton);
  });

  it("saves node config and returns it as active config", async () => {
    const config = {
      host: "saved.example.com",
      port: 50001,
      protocol: "tcp" as const,
    };

    await saveNodeConfig(config);
    const active = await getActiveNodeConfig();

    expect(mockSaveAsDefault).toHaveBeenCalledWith({
      host: "saved.example.com",
      port: 50001,
      useSsl: false,
    });
    expect(active).toEqual(config);
  });

  it("loads active node config from database when cache is empty", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({
        host: "loaded.example.com",
        port: 51002,
        useSsl: true,
      }),
    );

    const active = await getActiveNodeConfig();

    expect(active).toEqual({
      host: "loaded.example.com",
      port: 51002,
      protocol: "ssl",
      poolEnabled: true,
    });
  });

  it("returns default Electrum config when database has no active config", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(null);

    const active = await getActiveNodeConfig();

    expect(active.host).toBe("electrum.blockstream.info");
    expect(active.port).toBe(50002);
    expect(active.protocol).toBe("ssl");
  });

  it("returns default Electrum config when loading config from DB throws", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockRejectedValueOnce(
      new Error("db down"),
    );

    const active = await getActiveNodeConfig();
    expect(active.host).toBe("electrum.blockstream.info");
    expect(active.port).toBe(50002);
    expect(active.protocol).toBe("ssl");
  });

  it("maps database config with useSsl=false to tcp protocol", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({
        host: "tcp-only.example.com",
        port: 50001,
        useSsl: false,
      }),
    );

    const active = await getActiveNodeConfig();
    expect(active).toEqual({
      host: "tcp-only.example.com",
      port: 50001,
      protocol: "tcp",
      poolEnabled: true,
    });
  });

  it("falls back to mainnet pool mode when loading network config throws", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockRejectedValueOnce(
      new Error("db down"),
    );

    const client = await getNodeClient("mainnet");

    expect(client).toBe(poolSubscriptionClient);
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledWith("mainnet");
  });

  it("does not reconnect singleton fallback when pool fails but singleton is already connected", async () => {
    mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(
      new Error("pool unavailable"),
    );
    mainnetSingleton.isConnected.mockReturnValue(true);

    const client = await getNodeClient("mainnet");

    expect(client).toBe(mainnetSingleton);
    expect(mainnetSingleton.connect).not.toHaveBeenCalled();
  });

  it("reuses cached active config in getElectrumClientIfActive without reloading node config", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({ poolEnabled: false }),
    );

    await getElectrumClientIfActive();
    await getElectrumClientIfActive();

    expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns null from getElectrumClientIfActive when no pool or active singleton exists", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({ poolEnabled: false }),
    );

    const active = await getElectrumClientIfActive();

    expect(active).toBeNull();
  });

  it("tests node config successfully with verbose capability info", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    const testVerboseSupportFn = vi.fn().mockResolvedValue(true);
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: testVerboseSupportFn,
    }));

    const result = await testNodeConfig({
      host: "electrum.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(true);
    expect(result.info).toEqual({
      blockHeight: 901234,
      supportsVerbose: true,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("verifies configured network identity when testing node config", async () => {
    const testClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getBlockHeight: vi.fn().mockResolvedValue(133929),
      getBlockHeader: vi.fn(),
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    };
    mocks.electrumClientCtor.mockImplementationOnce(() => testClient);

    const result = await testNodeConfig({
      host: "electrum-testnet4.example.com",
      port: 60002,
      protocol: "ssl",
      network: "testnet4",
    });

    expect(result.success).toBe(true);
    expect(mocks.electrumClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({ network: "testnet4" }),
    );
    expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledWith(testClient, "testnet4");
  });

  it("disconnects test node clients that fail network identity verification", async () => {
    const testClient = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn(),
      getBlockHeight: vi.fn().mockResolvedValue(4959040),
      getBlockHeader: vi.fn(),
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    };
    mocks.electrumClientCtor.mockImplementationOnce(() => testClient);
    mocks.verifyNodeClientNetwork.mockRejectedValueOnce(
      new Error("Testnet4 chain identity mismatch"),
    );

    const result = await testNodeConfig({
      host: "electrum.blockstream.example",
      port: 60002,
      protocol: "ssl",
      network: "testnet4",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Testnet4 chain identity mismatch");
    expect(testClient.disconnect).toHaveBeenCalledTimes(1);
    expect(testClient.testVerboseSupport).not.toHaveBeenCalled();
  });

  it("handles verbose capability probe failures but still succeeds", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    const testVerboseSupportFn = vi
      .fn()
      .mockRejectedValue(new Error("capability unavailable"));
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: testVerboseSupportFn,
    }));

    const result = await testNodeConfig({
      host: "electrum.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(true);
    expect(result.info).toEqual({
      blockHeight: 901234,
      supportsVerbose: undefined,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("reports verbose unsupported when capability probe returns false", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    const testVerboseSupportFn = vi.fn().mockResolvedValue(false);
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: testVerboseSupportFn,
    }));

    const result = await testNodeConfig({
      host: "electrum.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain("verbose: no");
    expect(result.info).toEqual({
      blockHeight: 901234,
      supportsVerbose: false,
    });
  });

  it("returns connection failure from testNodeConfig", async () => {
    const connect = vi.fn().mockRejectedValue(new Error("connect failed"));
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect: vi.fn(),
      getBlockHeight: vi.fn(),
      testVerboseSupport: vi.fn(),
    }));

    const result = await testNodeConfig({
      host: "down.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("connect failed");
  });

  it("returns connection failure when test client construction fails", async () => {
    mocks.electrumClientCtor.mockImplementationOnce(() => {
      throw new Error("invalid test config");
    });

    const result = await testNodeConfig({
      host: "invalid.example.com",
      port: 50002,
      protocol: "ssl",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("invalid test config");
  });

  it("defaults protocol to ssl in testNodeConfig when protocol is omitted", async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const disconnect = vi.fn();
    const getBlockHeight = vi.fn().mockResolvedValue(901234);
    mocks.electrumClientCtor.mockImplementationOnce(() => ({
      connect,
      disconnect,
      getBlockHeight,
      testVerboseSupport: vi.fn().mockResolvedValue(true),
    }));

    const result = await testNodeConfig({
      host: "electrum-default.example.com",
      port: 50002,
    });

    expect(result.success).toBe(true);
    expect(mocks.electrumClientCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "electrum-default.example.com",
        port: 50002,
        protocol: "ssl",
      }),
    );
  });
});
