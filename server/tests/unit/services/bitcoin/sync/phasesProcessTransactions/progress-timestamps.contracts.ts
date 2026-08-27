import { expect, it, vi } from "vitest";
import type { SyncProgressDetails } from "@sanctuary/shared/schemas/syncProgress";
import "./processTransactionsTestHarness";
import {
  mockElectrumClient,
  createMockTransaction,
} from "../../../../../mocks/electrum";
import { mockPrismaClient } from "../../../../../mocks/prisma";
import {
  createTestContext,
  processTransactionsPhase,
} from "../../../../../../src/services/bitcoin/sync";
import { getBlockTimestamp } from "../../../../../../src/services/bitcoin/utils/blockHeight";
import { walletLog } from "../../../../../../src/websocket/notifications";
import { withWalletSyncMutationFence } from "../../../../../../src/repositories/syncIntentRepository";
import {
  prefetchTransactionBlockTimestamps,
  resolveTransactionBlockTime,
} from "../../../../../../src/services/bitcoin/sync/phases/processTransactions/timestampPrefetch";
import { createCandidateBatchProgress } from "../../../../../../src/services/bitcoin/sync/phases/processTransactions/progress";
import { fetchAuthenticatedTransactions } from "../../../../../../src/services/bitcoin/sync/evidenceAuthentication";
import { SyncAttemptTimeoutError } from "../../../../../../src/services/sync/syncAttemptErrors";

const detailsFromLogs = (): SyncProgressDetails[] =>
  vi
    .mocked(walletLog)
    .mock.calls.map((call) => call[4])
    .filter(
      (details) => details?.kind === "sync_progress",
    ) as SyncProgressDetails[];

