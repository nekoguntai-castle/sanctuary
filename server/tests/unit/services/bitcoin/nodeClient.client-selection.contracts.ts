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
    poolRelease,
    poolRequestClient,
    poolSubscriptionClient,
    resetNodeClient,
    testnetSingleton,
  } = context;

  it("uses a cached pool facade while borrowing an isolated request connection", async () => {
    const first = await getNodeClient("mainnet");
    const second = await getNodeClient("mainnet");

    expect(second).toBe(first);
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
    expect(poolFacade.getSubscriptionConnection).not.toHaveBeenCalled();

    await expect(first.getBlockHeight()).resolves.toBe(850000);
    expect(poolFacade.acquire).toHaveBeenCalledWith({ purpose: "node-request" });
    expect(poolRequestClient.getBlockHeight).toHaveBeenCalledOnce();
    expect(poolRelease).toHaveBeenCalledOnce();
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

  it("falls back to singleton client when the initialized pool cannot lend a connection", async () => {
    poolFacade.acquire.mockRejectedValueOnce(new Error("pool has no usable connections"));
    mocks.verifyNodeClientNetwork.mockImplementationOnce(async (client: any) => {
      await client.getBlockHeight();
    });
    mainnetSingleton.isConnected.mockReturnValue(false);

    const client = await getNodeClient("mainnet");

    expect(client).toBe(mainnetSingleton);
    expect(poolFacade.acquire).toHaveBeenCalledOnce();
    expect(mainnetSingleton.connect).toHaveBeenCalledOnce();
  });

  it("does not fall back to a singleton after pool acquisition is cancelled", async () => {
    const controller = new AbortController();
    const abortReason = new Error("sync attempt cancelled");
    let rejectPool!: (error: unknown) => void;
    const poolAttempt = new Promise<never>((_resolve, reject) => {
      rejectPool = reject;
    });
    mocks.getElectrumPoolForNetwork.mockReturnValueOnce(poolAttempt);
    mainnetSingleton.isConnected.mockReturnValue(false);

    const pending = (getNodeClient as any)("mainnet", {
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    }) as Promise<unknown>;
    await vi.waitFor(() => {
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
    });
    controller.abort(abortReason);
    rejectPool(new Error("pool unavailable after cancellation"));

    await expect(pending).rejects.toBe(abortReason);

    expect(mocks.getElectrumClientForNetwork).not.toHaveBeenCalled();
    expect(mainnetSingleton.connect).not.toHaveBeenCalled();
  });

  it("detaches an aborted caller promptly from shared pool initialization", async () => {
    const controller = new AbortController();
    const abortReason = new Error("sync attempt cancelled during pool initialization");
    let resolvePool!: (pool: typeof poolFacade) => void;
    const poolAttempt = new Promise<typeof poolFacade>((resolve) => {
      resolvePool = resolve;
    });
    mocks.getElectrumPoolForNetwork.mockReturnValueOnce(poolAttempt);

    let rejection: unknown;
    const pending = (getNodeClient as any)("mainnet", {
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    }).catch((error: unknown) => {
      rejection = error;
    });
    await vi.waitFor(() => {
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
    });

    controller.abort(abortReason);
    await new Promise(resolve => setTimeout(resolve, 0));
    const detachedBeforeSharedInitializationSettled = rejection === abortReason;

    resolvePool(poolFacade);
    await pending;

    expect(detachedBeforeSharedInitializationSettled).toBe(true);
    expect(rejection).toBe(abortReason);
    expect(mocks.getElectrumClientForNetwork).not.toHaveBeenCalled();
  });

  it.each([
    ["a string reason", "configuration superseded", "configuration superseded"],
    ["a null reason", null, "Node client request cancelled"],
  ])("normalizes %s while detaching from shared configuration loading", async (
    _label,
    reason,
    expectedMessage,
  ) => {
    const controller = new AbortController();
    let resolveConfig!: (config: ReturnType<typeof buildNodeConfig>) => void;
    const configAttempt = new Promise<ReturnType<typeof buildNodeConfig>>((resolve) => {
      resolveConfig = resolve;
    });
    mockPrismaClient.nodeConfig.findFirst.mockReturnValueOnce(configAttempt);

    const pending = (getNodeClient as any)("mainnet", {
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    }) as Promise<unknown>;
    await vi.waitFor(() => {
      expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledOnce();
    });

    controller.abort(reason);

    await expect(pending).rejects.toThrow(expectedMessage);
    resolveConfig(buildNodeConfig());
  });

  it("does not disconnect a shared client when one caller aborts identity verification", async () => {
    const controller = new AbortController();
    const abortReason = new Error("caller A cancelled during identity verification");
    mocks.verifyNodeClientNetwork
      .mockImplementationOnce(
        (_client: unknown, _network: unknown, options: { signal?: AbortSignal }) =>
          new Promise<void>((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(undefined);

    const disconnectCallsBefore = poolSubscriptionClient.disconnect.mock.calls.length;
    const callerA = (getNodeClient as any)("mainnet", {
      signal: controller.signal,
      deadlineAt: Date.now() + 60_000,
    }) as Promise<unknown>;
    await vi.waitFor(() => {
      expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledTimes(1);
    });

    const callerB = getNodeClient("mainnet");
    await expect(callerB).resolves.not.toBe(poolSubscriptionClient);
    controller.abort(abortReason);

    await expect(callerA).rejects.toBe(abortReason);
    expect(poolSubscriptionClient.disconnect.mock.calls.length).toBe(
      disconnectCallsBefore,
    );
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

    expect(mainnetClient).not.toBe(poolSubscriptionClient);
    expect(testnet3Client).toBe(testnetSingleton);
    expect(testnetSingleton.connect).toHaveBeenCalledTimes(1);
  });

  it("uses default mode branch for unknown network values", async () => {
    await resetNodeClient();
    mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(buildNodeConfig());

    const unknownClient = await getNodeClient("unknownnet" as any);
    expect(unknownClient).not.toBe(poolSubscriptionClient);
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
    expect(client).not.toBe(signetPoolClient);
    expect(signetPool.getSubscriptionConnection).not.toHaveBeenCalled();
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
    expect(client).not.toBe(testnet4PoolClient);
    expect(testnet4Pool.getSubscriptionConnection).not.toHaveBeenCalled();
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
    expect(client).not.toBe(poolSubscriptionClient);
  });

  it("resets a single network client and reconnects on next request", async () => {
    await getNodeClient("mainnet");
    await resetNodeClient("mainnet");
    await getNodeClient("mainnet");

    expect(poolSubscriptionClient.disconnect).not.toHaveBeenCalled();
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledWith("mainnet");
    expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
  });

  it("resetNodeClient handles uncached network clients without disconnecting", async () => {
    await resetNodeClient("signet");

    expect(poolSubscriptionClient.disconnect).not.toHaveBeenCalled();
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledWith("signet");
  });

  it("coalesces concurrent resets of the same failed network connection", async () => {
    await getNodeClient("mainnet");
    mocks.resetElectrumPoolForNetwork.mockClear();
    poolSubscriptionClient.disconnect.mockClear();
    let finishReset!: () => void;
    mocks.resetElectrumPoolForNetwork.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishReset = resolve; }),
    );

    const first = resetNodeClient("mainnet");
    const second = resetNodeClient("mainnet");

    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledOnce();
    expect(poolSubscriptionClient.disconnect).not.toHaveBeenCalled();

    finishReset();
    await Promise.all([first, second]);
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledOnce();
  });

  it("coalesces a global reset that starts during a network reset", async () => {
    await getNodeClient("mainnet");
    mocks.resetElectrumPoolForNetwork.mockClear();
    let finishReset!: () => void;
    mocks.resetElectrumPoolForNetwork.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishReset = resolve; }),
    );

    const networkReset = resetNodeClient("mainnet");
    const globalReset = resetNodeClient();
    const overlappingNetworkReset = resetNodeClient("mainnet");

    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledOnce();
    finishReset();
    await Promise.all([networkReset, globalReset, overlappingNetworkReset]);
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledOnce();
  });

  it("coalesces a network reset that starts during a global reset", async () => {
    await getNodeClient("mainnet");
    mocks.resetElectrumPoolForNetwork.mockClear();
    let finishReset!: () => void;
    mocks.resetElectrumPoolForNetwork.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishReset = resolve; }),
    );

    const globalReset = resetNodeClient();
    const overlappingGlobalReset = resetNodeClient();
    const networkReset = resetNodeClient("mainnet");
    await vi.waitFor(() => {
      expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledOnce();
    });
    finishReset();

    await Promise.all([globalReset, overlappingGlobalReset, networkReset]);
    expect(mocks.resetElectrumPoolForNetwork).toHaveBeenCalledOnce();
  });
}
