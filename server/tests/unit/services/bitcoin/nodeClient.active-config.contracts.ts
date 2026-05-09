import { expect, it } from "vitest";
import type { NodeClientTestContext } from "./nodeClientTestContext";

export function registerNodeClientActiveConfigTests(
  context: NodeClientTestContext,
): void {
  const {
    buildNodeConfig,
    getActiveNodeConfig,
    getElectrumClientIfActive,
    getNodeClient,
    mainnetSingleton,
    mockPrismaClient,
    mockSaveAsDefault,
    mocks,
    poolFacade,
    poolSubscriptionClient,
    resetNodeClient,
    saveNodeConfig,
    testnetSingleton,
  } = context;

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
    mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(
      new Error("pool unavailable"),
    );

    const active = await getElectrumClientIfActive();
    expect(active).toBe(mainnetSingleton);
  });

  it("returns requested network singleton client when active", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnet3Enabled: true,
        testnet3Mode: "singleton",
      }),
    );
    testnetSingleton.isConnected.mockReturnValue(false);

    await getNodeClient("testnet3");
    const active = await getElectrumClientIfActive("testnet3");

    expect(active).toBe(testnetSingleton);
    expect(mocks.getElectrumClientForNetwork).toHaveBeenCalledWith("testnet3");
  });

  it("returns requested network pool subscription client when pool is initialized", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnet3Enabled: true,
        testnet3Mode: "pool",
      }),
    );

    const active = await getElectrumClientIfActive("testnet3");

    expect(active).toBe(poolSubscriptionClient);
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledWith("testnet3");
  });

  it("swallows requested network pool errors and returns singleton fallback", async () => {
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
      buildNodeConfig({
        testnet3Enabled: true,
        testnet3Mode: "singleton",
      }),
    );
    testnetSingleton.isConnected.mockReturnValue(false);
    await getNodeClient("testnet3");

    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({
        testnet3Enabled: true,
        testnet3Mode: "pool",
      }),
    );
    mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(
      new Error("pool unavailable"),
    );

    const active = await getElectrumClientIfActive("testnet3");
    expect(active).toBe(testnetSingleton);
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

  it("returns null from getElectrumClientIfActive when no pool or active singleton exists", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValueOnce(
      buildNodeConfig({ poolEnabled: false, mainnetMode: "singleton" }),
    );

    const active = await getElectrumClientIfActive();

    expect(active).toBeNull();
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
}
