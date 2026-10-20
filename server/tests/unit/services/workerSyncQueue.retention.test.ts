import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queueAdd: vi.fn(),
  queueAddBulk: vi.fn(),
  queueGetJob: vi.fn(),
  queueGetDeduplicationJobId: vi.fn(),
  queueRemoveDeduplicationKey: vi.fn(),
  reserveGeneration: vi.fn(),
  getRedisClient: vi.fn(),
  isRedisConnected: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function MockQueue() {
    return {
      add: mocks.queueAdd,
      addBulk: mocks.queueAddBulk,
      getJob: mocks.queueGetJob,
      getDeduplicationJobId: mocks.queueGetDeduplicationJobId,
      removeDeduplicationKey: mocks.queueRemoveDeduplicationKey,
      close: vi.fn().mockResolvedValue(undefined),
    };
  }),
}));
vi.mock("../../../src/infrastructure", () => ({
  getRedisClient: mocks.getRedisClient,
  isRedisConnected: mocks.isRedisConnected,
}));
vi.mock("../../../src/repositories/resyncRepository", () => ({
  reserveFullResyncGeneration: mocks.reserveGeneration,
  isFullResyncGenerationProcessed: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../../src/repositories/walletSyncSchedulePolicyRepository", () => ({
  readStaleWalletSchedulePolicy: vi.fn().mockResolvedValue({ mode: "legacy_enabled" }),
}));
vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  }),
}));

import {
  closeWorkerSyncQueue,
  enqueueFullResyncBatch,
  enqueueIncrementalSyncWakeup,
  enqueueReservedFullResyncWakeup,
  enqueueWalletSync,
  enqueueWalletSyncBatch,
} from "../../../src/services/workerSyncQueue";

const BOUNDED = {
  removeOnComplete: { count: 500 },
  removeOnFail: { count: 250 },
};

/** Every API-side add must carry count-based retention, never `true`/unbounded. */
function expectBounded(options: Record<string, unknown> | undefined) {
  expect(options).toMatchObject(BOUNDED);
  expect(options?.removeOnComplete).not.toBe(true);
}

describe("workerSyncQueue finished-job retention", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.queueAdd.mockReset().mockImplementation(async (_name, data, options) => ({
      id: options?.jobId, data, getState: vi.fn().mockResolvedValue("waiting"),
    }));
    mocks.queueAddBulk.mockReset().mockResolvedValue([{ id: "job-1" }]);
    mocks.queueGetJob.mockReset().mockResolvedValue(null);
    mocks.queueGetDeduplicationJobId.mockReset().mockResolvedValue(null);
    mocks.queueRemoveDeduplicationKey.mockReset().mockResolvedValue(1);
    mocks.reserveGeneration.mockReset().mockResolvedValue(3);
    mocks.getRedisClient.mockReturnValue({ options: { host: "localhost", port: 6379, db: 0 } });
    mocks.isRedisConnected.mockReturnValue(true);
    await closeWorkerSyncQueue();
  });

  it("bounds single wallet sync jobs", async () => {
    await enqueueWalletSync("wallet-1", { reason: "manual" });
    expectBounded(mocks.queueAdd.mock.calls[0][2]);
  });

  it("bounds incremental wake-up jobs", async () => {
    await enqueueIncrementalSyncWakeup({ walletId: "wallet-1", generation: 2, jobId: "job-a" });
    expectBounded(mocks.queueAdd.mock.calls[0][2]);
  });

  it("bounds reserved full-resync wake-up jobs", async () => {
    await enqueueReservedFullResyncWakeup({
      walletId: "wallet-1", generation: 3, incrementalGeneration: 2,
    });
    expectBounded(mocks.queueAdd.mock.calls[0][2]);
  });

  it("bounds full-resync batch jobs", async () => {
    await enqueueFullResyncBatch(["wallet-1"], { reason: "manual-resync" });
    expectBounded(mocks.queueAdd.mock.calls[0][2]);
  });

  it("bounds bulk-added wallet sync jobs", async () => {
    await enqueueWalletSyncBatch(["wallet-1"]);
    expectBounded(mocks.queueAddBulk.mock.calls[0][0][0].opts);
  });
});
