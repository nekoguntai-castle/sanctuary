import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "job-1" }),
  mockQueueAddBulk: vi
    .fn()
    .mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]),
  mockQueueGetJob: vi.fn(),
  mockQueueGetDeduplicationJobId: vi.fn(),
  mockReserveFullResyncGeneration: vi.fn(),
  mockQueueClose: vi.fn().mockResolvedValue(undefined),
  mockGetRedisClient: vi.fn(),
  mockIsRedisConnected: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: mocks.mockQueueAdd,
      addBulk: mocks.mockQueueAddBulk,
      getJob: mocks.mockQueueGetJob,
      getDeduplicationJobId: mocks.mockQueueGetDeduplicationJobId,
      close: mocks.mockQueueClose,
    };
  }),
}));

vi.mock("../../../src/infrastructure", () => ({
  getRedisClient: mocks.mockGetRedisClient,
  isRedisConnected: mocks.mockIsRedisConnected,
}));

vi.mock("../../../src/repositories/resyncRepository", () => ({
  reserveFullResyncGeneration: mocks.mockReserveFullResyncGeneration,
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  closeWorkerSyncQueue,
  enqueueDeadLetterJob,
  enqueueFullResyncBatch,
  enqueueWalletSync,
  enqueueWalletSyncBatch,
} from "../../../src/services/workerSyncQueue";
import { toBullMqJobId } from "../../../src/jobs/bullMqJobIds";
import { SYNC_PRIORITY_BULLMQ_PRIORITY } from "@sanctuary/shared/constants/sync";
import { SYNC_WALLET_JOB_OPTIONS } from "../../../src/worker/jobs/jobOptions";
import type { DeadLetterJobEnvelope } from "../../../src/services/deadLetterQueueTypes";
import { FULL_RESYNC_GENERATION_MAX } from "../../../src/constants/fullResync";

function syncDeadLetterEnvelope(): DeadLetterJobEnvelope {
  return {
    version: 1,
    queue: "sync",
    name: "sync-wallet",
    jobId: "original-job",
    data: { walletId: "wallet-1", reason: "retry" },
    options: {},
    exhaustedAttempt: 3,
  };
}

describe("workerSyncQueue", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.mockQueueAdd.mockImplementation(async (_name, data, options) => ({
      id: options?.jobId ?? "job-1",
      data,
    }));
    mocks.mockQueueGetJob.mockResolvedValue(null);
    mocks.mockQueueGetDeduplicationJobId.mockResolvedValue(null);
    mocks.mockReserveFullResyncGeneration.mockResolvedValue(1);
    mocks.mockGetRedisClient.mockReturnValue({
      options: { host: "localhost", port: 6379, db: 0 },
    });
    mocks.mockIsRedisConnected.mockReturnValue(true);
    await closeWorkerSyncQueue();
  });

  it("encodes explicit sync job IDs before adding a single wallet job", async () => {
    const queued = await enqueueWalletSync("wallet-1", {
      priority: "high",
      reason: "manual",
      delayMs: 250,
      jobId: "manual-sync:wallet-1",
    });

    expect(queued).toBe(true);
    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "sync-wallet",
      { walletId: "wallet-1", priority: "high", reason: "manual" },
      {
        ...SYNC_WALLET_JOB_OPTIONS,
        priority: SYNC_PRIORITY_BULLMQ_PRIORITY.high,
        delay: 250,
        jobId: toBullMqJobId("manual-sync:wallet-1"),
      },
    );
  });

  it("queues deduplicated full-resync intentions with per-wallet outcomes", async () => {
    mocks.mockQueueAdd
      .mockImplementationOnce(async (_name, data, options) => ({
        id: options?.jobId,
        data,
      }))
      .mockRejectedValueOnce(new Error("queue rejected"));

    await expect(enqueueFullResyncBatch(
      ["wallet-1", "wallet-2"],
      { reason: "manual-resync", staggerDelayMs: 25 },
    )).resolves.toEqual({
      outcomes: [
        { walletId: "wallet-1", status: "accepted" },
        { walletId: "wallet-2", status: "rejected", reason: "queue_error" },
      ],
      acceptedWalletIds: ["wallet-1"],
      deduplicatedWalletIds: [],
      rejectedWallets: [{ walletId: "wallet-2", reason: "queue_error" }],
      indeterminateWallets: [],
    });

    expect(mocks.mockQueueAdd).toHaveBeenNthCalledWith(
      1,
      "sync-wallet",
      {
        walletId: "wallet-1",
        priority: "high",
        reason: "manual-resync",
        fullResync: true,
        fullResyncGeneration: 1,
      },
      expect.objectContaining({
        delay: 0,
        jobId: expect.any(String),
        deduplication: {
          id: toBullMqJobId("full-resync:wallet-1"),
          keepLastIfActive: true,
        },
      }),
    );
    expect(mocks.mockQueueAdd).toHaveBeenNthCalledWith(
      2,
      "sync-wallet",
      expect.objectContaining({ walletId: "wallet-2", fullResync: true }),
      expect.objectContaining({ delay: 25 }),
    );
  });

  it("distinguishes an existing intention from BullMQ's returned retained ID", async () => {
    mocks.mockQueueAdd.mockImplementationOnce(async (_name, data) => ({
      id: "existing-job",
      // BullMQ retains the candidate data on the returned Job instance even
      // when its add script returns the existing deduplicated job ID.
      data,
    }));

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.acceptedWalletIds).toEqual([]);
    expect(result.deduplicatedWalletIds).toEqual(["wallet-1"]);
    expect(result.outcomes).toEqual([
      { walletId: "wallet-1", status: "deduplicated" },
    ]);
  });

  it("submits a generation-bearing successor when the retained job is active", async () => {
    mocks.mockReserveFullResyncGeneration.mockResolvedValueOnce(2);
    mocks.mockQueueAdd.mockImplementationOnce(async () => ({
      // BullMQ returns active A while keepLastIfActive stores candidate B.
      id: "full-resync-attempt-wallet-1-1",
    }));

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([
      { walletId: "wallet-1", status: "deduplicated" },
    ]);
    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "sync-wallet",
      expect.objectContaining({
        walletId: "wallet-1",
        fullResync: true,
        fullResyncGeneration: 2,
      }),
      expect.objectContaining({
        jobId: toBullMqJobId("full-resync-attempt:wallet-1:2"),
        deduplication: {
          id: toBullMqJobId("full-resync:wallet-1"),
          keepLastIfActive: true,
        },
      }),
    );
  });

  it("reconciles a committed candidate after Queue.add loses its response", async () => {
    mocks.mockQueueAdd.mockRejectedValueOnce(new Error("connection reset"));
    mocks.mockQueueGetJob.mockResolvedValueOnce({ id: "candidate" });

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([{ walletId: "wallet-1", status: "accepted" }]);
    expect(result.acceptedWalletIds).toEqual(["wallet-1"]);
    expect(result.rejectedWallets).toEqual([]);
    expect(result.indeterminateWallets).toEqual([]);
    const candidateJobId = mocks.mockQueueAdd.mock.calls[0][2].jobId;
    expect(mocks.mockQueueGetJob).toHaveBeenCalledWith(candidateJobId);
    expect(mocks.mockQueueGetDeduplicationJobId).toHaveBeenCalledWith(
      toBullMqJobId("full-resync:wallet-1"),
    );
  });

  it("reconciles a committed retained target after Queue.add loses its response", async () => {
    mocks.mockQueueAdd.mockRejectedValueOnce(new Error("connection reset"));
    mocks.mockQueueGetDeduplicationJobId.mockResolvedValueOnce("existing-job");
    mocks.mockQueueGetJob.mockImplementation(async jobId => (
      jobId === "existing-job"
        ? { getState: vi.fn().mockResolvedValue("waiting") }
        : null
    ));

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([{ walletId: "wallet-1", status: "deduplicated" }]);
    expect(result.deduplicatedWalletIds).toEqual(["wallet-1"]);
  });

  it("keeps a precommit enqueue failure indeterminate when the target is active", async () => {
    mocks.mockQueueAdd.mockRejectedValueOnce(new Error("connection reset"));
    mocks.mockQueueGetDeduplicationJobId.mockResolvedValueOnce("active-job");
    mocks.mockQueueGetJob.mockImplementation(async jobId => (
      jobId === "active-job"
        ? { getState: vi.fn().mockResolvedValue("active") }
        : null
    ));

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([{
      walletId: "wallet-1",
      status: "indeterminate",
      reason: "queue_state_unknown",
    }]);
    expect(result.acceptedWalletIds).toEqual([]);
    expect(result.deduplicatedWalletIds).toEqual([]);
    expect(result.indeterminateWallets).toEqual([{
      walletId: "wallet-1",
      reason: "queue_state_unknown",
    }]);
  });

  it("reports indeterminate state when enqueue reconciliation remains unreachable", async () => {
    mocks.mockQueueAdd.mockRejectedValueOnce(new Error("connection reset"));
    mocks.mockQueueGetJob.mockRejectedValueOnce(new Error("redis unavailable"));
    mocks.mockQueueGetDeduplicationJobId.mockRejectedValueOnce(new Error("redis unavailable"));

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([{
      walletId: "wallet-1",
      status: "indeterminate",
      reason: "queue_state_unknown",
    }]);
    expect(result.rejectedWallets).toEqual([]);
    expect(result.indeterminateWallets).toEqual([{
      walletId: "wallet-1",
      reason: "queue_state_unknown",
    }]);
    expect(mocks.mockQueueGetJob).toHaveBeenCalledTimes(1);
    expect(mocks.mockQueueGetDeduplicationJobId).toHaveBeenCalledTimes(1);
  });

  it("keeps incomplete retained-target evidence indeterminate", async () => {
    mocks.mockQueueAdd.mockRejectedValue(new Error("connection reset"));
    mocks.mockQueueGetDeduplicationJobId.mockImplementation(async deduplicationId => {
      const walletId = String(deduplicationId).match(/wallet-(\d)/)?.[0];
      if (walletId === "wallet-1") throw new Error("deduplication lookup failed");
      if (walletId === "wallet-2") {
        return toBullMqJobId("full-resync-attempt:wallet-2:1");
      }
      if (walletId === "wallet-3") return "missing-job";
      if (walletId === "wallet-4") return "unavailable-job";
      return "state-error-job";
    });
    mocks.mockQueueGetJob.mockImplementation(async jobId => {
      if (jobId === "unavailable-job") throw new Error("job lookup failed");
      if (jobId === "state-error-job") {
        return { getState: vi.fn().mockRejectedValue(new Error("state lookup failed")) };
      }
      return null;
    });

    const result = await enqueueFullResyncBatch(
      ["wallet-1", "wallet-2", "wallet-3", "wallet-4", "wallet-5"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([
      "wallet-1",
      "wallet-2",
      "wallet-3",
      "wallet-4",
      "wallet-5",
    ].map(walletId => ({
      walletId,
      status: "indeterminate",
      reason: "queue_state_unknown",
    })));
  });

  it("rejects without enqueueing when generation reservation fails", async () => {
    mocks.mockReserveFullResyncGeneration.mockRejectedValueOnce(new Error("database unavailable"));

    const result = await enqueueFullResyncBatch(
      ["wallet-1"],
      { reason: "manual-resync" },
    );

    expect(result.outcomes).toEqual([{
      walletId: "wallet-1",
      status: "rejected",
      reason: "queue_error",
    }]);
    expect(mocks.mockQueueAdd).not.toHaveBeenCalled();
  });

  it("encodes batch sync job IDs under BullMQ bulk opts", async () => {
    vi.spyOn(Date, "now").mockReturnValue(12345);

    const count = await enqueueWalletSyncBatch(["wallet-1", "wallet-2"], {
      priority: "low",
      reason: "manual-network-sync",
      staggerDelayMs: 100,
      jobIdPrefix: "manual-network-sync:mainnet:user-1",
    });

    expect(count).toBe(2);
    expect(mocks.mockQueueAddBulk).toHaveBeenCalledWith([
      {
        name: "sync-wallet",
        data: {
          walletId: "wallet-1",
          priority: "low",
          reason: "manual-network-sync",
        },
        opts: {
          ...SYNC_WALLET_JOB_OPTIONS,
          priority: SYNC_PRIORITY_BULLMQ_PRIORITY.low,
          delay: 0,
          jobId: toBullMqJobId(
            "manual-network-sync:mainnet:user-1:12345:wallet-1",
          ),
        },
      },
      {
        name: "sync-wallet",
        data: {
          walletId: "wallet-2",
          priority: "low",
          reason: "manual-network-sync",
        },
        opts: {
          ...SYNC_WALLET_JOB_OPTIONS,
          priority: SYNC_PRIORITY_BULLMQ_PRIORITY.low,
          delay: 100,
          jobId: toBullMqJobId(
            "manual-network-sync:mainnet:user-1:12345:wallet-2",
          ),
        },
      },
    ]);
  });

  it("returns false or zero when Redis is unavailable", async () => {
    mocks.mockIsRedisConnected.mockReturnValue(false);

    await expect(enqueueWalletSync("wallet-1")).resolves.toBe(false);
    await expect(enqueueWalletSyncBatch(["wallet-1"])).resolves.toBe(0);
    await expect(
      enqueueDeadLetterJob(syncDeadLetterEnvelope(), "entry-1"),
    ).resolves.toBe(false);
    await expect(
      enqueueFullResyncBatch(["wallet-1"], { reason: "manual-resync" }),
    ).resolves.toEqual({
      outcomes: [{
        walletId: "wallet-1",
        status: "rejected",
        reason: "queue_unavailable",
      }],
      acceptedWalletIds: [],
      deduplicatedWalletIds: [],
      rejectedWallets: [{
        walletId: "wallet-1",
        reason: "queue_unavailable",
      }],
      indeterminateWallets: [],
    });
    expect(mocks.mockQueueAdd).not.toHaveBeenCalled();
    expect(mocks.mockQueueAddBulk).not.toHaveBeenCalled();
  });

  it("uses the canonical normal priority when no priority is provided", async () => {
    const queued = await enqueueWalletSync("wallet-1");

    expect(queued).toBe(true);
    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "sync-wallet",
      { walletId: "wallet-1", priority: "normal", reason: undefined },
      {
        ...SYNC_WALLET_JOB_OPTIONS,
        priority: SYNC_PRIORITY_BULLMQ_PRIORITY.normal,
        delay: undefined,
        jobId: undefined,
      },
    );
  });

  it("awaits a validated dead-letter sync retry with stable producer overrides", async () => {
    const queued = await enqueueDeadLetterJob(
      {
        ...syncDeadLetterEnvelope(),
        options: {
          attempts: 5,
          backoff: { type: "fixed", delay: 250 },
          priority: 2,
          removeOnComplete: 20,
        },
        exhaustedAttempt: 3,
      },
      "dlq-entry-1",
    );

    expect(queued).toBe(true);
    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "sync-wallet",
      { walletId: "wallet-1", reason: "retry" },
      {
        attempts: 5,
        backoff: { type: "fixed", delay: 250 },
        priority: 2,
        removeOnComplete: 20,
        jobId: toBullMqJobId("dead-letter-retry:dlq-entry-1"),
      },
    );
  });

  it("uses canonical retry defaults and contains dead-letter enqueue errors", async () => {
    await expect(
      enqueueDeadLetterJob(syncDeadLetterEnvelope(), "entry-defaults"),
    ).resolves.toBe(true);
    expect(mocks.mockQueueAdd).toHaveBeenLastCalledWith(
      "sync-wallet",
      { walletId: "wallet-1", reason: "retry" },
      {
        ...SYNC_WALLET_JOB_OPTIONS,
        jobId: toBullMqJobId("dead-letter-retry:entry-defaults"),
      },
    );

    mocks.mockQueueAdd.mockRejectedValueOnce(new Error("Redis write failed"));
    await expect(
      enqueueDeadLetterJob(syncDeadLetterEnvelope(), "entry-failure"),
    ).resolves.toBe(false);
  });

  it("preserves a valid full-resync attempt through dead-letter retry", async () => {
    const data = {
      walletId: "wallet-1",
      fullResync: true,
      fullResyncGeneration: FULL_RESYNC_GENERATION_MAX,
    };

    await expect(enqueueDeadLetterJob({
      ...syncDeadLetterEnvelope(),
      data,
    }, "full-resync-entry")).resolves.toBe(true);

    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "sync-wallet",
      data,
      expect.objectContaining({
        jobId: toBullMqJobId("dead-letter-retry:full-resync-entry"),
      }),
    );
  });

  it("accepts a generation-free ordinary rebuild envelope", async () => {
    const data = { walletId: "wallet-1", fullResync: false };

    await expect(enqueueDeadLetterJob({
      ...syncDeadLetterEnvelope(),
      data,
    }, "ordinary-rebuild-entry")).resolves.toBe(true);

    expect(mocks.mockQueueAdd).toHaveBeenCalledWith(
      "sync-wallet",
      data,
      expect.objectContaining({
        jobId: toBullMqJobId("dead-letter-retry:ordinary-rebuild-entry"),
      }),
    );
  });

  it("rejects unsupported dead-letter envelopes before enqueueing", async () => {
    const invalidEnvelopes = [
      {
        version: 2,
        queue: "sync",
        name: "sync-wallet",
        data: { walletId: "wallet-1" },
      },
      {
        version: 1,
        queue: "notifications",
        name: "sync-wallet",
        data: { walletId: "wallet-1" },
      },
      {
        version: 1,
        queue: "sync",
        name: "other-job",
        data: { walletId: "wallet-1" },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: { walletId: "" },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: { walletId: "wallet-1", priority: "urgent" },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: { walletId: "wallet-1", reason: 123 },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: { walletId: "wallet-1", fullResync: true },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: {
          walletId: "wallet-1",
          fullResync: true,
          fullResyncGeneration: 0,
        },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: {
          walletId: "wallet-1",
          fullResync: true,
          fullResyncGeneration: 1.5,
        },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: {
          walletId: "wallet-1",
          fullResync: true,
          fullResyncGeneration: FULL_RESYNC_GENERATION_MAX + 1,
        },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: {
          walletId: "wallet-1",
          fullResync: false,
          fullResyncGeneration: 7,
        },
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: null,
      },
      {
        version: 1,
        queue: "sync",
        name: "sync-wallet",
        data: { walletId: "wallet-1" },
        options: null,
      },
    ];

    for (const envelope of invalidEnvelopes) {
      await expect(
        enqueueDeadLetterJob(
          {
            jobId: "original",
            options: {},
            exhaustedAttempt: 1,
            ...envelope,
          } as unknown as DeadLetterJobEnvelope,
          "entry-1",
        ),
      ).resolves.toBe(false);
    }
    await expect(
      enqueueDeadLetterJob(syncDeadLetterEnvelope(), ""),
    ).resolves.toBe(false);
    expect(mocks.mockQueueAdd).not.toHaveBeenCalled();
  });
});
