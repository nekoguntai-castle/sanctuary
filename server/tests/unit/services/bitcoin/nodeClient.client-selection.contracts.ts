import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  POOL_FALLBACK_RETRY_MS,
  waitForPoolRetryProbeForTests,
} from "../../../../src/services/bitcoin/nodeClient";
import { PooledNodeClient } from "../../../../src/services/bitcoin/pooledNodeClient";
import type { NodeClientTestContext } from "./nodeClientTestContext";

/** Pins Date.now() for the pool-fallback retry window; restore after each test. */
function pinClock(start: number) {
  let now = start;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
  return {
    set: (value: number) => { now = value; },
    restore: () => spy.mockRestore(),
  };
}

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

  describe("pool fallback retry window", () => {
    const T0 = 1_000_000;
    let clock: ReturnType<typeof pinClock>;

    beforeEach(() => {
      clock = pinClock(T0);
      // The outer beforeEach's reset may already have disconnected a previous test's cached singleton.
      mainnetSingleton.disconnect.mockClear();
    });

    // The repo config only clears mocks, so queued *Once values would leak into later tests.
    afterEach(() => {
      clock.restore();
      mocks.getElectrumPoolForNetwork.mockReset();
      mocks.getElectrumPoolForNetwork.mockResolvedValue(poolFacade);
      mocks.verifyNodeClientNetwork.mockReset();
      mocks.verifyNodeClientNetwork.mockResolvedValue(undefined);
    });

    /** Fails the pool once at T0 so mainnet caches the connected singleton as a fallback. */
    async function enterFallback(): Promise<void> {
      mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(new Error("pool unavailable"));
      mainnetSingleton.isConnected.mockReturnValue(true);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
    }

    /** Lets a background pool probe that has reached the pool getter settle. */
    async function settleProbe(poolCalls: number): Promise<void> {
      await vi.waitFor(() => {
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(poolCalls);
      });
      for (let turn = 0; turn < 5; turn += 1) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    }

    /** Resolves to "pending" when the call has not settled after a few event-loop turns. */
    async function settledWithin<T>(promise: Promise<T>): Promise<T | "pending"> {
      const pending = new Promise<"pending">((resolve) => {
        setTimeout(() => resolve("pending"), 50);
      });
      return Promise.race([promise, pending]);
    }

    it("retries the pool in the background after the window and swaps to it on success", async () => {
      await enterFallback();

      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      // The claimant keeps the verified fallback; the pool is probed behind it.
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      await settleProbe(2);

      const recovered = await getNodeClient("mainnet");
      expect(recovered).toBeInstanceOf(PooledNodeClient);
      // The singleton is process-shared; recovering the pool must not close it.
      expect(mainnetSingleton.disconnect).not.toHaveBeenCalled();
      await expect(getNodeClient("mainnet")).resolves.toBe(recovered);
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
    });

    it("within the window returns the cached fallback without re-attempting the pool", async () => {
      await enterFallback();
      clock.set(T0 + POOL_FALLBACK_RETRY_MS - 1);

      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
    });

    it("a repeated pool failure keeps the fallback and extends the deadline", async () => {
      await enterFallback();
      mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(new Error("pool still unavailable"));

      const firstRetryAt = T0 + POOL_FALLBACK_RETRY_MS + 1;
      clock.set(firstRetryAt);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      await settleProbe(2);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);

      // Still inside the extended window measured from the claimed retry.
      clock.set(firstRetryAt + POOL_FALLBACK_RETRY_MS - 1);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);

      clock.set(firstRetryAt + POOL_FALLBACK_RETRY_MS + 1);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      await settleProbe(3);
      await expect(getNodeClient("mainnet")).resolves.toBeInstanceOf(PooledNodeClient);
      expect(mainnetSingleton.disconnect).not.toHaveBeenCalled();
    });

    it("concurrent callers after the deadline share one pool retry and keep the fallback", async () => {
      let resolvePool: ((pool: unknown) => void) | undefined;
      try {
        await enterFallback();

        clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
        mocks.getElectrumPoolForNetwork.mockReturnValueOnce(
          new Promise((resolve) => { resolvePool = resolve; }),
        );

        // Neither the claimant nor a concurrent caller waits on, or repeats, the claimed retry.
        const callers = [getNodeClient("mainnet"), getNodeClient("mainnet")];
        await expect(settledWithin(Promise.all(callers))).resolves.toEqual([
          mainnetSingleton,
          mainnetSingleton,
        ]);
        await vi.waitFor(() => {
          expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
        });

        resolvePool?.(poolFacade);
        await settleProbe(2);
        await expect(getNodeClient("mainnet")).resolves.toBeInstanceOf(PooledNodeClient);
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
      } finally {
        resolvePool?.(poolFacade);
      }
    });

    it("a retry that falls back does not re-verify or disconnect the shared singleton", async () => {
      await enterFallback();
      mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(new Error("pool still unavailable"));
      expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledTimes(1);

      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      await settleProbe(2);

      // Only the first fallback is verified; the cached, connected singleton is not re-checked.
      expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledTimes(1);
      expect(mainnetSingleton.disconnect).not.toHaveBeenCalled();
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
    });

    it("a probe whose pool fails identity verification keeps the fallback connected", async () => {
      await enterFallback();
      mocks.verifyNodeClientNetwork.mockRejectedValueOnce(new Error("identity mismatch"));

      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      await settleProbe(2);

      expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledTimes(2);
      expect(mainnetSingleton.disconnect).not.toHaveBeenCalled();
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
    });

    it("an aborted claimant still gets the cached fallback", async () => {
      let resolvePool: ((pool: unknown) => void) | undefined;
      try {
        await enterFallback();
        clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
        mocks.getElectrumPoolForNetwork.mockReturnValueOnce(
          new Promise((resolve) => { resolvePool = resolve; }),
        );

        const controller = new AbortController();
        const claim = getNodeClient("mainnet", { signal: controller.signal });
        controller.abort(new Error("caller cancelled"));

        await expect(claim).resolves.toBe(mainnetSingleton);
      } finally {
        resolvePool?.(poolFacade);
      }
    });

    it("the background probe does not use the claimant's signal or deadline", async () => {
      await enterFallback();
      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      const callerSignal = new AbortController().signal;
      const callerDeadline = Date.now() - 1;
      mocks.verifyNodeClientNetwork.mockImplementation(
        async (_client: unknown, _network: unknown, options?: { deadlineAt?: number }) => {
          if (options?.deadlineAt !== undefined && options.deadlineAt <= Date.now()) {
            throw new Error("deadline exceeded");
          }
        },
      );

      await expect(
        getNodeClient("mainnet", { signal: callerSignal, deadlineAt: callerDeadline }),
      ).resolves.toBe(mainnetSingleton);
      await settleProbe(2);

      const probeOptions = mocks.verifyNodeClientNetwork.mock.calls[1]?.[2];
      expect(probeOptions?.signal).not.toBe(callerSignal);
      expect(probeOptions?.deadlineAt).not.toBe(callerDeadline);
      await expect(getNodeClient("mainnet")).resolves.toBeInstanceOf(PooledNodeClient);
    });

    it("a probe that never resolves does not block callers", async () => {
      await enterFallback();
      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      mocks.getElectrumPoolForNetwork.mockReturnValueOnce(new Promise(() => undefined));

      await expect(settledWithin(getNodeClient("mainnet"))).resolves.toBe(mainnetSingleton);
      await expect(settledWithin(getNodeClient("mainnet"))).resolves.toBe(mainnetSingleton);
      expect(mainnetSingleton.disconnect).not.toHaveBeenCalled();
    });

    it("a reset during an in-flight pool retry does not cache the stale facade", async () => {
      let resolvePool: ((pool: unknown) => void) | undefined;
      try {
        await enterFallback();
        clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
        mocks.getElectrumPoolForNetwork.mockReturnValueOnce(
          new Promise((resolve) => { resolvePool = resolve; }),
        );

        const claim = getNodeClient("mainnet");
        await vi.waitFor(() => {
          expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
        });
        await resetNodeClient("mainnet");
        resolvePool?.(poolFacade);
        await claim;
        await settleProbe(2);

        // The reset emptied the cache, so the next caller builds a fresh client.
        await expect(getNodeClient("mainnet")).resolves.toBeInstanceOf(PooledNodeClient);
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(3);
      } finally {
        resolvePool?.(poolFacade);
      }
    });

    it("a probe that finds the network switched out of pool mode keeps the fallback", async () => {
      await enterFallback();
      mockPrismaClient.nodeConfig.findFirst.mockResolvedValue(
        buildNodeConfig({ mainnetMode: "singleton" }),
      );

      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      await waitForPoolRetryProbeForTests("mainnet");
      expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledTimes(2);

      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      expect(mainnetSingleton.disconnect).not.toHaveBeenCalled();

      // The fallback is now the configured singleton, so no further probe is claimed.
      clock.set(T0 + 2 * POOL_FALLBACK_RETRY_MS + 2);
      await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
      // A wrongly claimed probe would be the latest one; awaiting it lets it reach the config.
      await waitForPoolRetryProbeForTests("mainnet");
      expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledTimes(2);
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
    });

    it("a global reset before the probe reaches the pool stops it", async () => {
      let resolveConfig: ((config: unknown) => void) | undefined;
      try {
        await enterFallback();
        clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
        mockPrismaClient.nodeConfig.findFirst.mockReturnValueOnce(
          new Promise((resolve) => { resolveConfig = resolve; }),
        );

        await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
        await vi.waitFor(() => {
          expect(mockPrismaClient.nodeConfig.findFirst).toHaveBeenCalledTimes(2);
        });
        await resetNodeClient();
        resolveConfig?.(buildNodeConfig());
        await waitForPoolRetryProbeForTests("mainnet");
        // The probe saw the reset before it reached the pool getter.
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
      } finally {
        resolveConfig?.(buildNodeConfig());
      }
    });

    it("a probe stops after a reset even when the same fallback is cached again", async () => {
      let resolvePool: ((pool: unknown) => void) | undefined;
      try {
        await enterFallback();
        clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
        mocks.getElectrumPoolForNetwork.mockReturnValueOnce(
          new Promise((resolve) => { resolvePool = resolve; }),
        );
        await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
        await vi.waitFor(() => {
          expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
        });

        // After the reset a foreground caller's pool fails again, re-caching the very same
        // singleton, so only the reset generation, not the cache identity, marks the probe stale.
        await resetNodeClient("mainnet");
        mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(new Error("pool still unavailable"));
        await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(3);

        resolvePool?.(poolFacade);
        await waitForPoolRetryProbeForTests("mainnet");
        await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(3);
      } finally {
        resolvePool?.(poolFacade);
      }
    });

    it("a probe does not replace a client that superseded a dropped fallback", async () => {
      let resolvePool: ((pool: unknown) => void) | undefined;
      try {
        await enterFallback();
        clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
        mocks.getElectrumPoolForNetwork.mockReturnValueOnce(
          new Promise((resolve) => { resolvePool = resolve; }),
        );
        await expect(getNodeClient("mainnet")).resolves.toBe(mainnetSingleton);
        await vi.waitFor(() => {
          expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
        });

        // The fallback drops and the next caller caches a fresh pool facade.
        mainnetSingleton.isConnected.mockReturnValue(false);
        const fresh = await getNodeClient("mainnet");
        expect(fresh).toBeInstanceOf(PooledNodeClient);

        resolvePool?.(poolFacade);
        await settleProbe(3);
        await expect(getNodeClient("mainnet")).resolves.toBe(fresh);
      } finally {
        resolvePool?.(poolFacade);
      }
    });

    it("a reset during a first-time pool attempt does not cache the stale facade", async () => {
      let resolvePool: ((pool: unknown) => void) | undefined;
      try {
        mocks.getElectrumPoolForNetwork.mockReturnValueOnce(
          new Promise((resolve) => { resolvePool = resolve; }),
        );
        const attempt = getNodeClient("mainnet");
        await vi.waitFor(() => {
          expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(1);
        });
        await resetNodeClient("mainnet");
        resolvePool?.(poolFacade);
        await expect(attempt).resolves.toBeInstanceOf(PooledNodeClient);

        await expect(getNodeClient("mainnet")).resolves.toBeInstanceOf(PooledNodeClient);
        expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
      } finally {
        resolvePool?.(poolFacade);
      }
    });

    it("a caller after the fallback drops reconnects and verifies the singleton again", async () => {
      await enterFallback();
      mainnetSingleton.connect.mockClear();

      mainnetSingleton.isConnected.mockReturnValue(false);
      mocks.getElectrumPoolForNetwork.mockRejectedValueOnce(new Error("pool still unavailable"));
      mainnetSingleton.connect.mockImplementationOnce(async () => {
        mainnetSingleton.isConnected.mockReturnValue(true);
      });
      mocks.verifyNodeClientNetwork.mockRejectedValueOnce(new Error("identity mismatch"));

      await expect(getNodeClient("mainnet")).rejects.toThrow("identity mismatch");
      expect(mainnetSingleton.connect).toHaveBeenCalledOnce();
      expect(mocks.verifyNodeClientNetwork).toHaveBeenCalledTimes(2);
      expect(mainnetSingleton.disconnect).toHaveBeenCalledOnce();
    });

    it("reset clears the retry deadline", async () => {
      await enterFallback();

      await resetNodeClient("mainnet");
      const recovered = await getNodeClient("mainnet");
      expect(recovered).toBeInstanceOf(PooledNodeClient);

      // A stale fallback deadline must not re-resolve a healthy pool facade.
      clock.set(T0 + POOL_FALLBACK_RETRY_MS + 1);
      await expect(getNodeClient("mainnet")).resolves.toBe(recovered);
      expect(mocks.getElectrumPoolForNetwork).toHaveBeenCalledTimes(2);
    });
  });
}
