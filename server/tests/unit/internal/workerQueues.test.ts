import { beforeEach, describe, expect, it, vi } from "vitest";

const queueMock = vi.hoisted(() => ({
  constructor: vi.fn(),
  getJobCounts: vi.fn(),
  isPaused: vi.fn(),
  getJobs: vi.fn(),
  close: vi.fn(),
  disconnect: vi.fn(),
  add: vi.fn(),
  pause: vi.fn(),
  hset: vi.fn(),
  omitGetters: false,
}));

vi.mock("bullmq", () => ({
  Queue: vi.fn(function MockQueue(name: string, options: unknown) {
    queueMock.constructor(name, options);
    return {
      getJobCounts: queueMock.omitGetters ? undefined : queueMock.getJobCounts,
      isPaused: queueMock.omitGetters ? undefined : queueMock.isPaused,
      getJobs: queueMock.omitGetters ? undefined : queueMock.getJobs,
      close: queueMock.close,
      disconnect: queueMock.disconnect,
      add: queueMock.add,
      pause: queueMock.pause,
      client: { hset: queueMock.hset },
    };
  }),
}));

import {
  createNotificationQueueReadHandle,
  NOTIFICATION_QUEUE_NAME,
  WORKER_QUEUE_PREFIX,
} from "../../../src/internal/workerQueues";

describe("notification worker queue read handle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queueMock.omitGetters = false;
    queueMock.getJobCounts.mockResolvedValue({});
    queueMock.isPaused.mockResolvedValue(false);
    queueMock.getJobs.mockResolvedValue([]);
    queueMock.close.mockResolvedValue(undefined);
    queueMock.disconnect.mockResolvedValue(undefined);
  });

  it("constructs a getter-only queue without BullMQ metadata updates", async () => {
    const connection = { host: "redis", port: 6379, db: 2 };
    const handle = createNotificationQueueReadHandle(connection);

    expect(queueMock.constructor).toHaveBeenCalledWith(
      NOTIFICATION_QUEUE_NAME,
      {
        connection,
        prefix: WORKER_QUEUE_PREFIX,
        skipMetasUpdate: true,
        skipWaitingForReady: true,
      },
    );
    expect(Object.keys(handle).sort()).toEqual([
      "close",
      "disconnect",
      "getCounts",
      "getOldestTimestamp",
      "isPaused",
    ]);
    expect(Object.isFrozen(handle)).toBe(true);

    await handle.getCounts?.();
    await handle.isPaused?.();

    expect(queueMock.getJobCounts).toHaveBeenCalledTimes(1);
    expect(queueMock.getJobCounts.mock.calls[0]).toEqual([
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "prioritized",
      "waiting-children",
    ]);
    expect(queueMock.add).not.toHaveBeenCalled();
    expect(queueMock.pause).not.toHaveBeenCalled();
    expect(queueMock.hset).not.toHaveBeenCalled();
  });

  it("uses a one-record ascending range and returns only the state timestamp", async () => {
    queueMock.getJobs
      .mockResolvedValueOnce([{ timestamp: 100, finishedOn: 500 }])
      .mockResolvedValueOnce([{ timestamp: 1_000, delay: 250 }])
      .mockResolvedValueOnce([{ timestamp: 2_000, processedOn: 2_500 }])
      .mockResolvedValueOnce([{ timestamp: 3_000 }])
      .mockResolvedValueOnce([{ timestamp: 4_000 }])
      .mockResolvedValueOnce([]);
    const handle = createNotificationQueueReadHandle({
      host: "redis",
      port: 6379,
    });

    await expect(handle.getOldestTimestamp?.("completed")).resolves.toBe(500);
    await expect(handle.getOldestTimestamp?.("delayed")).resolves.toBe(1_250);
    await expect(handle.getOldestTimestamp?.("active")).resolves.toBe(2_500);
    await expect(handle.getOldestTimestamp?.("waiting")).resolves.toBe(3_000);
    await expect(handle.getOldestTimestamp?.("delayed")).resolves.toBe(4_000);
    await expect(
      handle.getOldestTimestamp?.("waitingChildren"),
    ).resolves.toBeNull();

    expect(queueMock.getJobs.mock.calls).toEqual([
      ["completed", 0, 0, true],
      ["delayed", 0, 0, true],
      ["active", 0, 0, true],
      ["waiting", 0, 0, true],
      ["delayed", 0, 0, true],
      ["waiting-children", 0, 0, true],
    ]);
  });

  it("marks unavailable BullMQ getters as unsupported without exporting the queue", () => {
    queueMock.omitGetters = true;

    const handle = createNotificationQueueReadHandle({
      host: "redis",
      port: 6379,
    });

    expect(handle.getCounts).toBeUndefined();
    expect(handle.isPaused).toBeUndefined();
    expect(handle.getOldestTimestamp).toBeUndefined();
    expect(Object.keys(handle)).not.toContain("add");
  });

  it("owns normal close and forced disconnect without exposing the queue", async () => {
    const handle = createNotificationQueueReadHandle({
      host: "redis",
      port: 6379,
    });

    await handle.close();
    await handle.disconnect();

    expect(queueMock.close).toHaveBeenCalledOnce();
    expect(queueMock.disconnect).toHaveBeenCalledOnce();
  });
});