export function registerProcessTransactionProgressTimestampTests(
  walletId: string,
): void {
  it("normalizes non-finite reporter inputs without emitting an invalid contract", () => {
    const progress = createCandidateBatchProgress(
      walletId,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      () => Number.POSITIVE_INFINITY,
    );

    progress.start("candidate_fetch", "transactions", "Starting normalized batch.");

    expect(detailsFromLogs()).toEqual([
      expect.objectContaining({ batch: 1, batchCount: 1, elapsedMs: 0 }),
    ]);
  });

  it("retains direct timestamp lookup compatibility when no prefetched map is supplied", async () => {
    const timestamp = new Date("2024-01-15T12:00:00Z");
    vi.mocked(getBlockTimestamp).mockResolvedValueOnce(timestamp);

    await expect(resolveTransactionBlockTime(
      { txid: "direct_timestamp".padEnd(64, "a"), vin: [], vout: [] },
      800000,
      "signet",
    )).resolves.toBe(timestamp);

    expect(getBlockTimestamp).toHaveBeenCalledWith(800000, "signet", undefined);
  });

  it("prefetches each unique missing timestamp height once with bounded concurrency and ctx.network", async () => {
    const walletAddress = "tb1q_timestamp_wallet";
    const txids = Array.from({ length: 6 }, (_, index) =>
      `timestamp_${index}`.padEnd(64, "a"),
    );
    const heights = [800000, 800000, 800001, 800002, 800003, 800004];
    const transactions = new Map(
      txids.map((txid) => [
        txid,
        createMockTransaction({
          txid,
          coinbase: true,
          outputs: [{ value: 0.001, address: walletAddress }],
        }),
      ]),
    );
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(transactions);
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(getBlockTimestamp).mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      if (active === 4) release();
      await barrier;
      active -= 1;
      return new Date("2024-01-15T12:00:00Z");
    });
    const ctx = createTestContext({
      walletId,
      network: "testnet3",
      client: mockElectrumClient as any,
      newTxids: txids,
      historyResults: new Map([
        [
          walletAddress,
          txids.map((tx_hash, index) => ({
            tx_hash,
            height: heights[index],
          })),
        ],
      ]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([
        [
          walletAddress,
          { id: "timestamp-address", address: walletAddress } as any,
        ],
      ]),
      txDetailsCache: new Map() as any,
      currentBlockHeight: 800100,
      attemptRuntime: {
        signal: new AbortController().signal,
        deadlineAt: Date.now() + 5_000,
      },
    });

    await processTransactionsPhase(ctx);

    expect(peak).toBe(4);
    expect(getBlockTimestamp).toHaveBeenCalledTimes(5);
    expect(
      vi.mocked(getBlockTimestamp).mock.calls.map((call) => call.slice(0, 2)),
    ).toEqual([
      [800000, "testnet3"],
      [800001, "testnet3"],
      [800002, "testnet3"],
      [800003, "testnet3"],
      [800004, "testnet3"],
    ]);
  });

  it("skips non-positive heights and transactions that already carry time", async () => {
    const walletAddress = "tb1q_timestamp_skip";
    const timed = "timestamp_timed".padEnd(64, "b");
    const pending = "timestamp_pending".padEnd(64, "c");
    const transactions = new Map([
      [
        timed,
        {
          ...createMockTransaction({
            txid: timed,
            coinbase: true,
            outputs: [{ value: 1, address: walletAddress }],
          }),
          time: 1_700_000_000,
        },
      ],
      [
        pending,
        createMockTransaction({
          txid: pending,
          coinbase: true,
          outputs: [{ value: 1, address: walletAddress }],
        }),
      ],
    ]);
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(transactions);
    const ctx = createTestContext({
      walletId,
      client: mockElectrumClient as any,
      newTxids: [timed, pending],
      historyResults: new Map([
        [
          walletAddress,
          [
            { tx_hash: timed, height: 800000 },
            { tx_hash: pending, height: 0 },
          ],
        ],
      ]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([
        [
          walletAddress,
          { id: "timestamp-skip-address", address: walletAddress } as any,
        ],
      ]),
      txDetailsCache: new Map() as any,
    });

    await processTransactionsPhase(ctx);

    expect(getBlockTimestamp).not.toHaveBeenCalled();
  });

  it("emits fixed stage order and waits for the fenced batch mutation before durable completion", async () => {
    const txid = "progress_fenced".padEnd(64, "d");
    const walletAddress = "tb1q_progress_fenced";
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(
      new Map([
        [
          txid,
          {
            ...createMockTransaction({
              txid,
              coinbase: true,
              outputs: [{ value: 1, address: walletAddress }],
            }),
            time: 1_700_000_000,
          },
        ],
      ]),
    );
    let settle!: () => void;
    const mutationBarrier = new Promise<void>((resolve) => {
      settle = resolve;
    });
    let mutationCalls = 0;
    vi.mocked(withWalletSyncMutationFence).mockImplementation(
      async (_fence, callback) => {
        const result = await callback(mockPrismaClient as never);
        mutationCalls += 1;
        if (mutationCalls === 2) await mutationBarrier;
        return result;
      },
    );
    const ctx = createTestContext({
      walletId,
      client: mockElectrumClient as any,
      newTxids: [txid],
      historyResults: new Map([
        [walletAddress, [{ tx_hash: txid, height: 800000 }]],
      ]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([
        [
          walletAddress,
          { id: "progress-address", address: walletAddress } as any,
        ],
      ]),
      txDetailsCache: new Map() as any,
      mutationFence: { walletId, generation: 1, leaseToken: "lease" },
    });

    const pending = processTransactionsPhase(ctx);
    await vi.waitFor(() =>
      expect(detailsFromLogs().map((details) => details.event)).toContain(
        "stage_started",
      ),
    );
    expect(
      detailsFromLogs().some((details) => details.event === "batch_completed"),
    ).toBe(false);
    settle();
    await pending;

    const details = detailsFromLogs();
    expect(details.map((entry) => `${entry.event}:${entry.stage}`)).toEqual([
      "stage_started:candidate_fetch",
      "stage_started:parent_fetch",
      "stage_started:timestamp_fetch",
      "stage_started:classification",
      "stage_started:persistence",
      "batch_completed:persistence",
    ]);
    expect(details.at(-1)).toEqual(
      expect.objectContaining({
        batch: 1,
        batchCount: 1,
        completed: 1,
        total: 1,
      }),
    );
  });

  it("persists a null block time when timestamp header lookup fails", async () => {
    const txid = "timestamp_null".padEnd(64, "e");
    const walletAddress = "tb1q_timestamp_null";
    mockElectrumClient.getTransactionsBatch.mockResolvedValue(
      new Map([
        [
          txid,
          createMockTransaction({
            txid,
            coinbase: true,
            outputs: [{ value: 1, address: walletAddress }],
          }),
        ],
      ]),
    );
    vi.mocked(getBlockTimestamp).mockResolvedValueOnce(null);
    const ctx = createTestContext({
      walletId,
      client: mockElectrumClient as any,
      newTxids: [txid],
      historyResults: new Map([
        [walletAddress, [{ tx_hash: txid, height: 800000 }]],
      ]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([
        [
          walletAddress,
          { id: "timestamp-null-address", address: walletAddress } as any,
        ],
      ]),
      txDetailsCache: new Map() as any,
    });

    await processTransactionsPhase(ctx);

    expect(
      mockPrismaClient.transaction.createManyAndReturn,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ txid, blockTime: null })],
      }),
    );
  });

  it("stops the bounded timestamp workers on outer abort without launching another height", async () => {
    const controller = new AbortController();
    const txids = Array.from({ length: 6 }, (_, index) =>
      `abort_height_${index}`.padEnd(64, "f"),
    );
    const ctx = createTestContext({
      walletId,
      network: "regtest",
      historyResults: new Map([
        [
          "address",
          txids.map((tx_hash, index) => ({
            tx_hash,
            height: 100 + index,
          })),
        ],
      ]),
      txDetailsCache: new Map(
        txids.map((txid) => [txid, { vin: [], vout: [] }]),
      ) as any,
    });
    vi.mocked(getBlockTimestamp).mockImplementation(
      async (_height, _network, options) =>
        new Promise<Date | null>((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );

    const pending = prefetchTransactionBlockTimestamps(ctx, new Set(txids), {
      signal: controller.signal,
      deadlineAt: Date.now() + 5_000,
    });
    await vi.waitFor(() => expect(getBlockTimestamp).toHaveBeenCalledTimes(4));
    controller.abort(new Error("outer abort"));

    await expect(pending).rejects.toThrow("outer abort");
    expect(getBlockTimestamp).toHaveBeenCalledTimes(4);
  });

  it("reports final partial ranges and keeps 100-candidate progress under its fixed bound", async () => {
    const walletAddress = "tb1q_progress_batches";
    const txids = Array.from({ length: 100 }, (_, index) =>
      `progress_batch_${index}`.padEnd(64, "a"),
    );
    mockElectrumClient.getTransactionsBatch.mockImplementation(
      async (requested: string[]) =>
        new Map(
          requested.map((txid) => [
            txid,
            {
              ...createMockTransaction({
                txid,
                coinbase: true,
                outputs: [{ value: 1, address: walletAddress }],
              }),
              time: 1_700_000_000,
            },
          ]),
        ),
    );
    const ctx = createTestContext({
      walletId,
      client: mockElectrumClient as any,
      newTxids: txids,
      historyResults: new Map([
        [walletAddress, txids.map((tx_hash) => ({ tx_hash, height: 800000 }))],
      ]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([
        [
          walletAddress,
          { id: "progress-batches-address", address: walletAddress } as any,
        ],
      ]),
      txDetailsCache: new Map() as any,
    });

    await processTransactionsPhase(ctx);

    const details = detailsFromLogs();
    expect(
      details.filter((entry) => entry.event === "batch_completed"),
    ).toHaveLength(4);
    expect(details).toHaveLength(24);
    expect(details.length).toBeLessThanOrEqual((5 + 2) * 4 + 1);
    expect(details.at(-1)).toEqual(
      expect.objectContaining({ completed: 100, total: 100 }),
    );

    vi.clearAllMocks();
    const partialTxids = txids.slice(0, 26);
    mockElectrumClient.getTransactionsBatch.mockImplementation(
      async (requested: string[]) =>
        new Map(
          requested.map((txid) => [
            txid,
            {
              ...createMockTransaction({
                txid,
                coinbase: true,
                outputs: [{ value: 1, address: walletAddress }],
              }),
              time: 1_700_000_000,
            },
          ]),
        ),
    );
    await processTransactionsPhase(
      createTestContext({
        walletId,
        client: mockElectrumClient as any,
        newTxids: partialTxids,
        historyResults: new Map([
          [
            walletAddress,
            partialTxids.map((tx_hash) => ({ tx_hash, height: 800000 })),
          ],
        ]),
        walletAddressSet: new Set([walletAddress]),
        addressMap: new Map([
          [
            walletAddress,
            { id: "progress-partial-address", address: walletAddress } as any,
          ],
        ]),
        txDetailsCache: new Map() as any,
      }),
    );
    expect(vi.mocked(walletLog).mock.calls.map((call) => call[3])).toContain(
      "Fetching transactions 26-26 of 26...",
    );
  });

  it("emits one structured fallback summary for a budget-expired batch", async () => {
    const txid = "progress_fallback".padEnd(64, "a");
    const walletAddress = "tb1q_progress_fallback";
    const telemetry = {
      observeProgress: vi.fn(),
      recordCandidates: vi.fn(),
    };
    const ctx = createTestContext({
      walletId,
      client: mockElectrumClient as any,
      newTxids: [txid],
      historyResults: new Map([
        [walletAddress, [{ tx_hash: txid, height: 800000 }]],
      ]),
      walletAddressSet: new Set([walletAddress]),
      addressMap: new Map([
        [
          walletAddress,
          { id: "progress-fallback-address", address: walletAddress } as any,
        ],
      ]),
      txDetailsCache: new Map([
        [
          txid,
          {
            ...createMockTransaction({
              txid,
              coinbase: true,
              outputs: [{ value: 1, address: walletAddress }],
            }),
            time: 1_700_000_000,
          },
        ],
      ]) as any,
      attemptRuntime: {
        signal: new AbortController().signal,
        deadlineAt: Date.now(),
        telemetry,
      },
    });

    await processTransactionsPhase(ctx);

    expect(
      detailsFromLogs().filter((entry) => entry.event === "fallback"),
    ).toEqual([
      expect.objectContaining({
        stage: "candidate_fetch",
        batch: 1,
        batchCount: 1,
      }),
    ]);
    expect(telemetry.recordCandidates).toHaveBeenCalledOnce();
    expect(telemetry.recordCandidates).toHaveBeenCalledWith(1, 0);
    expect(getBlockTimestamp).not.toHaveBeenCalled();
  });

  it.each([
    ["aborted", new Error("operator cancelled")],
    ["timeout", new SyncAttemptTimeoutError(1_000)],
  ] as const)(
    "emits one explicit %s terminal event without swallowing the abort",
    async (event, reason) => {
      const controller = new AbortController();
      const txid = `progress_${event}`.padEnd(64, "b");
      vi.mocked(fetchAuthenticatedTransactions).mockImplementationOnce(
        async (_ctx, _txids, options) =>
          new Promise<Set<string>>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(options.signal?.reason),
              { once: true },
            );
          }),
      );
      const pending = processTransactionsPhase(
        createTestContext({
          walletId,
          client: mockElectrumClient as any,
          newTxids: [txid],
          historyResults: new Map(),
          txDetailsCache: new Map() as any,
          attemptRuntime: {
            signal: controller.signal,
            deadlineAt: Date.now() + 5_000,
          },
        }),
      );
      await vi.waitFor(() => expect(detailsFromLogs()).toHaveLength(1));
      controller.abort(reason);

      await expect(pending).rejects.toBe(reason);
      expect(
        detailsFromLogs().filter((entry) => entry.event === event),
      ).toEqual([
        expect.objectContaining({
          stage: "candidate_fetch",
          batch: 1,
          batchCount: 1,
        }),
      ]);
    },
  );
}
