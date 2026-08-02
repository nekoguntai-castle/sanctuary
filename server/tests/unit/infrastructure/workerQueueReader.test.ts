import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRedisClient: vi.fn(),
  isRedisConnected: vi.fn(),
  createHandle: vi.fn(),
}));

vi.mock("../../../src/infrastructure/redis", () => ({
  getRedisClient: mocks.getRedisClient,
  isRedisConnected: mocks.isRedisConnected,
}));

vi.mock("../../../src/internal/workerQueues", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../src/internal/workerQueues")>();
  return { ...original, createNotificationQueueReadHandle: mocks.createHandle };
});

import { readNotificationQueue } from "../../../src/infrastructure/workerQueueReader";
import { NOTIFICATION_QUEUE_STATES } from "../../../src/internal/workerQueues";

function handle(overrides: Record<string, unknown> = {}) {
  return {
    getCounts: vi.fn(async () => ({
      waiting: 3,
      paused: 2,
      active: 1,
      delayed: 4,
      failed: 5,
      completed: 6,
      prioritized: 7,
      "waiting-children": 8,
    })),
    isPaused: vi.fn(async () => true),
    getOldestTimestamp: vi.fn(async () => null),
    close: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("notification worker queue reader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getRedisClient.mockReturnValue({
      options: {
        host: "redis.internal",
        port: 6380,
        username: "worker",
        password: "credential",
        db: 4,
      },
    });
    mocks.isRedisConnected.mockReturnValue(true);
  });

  it("returns bounded counts, pause state, and coarse ages from bounded getters", async () => {
    const now = 2_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const timestamps = new Map([
      ["waiting", now - 30_000],
      ["active", now - 2 * 60_000],
      ["delayed", now + 60_000],
      ["failed", now - 10 * 60_000],
      ["completed", now - 2 * 60 * 60_000],
      ["prioritized", now - 2 * 24 * 60 * 60_000],
      ["waitingChildren", null],
    ]);
    const queueHandle = handle({
      getOldestTimestamp: vi.fn(
        async (state: string) => timestamps.get(state) ?? null,
      ),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue();

    expect(mocks.createHandle).toHaveBeenCalledWith({
      host: "redis.internal",
      port: 6380,
      username: "worker",
      password: "credential",
      db: 4,
    });
    expect(result.consistency).toBe("approximate_non_atomic");
    expect(result.retention).toEqual({
      contractVersion: 1,
      producerCompatibility: "unknown",
      families: {
        transaction: {
          classification: "uniform",
          completed: { kind: "count", count: 500 },
          failed: { kind: "count", count: 250 },
          retainedAge: { status: "unsupported" },
        },
        draft: {
          classification: "uniform",
          completed: { kind: "count", count: 500 },
          failed: { kind: "count", count: 250 },
          retainedAge: { status: "unsupported" },
        },
        consolidation: {
          classification: "uniform",
          completed: { kind: "count", count: 500 },
          failed: { kind: "count", count: 250 },
          retainedAge: { status: "unsupported" },
        },
        webhook: {
          classification: "immediate_removal",
          completed: { kind: "immediate_removal" },
          failed: { kind: "immediate_removal" },
          retainedAge: { status: "unsupported" },
        },
      },
    });
    expect(result.paused).toEqual({ status: "observed", value: true });
    expect(result.states.waiting).toEqual({
      count: { status: "observed", value: { value: 5, saturated: false } },
      oldestAge: { status: "observed", value: "lt_1m" },
    });
    expect(result.states.active.oldestAge).toEqual({
      status: "observed",
      value: "one_to_five_minutes",
    });
    expect(result.states.delayed.oldestAge).toEqual({
      status: "observed",
      value: "not_due",
    });
    expect(result.states.failed.oldestAge).toEqual({
      status: "observed",
      value: "five_minutes_to_one_hour",
    });
    expect(result.states.completed.oldestAge).toEqual({
      status: "observed",
      value: "one_to_twenty_four_hours",
    });
    expect(result.states.prioritized.oldestAge).toEqual({
      status: "observed",
      value: "gte_twenty_four_hours",
    });
    expect(result.states.waitingChildren.oldestAge).toEqual({
      status: "observed",
      value: "none",
    });
    expect(queueHandle.getOldestTimestamp).toHaveBeenCalledTimes(
      NOTIFICATION_QUEUE_STATES.length,
    );
    expect(queueHandle.close).toHaveBeenCalledOnce();
    expect(queueHandle.disconnect).not.toHaveBeenCalled();
  });

  it("reports unavailable without constructing a queue when Redis is not connected", async () => {
    mocks.isRedisConnected.mockReturnValue(false);

    const result = await readNotificationQueue();

    expect(mocks.createHandle).not.toHaveBeenCalled();
    expect(result.paused.status).toBe("unavailable");
    expect(
      Object.values(result.states).every(
        (state) =>
          state.count.status === "unavailable" &&
          state.oldestAge.status === "unavailable",
      ),
    ).toBe(true);
  });

  it("reports unavailable when no Redis client exists", async () => {
    mocks.getRedisClient.mockReturnValue(null);

    const result = await readNotificationQueue();

    expect(result.paused.status).toBe("unavailable");
    expect(mocks.isRedisConnected).not.toHaveBeenCalled();
  });

  it("reports unsupported getters without inventing zero values", async () => {
    const queueHandle = handle({
      getCounts: undefined,
      isPaused: undefined,
      getOldestTimestamp: undefined,
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue();

    expect(result.paused.status).toBe("unsupported");
    expect(
      Object.values(result.states).every(
        (state) =>
          state.count.status === "unsupported" &&
          state.oldestAge.status === "unsupported",
      ),
    ).toBe(true);
    expect(queueHandle.close).toHaveBeenCalledOnce();
  });

  it("force-disconnects timed-out getter work before closing", async () => {
    const pending = new Promise<never>(() => undefined);
    const queueHandle = handle({
      getCounts: vi.fn(() => pending),
      isPaused: vi.fn(() => pending),
      getOldestTimestamp: vi.fn(() => pending),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue({
      commandTimeoutMs: 1,
      cleanupTimeoutMs: 10,
    });

    expect(result.paused.status).toBe("timeout");
    expect(
      Object.values(result.states).every(
        (state) =>
          state.count.status === "timeout" &&
          state.oldestAge.status === "timeout",
      ),
    ).toBe(true);
    expect(queueHandle.disconnect).toHaveBeenCalledOnce();
    expect(queueHandle.close).toHaveBeenCalledOnce();
    expect(queueHandle.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
      queueHandle.close.mock.invocationCallOrder[0],
    );
  });

  it("maps getter failures and malformed counts to unavailable", async () => {
    const queueHandle = handle({
      getCounts: vi.fn(async () => ({
        waiting: -1,
        paused: 0,
        active: Number.MAX_SAFE_INTEGER + 1,
      })),
      isPaused: vi.fn(async () => {
        throw new Error("private redis endpoint");
      }),
      getOldestTimestamp: vi.fn(async () => {
        throw new Error("private job payload");
      }),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue();

    expect(result.paused.status).toBe("unavailable");
    expect(result.states.waiting.count.status).toBe("unavailable");
    expect(result.states.active.count.status).toBe("unavailable");
    expect(result.states.delayed.count.status).toBe("unsupported");
    expect(
      Object.values(result.states).every(
        (state) => state.oldestAge.status === "unavailable",
      ),
    ).toBe(true);
  });

  it("reports a missing waiting component as unsupported", async () => {
    const queueHandle = handle({
      getCounts: vi.fn(async () => ({
        waiting: 2,
        active: 0,
        delayed: 0,
        failed: 0,
        completed: 0,
        prioritized: 0,
        "waiting-children": 0,
      })),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue();

    expect(result.states.waiting.count.status).toBe("unsupported");
  });

  it("fails malformed getter values closed instead of reporting health", async () => {
    const queueHandle = handle({
      getCounts: vi.fn(async () => null),
      isPaused: vi.fn(async () => "yes"),
      getOldestTimestamp: vi.fn(async () => Number.NaN),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue();

    expect(result.paused.status).toBe("unavailable");
    expect(
      Object.values(result.states).every(
        (state) =>
          state.count.status === "unavailable" &&
          state.oldestAge.status === "unavailable",
      ),
    ).toBe(true);
  });

  it("caps oversized counts and marks saturation", async () => {
    const queueHandle = handle({
      getCounts: vi.fn(async () => ({
        waiting: 1_000_001,
        paused: 1,
        active: 1_000_001,
        delayed: 0,
        failed: 0,
        completed: 0,
        prioritized: 0,
        "waiting-children": 0,
      })),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    const result = await readNotificationQueue();

    expect(result.states.waiting.count).toEqual({
      status: "observed",
      value: { value: 1_000_000, saturated: true },
    });
    expect(result.states.active.count).toEqual({
      status: "observed",
      value: { value: 1_000_000, saturated: true },
    });
  });

  it("force-disconnects when graceful close fails and rejects invalid budgets", async () => {
    const queueHandle = handle({
      close: vi.fn(async () => {
        throw new Error("close failed");
      }),
    });
    mocks.createHandle.mockReturnValue(queueHandle);

    await readNotificationQueue();

    expect(queueHandle.disconnect).toHaveBeenCalledOnce();
    await expect(
      readNotificationQueue({ commandTimeoutMs: 0 }),
    ).rejects.toThrow("Notification queue read timeout");
    await expect(
      readNotificationQueue({ cleanupTimeoutMs: 5_001 }),
    ).rejects.toThrow("Notification queue read timeout");
  });

  it("bounds cleanup failures on normal-close and timeout paths", async () => {
    const failedDisconnect = vi.fn(async () => {
      throw new Error("disconnect failed");
    });
    const closeFailureHandle = handle({
      close: vi.fn(async () => {
        throw new Error("close failed");
      }),
      disconnect: failedDisconnect,
    });
    mocks.createHandle.mockReturnValueOnce(closeFailureHandle);

    await expect(readNotificationQueue()).resolves.toMatchObject({
      consistency: "approximate_non_atomic",
    });
    expect(failedDisconnect).toHaveBeenCalledOnce();

    const pending = new Promise<never>(() => undefined);
    const timeoutHandle = handle({
      getCounts: vi.fn(() => pending),
      isPaused: vi.fn(() => pending),
      getOldestTimestamp: vi.fn(() => pending),
      disconnect: vi.fn(async () => {
        throw new Error("forced disconnect failed");
      }),
    });
    mocks.createHandle.mockReturnValueOnce(timeoutHandle);

    await expect(
      readNotificationQueue({ commandTimeoutMs: 1 }),
    ).resolves.toMatchObject({ paused: { status: "timeout" } });
    expect(timeoutHandle.close).toHaveBeenCalledOnce();
  });

  it("maps queue construction failure to unavailable", async () => {
    mocks.createHandle.mockImplementation(() => {
      throw new Error("connection refused");
    });

    const result = await readNotificationQueue();

    expect(result.paused.status).toBe("unavailable");
    expect(result.consistency).toBe("approximate_non_atomic");
  });
});
