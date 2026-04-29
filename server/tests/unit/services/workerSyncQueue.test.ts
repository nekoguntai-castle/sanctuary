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
  enqueueWalletSync,
  enqueueWalletSyncBatch,
} from "../../../src/services/workerSyncQueue";
import { toBullMqJobId } from "../../../src/jobs/bullMqJobIds";

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
        priority: 1,
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
          priority: 3,
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
          priority: 3,
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
    expect(mocks.mockQueueAdd).not.toHaveBeenCalled();
    expect(mocks.mockQueueAddBulk).not.toHaveBeenCalled();
  });
});
