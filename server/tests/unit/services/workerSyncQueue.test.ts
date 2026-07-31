import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mockQueueAdd: vi.fn().mockResolvedValue({ id: "job-1" }),
  mockQueueAddBulk: vi
    .fn()
    .mockResolvedValue([{ id: "job-1" }, { id: "job-2" }]),
  mockQueueClose: vi.fn().mockResolvedValue(undefined),
  mockGetRedisClient: vi.fn(),
  mockIsRedisConnected: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: mocks.mockQueueAdd,
      addBulk: mocks.mockQueueAddBulk,
      close: mocks.mockQueueClose,
    };
  }),
}));

vi.mock("../../../src/infrastructure", () => ({
  getRedisClient: mocks.mockGetRedisClient,
  isRedisConnected: mocks.mockIsRedisConnected,
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
  enqueueWalletSync,
  enqueueWalletSyncBatch,
} from "../../../src/services/workerSyncQueue";
import { toBullMqJobId } from "../../../src/jobs/bullMqJobIds";
import { SYNC_PRIORITY_BULLMQ_PRIORITY } from "@sanctuary/shared/constants/sync";
import { SYNC_WALLET_JOB_OPTIONS } from "../../../src/worker/jobs/jobOptions";
import type { DeadLetterJobEnvelope } from "../../../src/services/deadLetterQueueTypes";

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
