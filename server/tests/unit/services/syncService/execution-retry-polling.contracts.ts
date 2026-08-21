import { expect, it, vi } from "vitest";
import {
  mockAcquireLock,
  mockGetWorkerHealthStatus,
  mockNotificationService,
  mockPopulateMissingTransactionFields,
  mockPrismaClient,
  mockReleaseLock,
  mockSyncWallet,
  type SyncServiceTestContext,
} from "./syncServiceTestHarness";
import { LockAuthorityUnavailableError } from "../../../../src/infrastructure";

export function registerSyncServiceExecutionRetryPollingTests(
  context: SyncServiceTestContext,
): void {
  describe("distributed locking", () => {
    it("should acquire lock before syncing", async () => {
      context.syncService["isRunning"] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });

      await context.syncService.syncNow("wallet-1");

      expect(mockAcquireLock).toHaveBeenCalledWith(
        "sync:wallet:wallet-1",
        expect.objectContaining({ ttlMs: expect.any(Number) }),
      );
    });

    it("should release lock after sync", async () => {
      context.syncService["isRunning"] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });

      await context.syncService.syncNow("wallet-1");

      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it("should skip sync if lock cannot be acquired", async () => {
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValue(null);

      const result = await context.syncService.syncNow("wallet-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Already syncing");
    });

    it("re-arms a laddered retry blocked by a held lock instead of dropping it", async () => {
      // The retry timer deletes its own pendingRetries entry before calling, so
      // returning bare "Already syncing" left nothing armed and no DB write.
      // That is how a 31-minute lock became a 14.5-hour stall (2026-08-20).
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValue(null);
      const state = context.syncService["state"];
      state.pendingRetries.clear();

      const result = await context.syncService["executeSyncJob"]("wallet-laddered", 2);

      expect(result.error).toContain("Already syncing");
      expect(state.pendingRetries.has("wallet-laddered")).toBe(true);
      clearTimeout(state.pendingRetries.get("wallet-laddered")!);
      state.pendingRetries.delete("wallet-laddered");
    });

    it("actually re-runs the sync when the re-armed lock retry fires", async () => {
      // Covers the timer body: without this the re-arm is only proven to have
      // been scheduled, not to lead anywhere.
      vi.useFakeTimers();
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValue(null);
      const state = context.syncService["state"];
      state.pendingRetries.clear();

      await context.syncService["executeSyncJob"]("wallet-refires", 2);
      expect(state.pendingRetries.has("wallet-refires")).toBe(true);

      await vi.runOnlyPendingTimersAsync();

      // The timer clears its own entry before re-invoking, and the re-invocation
      // hits the same held lock and re-arms again - bounded by the lock's TTL.
      expect(mockAcquireLock).toHaveBeenCalledTimes(2);

      for (const timer of state.pendingRetries.values()) clearTimeout(timer);
      state.pendingRetries.clear();
      vi.useRealTimers();
    });

    it("contains a rejection from the re-armed retry rather than surfacing it unhandled", async () => {
      // The timer body is fire-and-forget; without the catch this would become
      // an unhandled rejection and could take the process down.
      vi.useFakeTimers();
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValueOnce(null);
      const state = context.syncService["state"];
      state.pendingRetries.clear();

      await context.syncService["executeSyncJob"]("wallet-rejects", 2);
      expect(state.pendingRetries.has("wallet-rejects")).toBe(true);

      // The re-invocation throws from acquireSyncLock (not an authority error,
      // so executeSyncJob rethrows it).
      mockAcquireLock.mockRejectedValueOnce(new Error("redis exploded"));
      await vi.runOnlyPendingTimersAsync();

      // The callback ran (it deletes its own entry before re-invoking) and the
      // rejection was swallowed by the catch rather than escaping the timer.
      expect(state.pendingRetries.has("wallet-rejects")).toBe(false);

      for (const timer of state.pendingRetries.values()) clearTimeout(timer);
      state.pendingRetries.clear();
      vi.useRealTimers();
    });

    it("does not re-arm when a retry is already pending for that wallet", async () => {
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValue(null);
      const state = context.syncService["state"];
      const existing = setTimeout(() => undefined, 60_000);
      state.pendingRetries.set("wallet-armed", existing);

      await context.syncService["executeSyncJob"]("wallet-armed", 1);

      expect(state.pendingRetries.get("wallet-armed")).toBe(existing);
      clearTimeout(existing);
      state.pendingRetries.delete("wallet-armed");
    });

    it("resumes the ladder position an externally triggered sync has no stack for", async () => {
      // retryCount defaults to 0 on every external entry point, which reset the
      // ladder and made the terminal `failed` write unreachable.
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValue(null);
      mockPrismaClient.wallet.findUnique.mockResolvedValueOnce({
        lastSyncStatus: "retrying",
        lastSyncError: "boom",
        syncExecutionOwner: "inline",
        syncRetryCount: 2,
      });
      const state = context.syncService["state"];
      state.pendingRetries.clear();

      await context.syncService["executeSyncJob"]("wallet-resumed");

      // Resumed at 2, so the lock-contention branch re-arms rather than no-ops.
      expect(state.pendingRetries.has("wallet-resumed")).toBe(true);
      clearTimeout(state.pendingRetries.get("wallet-resumed")!);
      state.pendingRetries.delete("wallet-resumed");
    });

    it("survives a failed lookup when resuming the ladder", async () => {
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockResolvedValue(null);
      mockPrismaClient.wallet.findUnique.mockRejectedValueOnce(new Error("db down"));

      const result = await context.syncService["executeSyncJob"]("wallet-lookup-failed");

      expect(result.error).toContain("Already syncing");
    });

    it("releases a wallet whose sync never settles once the duration cap elapses", async () => {
      // A hung Electrum call leaves syncWallet() pending forever. The lock was
      // released only in the finally, which that promise never reaches, so the
      // in-memory activeSyncs entry outlived the Redis lock TTL and every later
      // sync short-circuited on "Already syncing" for the life of the process.
      context.syncService["isRunning"] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });

      let abortReason: unknown;
      mockSyncWallet.mockImplementationOnce(
        (_walletId: unknown, _depth: unknown, signal: unknown) =>
          new Promise((_resolve, reject) => {
            (signal as AbortSignal | undefined)?.addEventListener("abort", () => {
              abortReason = (signal as AbortSignal).reason;
              reject((signal as AbortSignal).reason);
            });
          }),
      );

      const pending = context.syncService.syncNow("wallet-hung");
      // maxSyncDurationMs in the harness config; the cap cancels the sync there.
      await vi.advanceTimersByTimeAsync(120_000);
      await pending;

      expect(abortReason).toBeDefined();
      expect(context.syncService["activeSyncs"].has("wallet-hung")).toBe(false);
      expect(mockReleaseLock).toHaveBeenCalled();
    });

    it("delays and retries once after lock authority recovers", async () => {
      context.syncService["isRunning"] = true;
      mockAcquireLock
        .mockRejectedValueOnce(new LockAuthorityUnavailableError("acquire"))
        .mockRejectedValueOnce(new LockAuthorityUnavailableError("acquire"));

      const first = await context.syncService.syncNow("wallet-authority");
      const duplicate = await context.syncService.syncNow("wallet-authority");

      expect(first.error).toContain("Lock authority unavailable");
      expect(duplicate.error).toContain("Lock authority unavailable");
      expect(context.syncService["pendingRetries"].size).toBe(1);
      expect(mockPrismaClient.wallet.update).not.toHaveBeenCalled();
      expect(mockSyncWallet).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);

      expect(context.syncService["pendingRetries"].size).toBe(0);
      expect(mockSyncWallet).toHaveBeenCalledTimes(1);
      expect(mockPrismaClient.wallet.update).toHaveBeenCalled();
    });

    it("does not run a delayed authority retry after the service stops", async () => {
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockRejectedValueOnce(
        new LockAuthorityUnavailableError("acquire"),
      );

      await context.syncService.syncNow("wallet-stopped-authority");
      context.syncService["isRunning"] = false;
      await vi.advanceTimersByTimeAsync(1000);

      expect(context.syncService["pendingRetries"].size).toBe(0);
      expect(mockSyncWallet).not.toHaveBeenCalled();
    });

    it("propagates unexpected lock acquisition errors", async () => {
      context.syncService["isRunning"] = true;
      mockAcquireLock.mockRejectedValueOnce(new Error("unexpected lock error"));

      await expect(
        context.syncService.syncNow("wallet-lock-error"),
      ).rejects.toThrow("unexpected lock error");

      expect(context.syncService["pendingRetries"].size).toBe(0);
    });

    it("cancels an older pending retry after acquiring authority", async () => {
      context.syncService["isRunning"] = true;
      const pendingTimer = setTimeout(() => {}, 60_000);
      context.syncService["pendingRetries"].set("wallet-recovered", pendingTimer);

      const result = await context.syncService.syncNow("wallet-recovered");

      expect(result.success).toBe(true);
      expect(context.syncService["pendingRetries"].has("wallet-recovered")).toBe(
        false,
      );
    });

    it("returns false when trying to acquire a local lock already held in-memory", async () => {
      context.syncService["activeSyncs"].add("wallet-local");

      const acquired =
        await context.syncService["acquireSyncLock"]("wallet-local");

      expect(acquired).toBe(false);
    });
  });

  describe("retry logic", () => {
    it("should retry on failure", async () => {
      context.syncService["isRunning"] = true;
      vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });
      mockSyncWallet.mockRejectedValueOnce(new Error("Connection failed"));

      const result = await context.syncService.syncNow("wallet-1");

      expect(result.success).toBe(false);
      expect(result.error).toContain("retrying");
      expect(mockPrismaClient.wallet.update).toHaveBeenLastCalledWith({
        where: { id: "wallet-1" },
        data: {
          lastSyncStatus: "retrying",
          lastSyncError: "Connection failed",
          lastSyncFailureClass: "other",
          syncInProgress: false,
          syncExecutionOwner: "inline",
          syncRetryCount: 1,
          syncNextRetryAt: new Date("2026-08-20T12:00:01.000Z"),
          syncStartedAt: null,
        },
      });
    });

    it("persists structured inline ownership when an attempt starts", async () => {
      context.syncService["isRunning"] = true;
      vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });

      await context.syncService.syncNow("wallet-started");

      expect(mockPrismaClient.wallet.update).toHaveBeenNthCalledWith(1, {
        where: { id: "wallet-started" },
        data: {
          syncInProgress: true,
          syncExecutionOwner: "inline",
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: new Date("2026-08-20T12:00:00.000Z"),
        },
      });
    });

    it("clears structured execution state after a successful inline sync", async () => {
      context.syncService["isRunning"] = true;
      vi.setSystemTime(new Date("2026-08-20T12:00:00.000Z"));
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });

      await context.syncService.syncNow("wallet-success");

      expect(mockPrismaClient.wallet.update).toHaveBeenLastCalledWith({
        where: { id: "wallet-success" },
        data: {
          lastSyncedAt: new Date("2026-08-20T12:00:00.000Z"),
          lastSyncStatus: "success",
          lastSyncError: null,
          lastSyncFailureClass: null,
          syncInProgress: false,
          syncExecutionOwner: null,
          syncRetryCount: 0,
          syncNextRetryAt: null,
          syncStartedAt: null,
        },
      });
      expect(mockNotificationService.broadcastSyncStatus).toHaveBeenCalledWith(
        "wallet-success",
        expect.objectContaining({
          status: "success",
          lastSyncedAt: new Date("2026-08-20T12:00:00.000Z"),
        }),
      );
    });

    it("does not retry when the wallet network is disabled in node config", async () => {
      context.syncService["isRunning"] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });

      const { NetworkDisabledError } =
        await import("../../../../src/services/bitcoin/errors");
      mockSyncWallet.mockRejectedValueOnce(new NetworkDisabledError("Testnet"));

      const result = await context.syncService.syncNow(
        "wallet-testnet-disabled",
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Testnet sync is off in Node Configuration",
      );
      expect(context.syncService["pendingRetries"].size).toBe(0);
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "wallet-testnet-disabled" },
          data: expect.objectContaining({
            lastSyncStatus: "failed",
            lastSyncError: expect.stringContaining(
              "Testnet sync is off in Node Configuration",
            ),
            lastSyncFailureClass: "node_rpc_unavailable",
            syncInProgress: false,
            syncExecutionOwner: null,
            syncRetryCount: 0,
            syncNextRetryAt: null,
            syncStartedAt: null,
          }),
        }),
      );
      expect(mockNotificationService.broadcastSyncStatus).toHaveBeenCalledWith(
        "wallet-testnet-disabled",
        expect.objectContaining({
          status: "failed",
          retriesExhausted: true,
        }),
      );
    });

    it("should exhaust retries and fail", async () => {
      context.syncService["isRunning"] = true;

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });
      mockSyncWallet.mockRejectedValue(new Error("Persistent error"));

      // Execute all retry attempts
      await context.syncService["executeSyncJob"]("wallet-1", 3);

      // Should record failure after max retries
      expect(mockPrismaClient.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lastSyncStatus: "failed",
          }),
        }),
      );
    });

    it("runs timeout branch and emits balance updates on changed balance", async () => {
      context.syncService["isRunning"] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate
        .mockResolvedValueOnce({ _sum: { amount: BigInt(1000) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(1500) } })
        .mockResolvedValueOnce({ _sum: { amount: BigInt(0) } });
      mockPopulateMissingTransactionFields.mockResolvedValueOnce({
        updated: 2,
        confirmationUpdates: [],
      });

      let resolveSync:
        | ((value: {
            addresses: number;
            transactions: number;
            utxos: number;
          }) => void)
        | undefined;
      mockSyncWallet.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSync = resolve;
          }),
      );

      const syncPromise = context.syncService.syncNow("wallet-timeout");
      await vi.advanceTimersByTimeAsync(120_000);
      resolveSync?.({ addresses: 1, transactions: 2, utxos: 3 });

      const result = await syncPromise;

      expect(result.success).toBe(true);
      expect(
        mockNotificationService.broadcastBalanceUpdate,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ walletId: "wallet-timeout" }),
      );
    });

    it("handles missing timeout handle when sync resolves quickly", async () => {
      context.syncService["isRunning"] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });
      mockSyncWallet.mockResolvedValueOnce({
        addresses: 1,
        transactions: 1,
        utxos: 1,
      });
      const originalSetTimeout = globalThis.setTimeout;
      Object.defineProperty(globalThis, "setTimeout", {
        configurable: true,
        value: () => undefined,
      });
      const result = await context.syncService.syncNow("wallet-no-timeout-handle").finally(() => {
        Object.defineProperty(globalThis, "setTimeout", {
          configurable: true,
          value: originalSetTimeout,
        });
      });

      expect(result.success).toBe(true);
    });

    it("executes retry timer callback and handles retry errors", async () => {
      context.syncService["isRunning"] = true;
      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });
      mockSyncWallet.mockRejectedValueOnce(new Error("first failure"));

      const originalExecute = Reflect.get(context.syncService, "executeSyncJob");
      if (typeof originalExecute !== "function") {
        throw new Error("executeSyncJob test boundary is unavailable");
      }
      const executeSpy = vi.fn<(walletId: string, retryCount?: number) => Promise<unknown>>();
      executeSpy
        .mockImplementationOnce((walletId: string, retryCount: number = 0) =>
          Reflect.apply(originalExecute, context.syncService, [walletId, retryCount]),
        )
        .mockImplementationOnce(async () => {
          throw new Error("retry callback failed");
        });
      Object.defineProperty(context.syncService, "executeSyncJob", {
        configurable: true,
        value: executeSpy,
      });

      try {
        const result = await context.syncService.syncNow("wallet-retry");
        expect(result.success).toBe(false);
        expect(result.error).toContain("retrying");

        await vi.advanceTimersByTimeAsync(1000);
        expect(context.syncService["pendingRetries"].size).toBe(0);
      } finally {
        Object.defineProperty(context.syncService, "executeSyncJob", {
          configurable: true,
          value: originalExecute,
        });
      }
    });

    it("falls back to last retry delay when configured delay is falsy", async () => {
      context.syncService["isRunning"] = true;
      const configModule = await import("../../../../src/config");
      const configSpy = vi.spyOn(configModule, "getConfig").mockReturnValue({
        sync: {
          intervalMs: 60000,
          confirmationUpdateIntervalMs: 30000,
          staleThresholdMs: 300000,
          maxConcurrentSyncs: 5,
          maxRetryAttempts: 3,
          retryDelaysMs: [0, 2500],
          maxSyncDurationMs: 120000,
          transactionBatchSize: 100,
          electrumSubscriptionsEnabled: true,
        },
        bitcoin: { network: "testnet" },
      } as any);

      mockPrismaClient.wallet.update.mockResolvedValue({});
      mockPrismaClient.uTXO.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(0) },
      });
      mockSyncWallet.mockRejectedValueOnce(new Error("retry delay fallback"));

      const result = await context.syncService.syncNow("wallet-retry-delay");
      configSpy.mockRestore();

      expect(result.success).toBe(false);
      expect(mockNotificationService.broadcastSyncStatus).toHaveBeenCalledWith(
        "wallet-retry-delay",
        expect.objectContaining({
          status: "retrying",
          retryingIn: 2500,
        }),
      );
    });
  });

  describe("concurrent sync limiting", () => {
    it("should limit concurrent syncs", async () => {
      context.syncService["isRunning"] = true;

      // Simulate 5 active syncs (maxConcurrentSyncs is 5)
      context.syncService["activeSyncs"].add("wallet-1");
      context.syncService["activeSyncs"].add("wallet-2");
      context.syncService["activeSyncs"].add("wallet-3");
      context.syncService["activeSyncs"].add("wallet-4");
      context.syncService["activeSyncs"].add("wallet-5");

      // Add more to queue
      context.syncService.queueSync("wallet-6");
      context.syncService.queueSync("wallet-7");

      // Queue should have wallets waiting
      expect(context.syncService["syncQueue"].length).toBe(2);

      // processQueue should not start new syncs when at limit
      await context.syncService["processQueue"]();

      // Still should have wallets in queue (not started)
      // Note: processQueue doesn't actually start them if at limit
    });

    it("handles executeSyncJob rejection from queued processing", async () => {
      context.syncService["isRunning"] = true;
      context.syncService["syncQueue"] = [
        {
          walletId: "wallet-fail",
          priority: "normal",
          requestedAt: new Date(),
        },
      ];
      vi.spyOn(
        context.syncService as any,
        "executeSyncJob",
      ).mockRejectedValueOnce(new Error("queue worker failed"));

      await context.syncService["processQueue"]();
      await Promise.resolve();
      await Promise.resolve();

      expect(context.syncService["syncQueue"]).toHaveLength(0);
    });

    it("breaks queue processing when shifted job is undefined", async () => {
      context.syncService["isRunning"] = true;
      context.syncService["syncQueue"] = [undefined as any];
      const executeSpy = vi.spyOn(context.syncService as any, "executeSyncJob");

      await context.syncService["processQueue"]();

      expect(executeSpy).not.toHaveBeenCalled();
    });
  });

  describe("health metrics", () => {
    it("should return health metrics", async () => {
      context.syncService["isRunning"] = true;
      context.syncService["syncQueue"] = [
        { walletId: "w1", priority: "normal", requestedAt: new Date() },
      ];
      context.syncService["activeSyncs"].add("w2");
      context.syncService["addressToWalletMap"].set("addr1", "w1");

      const metrics = context.syncService.getHealthMetrics();

      expect(metrics.isRunning).toBe(true);
      expect(metrics.queueLength).toBe(1);
      expect(metrics.activeSyncs).toBe(1);
      expect(metrics.subscribedAddresses).toBe(1);
    });

    it("should include pollingMode in health metrics", () => {
      context.syncService["isRunning"] = true;

      const metrics = context.syncService.getHealthMetrics();

      expect(metrics.pollingMode).toBe("in-process");
    });
  });

  describe("polling mode", () => {
    it("should start in-process polling when worker is unhealthy", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });

      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).not.toBeNull();
      expect(context.syncService["confirmationInterval"]).not.toBeNull();
    });

    it("should defer polling to worker when worker is healthy", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();
    });

    it("should always start reconciliation interval regardless of worker health", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService["reconciliationInterval"]).not.toBeNull();
    });

    it("should always start workerHealthPollTimer", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });

      await context.syncService.start();

      expect(context.syncService["workerHealthPollTimer"]).not.toBeNull();
    });

    it("should transition from worker-delegated to in-process when worker goes down", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );

      // Worker goes down
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).not.toBeNull();
      expect(context.syncService["confirmationInterval"]).not.toBeNull();
    });

    it("should transition from in-process to worker-delegated when worker recovers", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );

      // Worker recovers
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();
    });

    it("should not double-start polling intervals", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      const firstSyncInterval = context.syncService["syncInterval"];
      const firstConfirmInterval = context.syncService["confirmationInterval"];

      // Call startPollingIntervals again — should be a no-op
      context.syncService["startPollingIntervals"]();

      expect(context.syncService["syncInterval"]).toBe(firstSyncInterval);
      expect(context.syncService["confirmationInterval"]).toBe(
        firstConfirmInterval,
      );
    });

    it("should not evaluate polling mode when service is stopped", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();
      await context.syncService.stop();

      // Worker recovers while service is stopped
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService["evaluatePollingMode"]();

      // Should remain unchanged since isRunning is false
      expect(context.syncService["syncInterval"]).toBeNull();
    });

    it("should be no-op when worker stays healthy (already delegated)", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      // Evaluate again with same state
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
    });

    it("should be no-op when worker stays unhealthy (already in-process)", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await context.syncService.start();

      const firstSyncInterval = context.syncService["syncInterval"];

      // Evaluate again with same state
      context.syncService["evaluatePollingMode"]();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).toBe(firstSyncInterval);
    });

    it("should clear workerHealthPollTimer on stop", async () => {
      await context.syncService.start();

      expect(context.syncService["workerHealthPollTimer"]).not.toBeNull();

      await context.syncService.stop();

      expect(context.syncService["workerHealthPollTimer"]).toBeNull();
    });

    it("should trigger evaluatePollingMode via the 30s timer", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );

      // Worker goes down — advance the 30s timer
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
    });

    it("should handle full round-trip: healthy → unhealthy → healthy via timer", async () => {
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      // Phase 1: worker-delegated, no polling intervals
      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();

      // Phase 2: worker goes down — timer fires, transitions to in-process
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "in-process",
      );
      expect(context.syncService["syncInterval"]).not.toBeNull();
      expect(context.syncService["confirmationInterval"]).not.toBeNull();
      const syncIntervalRef = context.syncService["syncInterval"];

      // Phase 3: worker recovers — timer fires, transitions back to worker-delegated
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await vi.advanceTimersByTimeAsync(30_000);

      expect(context.syncService.getHealthMetrics().pollingMode).toBe(
        "worker-delegated",
      );
      expect(context.syncService["syncInterval"]).toBeNull();
      expect(context.syncService["confirmationInterval"]).toBeNull();

      // Verify the old interval reference was cleared (not leaked)
      expect(context.syncService["syncInterval"]).not.toBe(syncIntervalRef);
    });

    it("should increment transition metric on mode change", async () => {
      const { syncPollingModeTransitions } =
        await import("../../../../src/observability/metrics");
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      await context.syncService.start();

      // Transition: worker-delegated → in-process
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: false });
      context.syncService["evaluatePollingMode"]();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: "worker-delegated",
        to: "in-process",
      });

      // Transition: in-process → worker-delegated
      mockGetWorkerHealthStatus.mockReturnValue({ healthy: true });
      context.syncService["evaluatePollingMode"]();

      expect(syncPollingModeTransitions.inc).toHaveBeenCalledWith({
        from: "in-process",
        to: "worker-delegated",
      });
    });
  });
}
