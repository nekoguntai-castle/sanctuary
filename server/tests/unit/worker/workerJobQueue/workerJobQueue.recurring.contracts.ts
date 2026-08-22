import { beforeEach, describe, expect, it, vi } from "vitest";
import { toBullMqJobId } from "../../../../src/jobs/bullMqJobIds";

import {
  mockRedis,
  WorkerJobQueue,
  type WorkerJobQueueAccessor,
} from "./workerJobQueueTestHarness";

const cronDefinition = (
  queue: string,
  name: string,
  data: unknown,
  pattern: string,
) => ({
  schedulerId: `${queue}:${name}`,
  queue,
  name,
  data,
  recurrence: { pattern, tz: "UTC" as const },
});

export const registerWorkerJobQueueRecurringContracts = (
  getQueue: WorkerJobQueueAccessor,
) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
  });

  describe("scheduleRecurring", () => {
    it("should schedule a recurring job", async () => {
      await queue.initialize();

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(result.status).toBe("created");
    });

    it("applies registered defaults and reconciles retry-option drift", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      queue.registerHandler("sync", {
        name: "check-stale",
        queue: "sync",
        options: {
          attempts: 2,
          backoff: { type: "fixed", delay: 5000 },
        },
        handler: vi.fn(),
      });
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "sync:check-stale",
          pattern: "*/5 * * * *",
          tz: "UTC",
          template: {
            data: {},
            opts: {
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
              removeOnComplete: 10,
            },
          },
        },
      ]);

      await expect(
        queue.scheduleRecurring(
          {
            ...cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
            options: { attempts: 4 },
          },
        ),
      ).resolves.toEqual({ status: "created" });
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        "sync:check-stale",
        { pattern: "*/5 * * * *", tz: "UTC" },
        {
          name: "check-stale",
          data: {},
          opts: {
            attempts: 4,
            backoff: { type: "fixed", delay: 5000 },
            removeOnComplete: 10,
          },
        },
      );
    });

    it("establishes generation identity before publishing a freshness scheduler", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      await expect(
        queue.scheduleRecurring({
          ...cronDefinition("sync", "check-freshness", { walletId: "w1" }, "*/5 * * * *"),
          freshness: { maxAgeMs: 600_000, startupGraceMs: 300_000 },
        }),
      ).resolves.toEqual({ status: "created" });

      expect(mockRedis.eval.mock.invocationCallOrder[0]).toBeLessThan(
        syncQueue.upsertJobScheduler.mock.invocationCallOrder[0],
      );
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        "sync:check-freshness",
        { pattern: "*/5 * * * *", tz: "UTC" },
        expect.objectContaining({
          data: {
            __sanctuaryRecurring: {
              version: 1,
              generationToken: expect.any(String),
            },
            payload: { walletId: "w1" },
          },
        }),
      );
    });

    it("preserves exact millisecond intervals and migrates cron to every", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      const intervalDefinition = {
        schedulerId: "sync:check-stale",
        queue: "sync",
        name: "check-stale",
        data: {},
        recurrence: { every: 90_000 },
      };
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "sync:check-stale",
          every: 90_000,
          template: { data: {} },
        },
      ]);

      await expect(
        queue.scheduleRecurring(intervalDefinition),
      ).resolves.toEqual({ status: "unchanged" });
      expect(syncQueue.upsertJobScheduler).not.toHaveBeenCalled();

      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "sync:check-stale",
          pattern: "*/1 * * * *",
          tz: "UTC",
          template: { data: {} },
        },
      ]);
      await expect(
        queue.scheduleRecurring(intervalDefinition),
      ).resolves.toEqual({ status: "created" });
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        "sync:check-stale",
        { every: 90_000 },
        expect.objectContaining({ name: "check-stale", data: {} }),
      );
    });

    it("rejects inexact interval definitions at the queue boundary", async () => {
      await queue.initialize();

      await expect(
        queue.scheduleRecurring({
          schedulerId: "sync:invalid",
          queue: "sync",
          name: "invalid",
          data: {},
          recurrence: { every: 999 },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("at least 1000ms"),
        }),
      );

      await expect(
        queue.scheduleRecurring({
          schedulerId: "other:invalid",
          queue: "sync",
          name: "invalid",
          data: {},
          recurrence: { every: 90_000 },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("queue:name"),
        }),
      );

      await expect(
        queue.scheduleRecurring({
          schedulerId: "sync:invalid-cron",
          queue: "sync",
          name: "invalid-cron",
          data: {},
          recurrence: { pattern: " ", tz: "UTC" },
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "failed",
          error: expect.stringContaining("cannot be empty"),
        }),
      );
    });

    it("returns null when scheduling on missing queue", async () => {
      await queue.initialize();

      const result = await queue.scheduleRecurring(
        cronDefinition("missing", "check-stale", {}, "*/5 * * * *"),
      );

      expect(result).toEqual(
        expect.objectContaining({ status: "failed", error: expect.any(String) }),
      );
    });

    it("should return early (idempotent) when exact jobId already exists", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "sync:check-stale",
          pattern: "*/5 * * * *",
          tz: "UTC",
          template: { data: {} },
        },
      ]);

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(result.status).toBe("unchanged");
      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(syncQueue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it("treats an exact scheduler without template data as empty data", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "sync:check-stale",
          pattern: "*/5 * * * *",
          tz: "UTC",
        },
      ]);

      await expect(
        queue.scheduleRecurring(
          cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
        ),
      ).resolves.toEqual({ status: "unchanged" });
      expect(syncQueue.upsertJobScheduler).not.toHaveBeenCalled();
    });

    it("removes an obsolete scheduler without double-removing its represented repeatable", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "legacy-key",
          pattern: "*/10 * * * *",
          tz: "UTC",
          template: { data: {} },
        },
      ]);
      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: "check-stale", key: "legacy-key" },
      ]);

      await expect(
        queue.scheduleRecurring(
          cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
        ),
      ).resolves.toEqual({ status: "created" });
      expect(syncQueue.removeJobScheduler).toHaveBeenCalledWith("legacy-key");
      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it("removes legacy repeatables that used unsafe custom job IDs", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        {
          name: "check-stale",
          id: "repeat:sync:check-stale:*/5 * * * *",
          key: "legacy-key",
        },
      ]);

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "legacy-key",
      );
      expect(result.status).toBe("created");
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        "sync:check-stale",
        { pattern: "*/5 * * * *", tz: "UTC" },
        expect.objectContaining({ name: "check-stale", data: {} }),
      );
    });

    it("should remove stale repeatable with different cron before scheduling new one", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      // Old cron was every 10 min, new cron is every 5 min
      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        {
          name: "check-stale",
          id: "repeat:sync:check-stale:*/10 * * * *",
          key: "old-key",
        },
      ]);

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith("old-key");
      expect(result.status).toBe("created");
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalled();
    });

    it("should not remove repeatables belonging to a different job name", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        {
          name: "other-job",
          id: "repeat:sync:other-job:*/5 * * * *",
          key: "other-key",
        },
      ]);

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
      expect(result.status).toBe("created");
    });

    it("should remove multiple stale repeatables for the same job name", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        {
          name: "check-stale",
          id: "repeat:sync:check-stale:*/10 * * * *",
          key: "stale-1",
        },
        {
          name: "check-stale",
          id: "repeat:sync:check-stale:*/15 * * * *",
          key: "stale-2",
        },
      ]);

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledTimes(2);
      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith("stale-1");
      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith("stale-2");
      expect(result.status).toBe("created");
    });

    it("keeps a stale schedule when replacement creation fails", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: "check-stale", key: "old-key", pattern: "*/10 * * * *" },
      ]);
      syncQueue.upsertJobScheduler.mockRejectedValueOnce(new Error("Redis error"));

      const result = await queue.scheduleRecurring(
        cronDefinition("sync", "check-stale", {}, "*/5 * * * *"),
      );

      expect(result.status).toBe("failed");
      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it("inspects required schedules and reports missing or duplicate definitions", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        { name: "check-stale", key: "sync:check-stale", pattern: "*/5 * * * *", tz: "UTC" },
        { name: "check-stale", key: "legacy-key", pattern: "*/10 * * * *", tz: "UTC" },
      ]);

      const health = await queue.inspectRecurringSchedules([
        {
          schedulerId: "sync:check-stale",
          queue: "sync",
          name: "check-stale",
          data: {},
          recurrence: { pattern: "*/5 * * * *", tz: "UTC" },
        },
        {
          schedulerId: "sync:missing",
          queue: "sync",
          name: "missing",
          data: {},
          recurrence: { pattern: "* * * * *", tz: "UTC" },
        },
      ]);

      expect(health).toEqual({
        healthy: false,
        missing: ["sync:missing"],
        mismatched: ["sync:check-stale"],
        unexpected: [],
        inspectionFailures: [],
      });
    });

    it("reports missing queues and inspection failures, then recognizes an exact healthy set", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      const syncDefinition = cronDefinition(
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
      );
      const missingDefinition = cronDefinition(
        "missing",
        "check-stale",
        {},
        "*/5 * * * *",
      );
      syncQueue.getJobSchedulers.mockRejectedValueOnce(
        new Error("Redis unavailable"),
      );

      await expect(
        queue.inspectRecurringSchedules([syncDefinition, missingDefinition]),
      ).resolves.toEqual({
        healthy: false,
        missing: ["sync:check-stale", "missing:check-stale"],
        mismatched: [],
        unexpected: [],
        inspectionFailures: ["sync"],
      });

      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "check-stale",
          key: "sync:check-stale",
          pattern: "*/5 * * * *",
          tz: "UTC",
          template: { data: {} },
        },
      ]);
      await expect(
        queue.inspectRecurringSchedules([syncDefinition]),
      ).resolves.toEqual({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      });
    });

    it("reports forbidden conditional schedules as unexpected", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      const forbidden = cronDefinition(
        "sync",
        "conditional",
        {},
        "*/5 * * * *",
      );
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "conditional",
          key: "sync:conditional",
          pattern: "*/5 * * * *",
          tz: "UTC",
          template: { data: {} },
        },
      ]);

      await expect(
        queue.inspectRecurringSchedules([], [forbidden]),
      ).resolves.toEqual({
        healthy: false,
        missing: [],
        mismatched: [],
        unexpected: ["sync:conditional"],
        inspectionFailures: [],
      });

      syncQueue.getJobSchedulers.mockResolvedValueOnce([]);
      await expect(
        queue.inspectRecurringSchedules([], [forbidden]),
      ).resolves.toEqual({
        healthy: true,
        missing: [],
        mismatched: [],
        unexpected: [],
        inspectionFailures: [],
      });
    });
  });

  describe("removeRecurring", () => {
    it("should remove repeatable jobs by name", async () => {
      await queue.initialize();
      // Use a queue that exists in this test instance
      const q = new WorkerJobQueue({
        concurrency: 1,
        queues: ["maintenance"],
      });
      await q.initialize();
      const maintenanceQueue = (q as any).queues.get("maintenance").queue;

      maintenanceQueue.getRepeatableJobs.mockResolvedValue([
        { name: "autopilot:record-fees", key: "key-1" },
        { name: "autopilot:evaluate", key: "key-2" },
        { name: "other-job", key: "key-3" },
      ]);

      await q.removeRecurring("maintenance", "autopilot:record-fees");

      expect(maintenanceQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "key-1",
      );
      expect(maintenanceQueue.removeRepeatableByKey).toHaveBeenCalledTimes(1);
    });

    it("should return early for non-existent queue", async () => {
      await queue.initialize();

      // Should not throw
      await expect(
        queue.removeRecurring("nonexistent", "some-job"),
      ).resolves.toEqual(
        expect.objectContaining({ status: "failed" }),
      );
    });

    it("should purge waiting and delayed jobs when purgeQueued is true", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      syncQueue.getRepeatableJobs.mockResolvedValue([]);

      const mockWaitingJob = { name: "check-stale", remove: vi.fn() };
      const mockDelayedJob = { name: "check-stale", remove: vi.fn() };
      const mockOtherJob = { name: "other-job", remove: vi.fn() };

      syncQueue.getJobs = vi
        .fn()
        .mockResolvedValue([mockWaitingJob, mockOtherJob, mockDelayedJob]);

      await queue.removeRecurring("sync", "check-stale", { purgeQueued: true });

      expect(mockWaitingJob.remove).toHaveBeenCalled();
      expect(mockDelayedJob.remove).toHaveBeenCalled();
      expect(mockOtherJob.remove).not.toHaveBeenCalled();
    });

    it("should not purge queued jobs when purgeQueued is not set", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobs.mockClear();

      syncQueue.getRepeatableJobs.mockResolvedValue([]);

      await queue.removeRecurring("sync", "check-stale");

      // getJobs should not be called since purgeQueued is not set
      expect(syncQueue.getJobs).not.toHaveBeenCalled();
    });

    it("should handle errors gracefully", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      syncQueue.getRepeatableJobs.mockRejectedValue(new Error("Redis error"));

      await expect(
        queue.removeRecurring("sync", "check-stale"),
      ).resolves.toEqual({
        status: "failed",
        error: "Redis error",
      });
    });
  });

  describe("purgeStaleWalletScheduleJobs", () => {
    it("removes encoded stale parents and children across every safe prestart state", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      const staleParent = {
        id: "repeat-parent",
        name: "check-stale-wallets",
        data: {},
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const staleChild = {
        id: toBullMqJobId("sync:stale:wallet-1:123"),
        name: "sync-wallet",
        data: { reason: "stale" },
        remove: vi.fn().mockResolvedValue(undefined),
      };
      const manual = {
        id: toBullMqJobId("manual-sync:wallet-1"),
        name: "sync-wallet",
        data: { reason: "manual" },
        remove: vi.fn().mockResolvedValue(undefined),
      };
      syncQueue.getJobs.mockClear();
      syncQueue.getJobCounts.mockResolvedValue({
        wait: 3,
        delayed: 1,
        prioritized: 1,
        paused: 1,
        "waiting-children": 1,
      });
      syncQueue.getJobs.mockImplementation(async (states: string[]) => (
        states[0] === "wait" ? [staleParent, staleChild, manual] : []
      ));

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "removed",
      });
      expect(syncQueue.getJobs).toHaveBeenCalledWith(["wait"], 0, 2, false);
      for (const state of ["delayed", "prioritized", "paused", "waiting-children"]) {
        expect(syncQueue.getJobs).toHaveBeenCalledWith([state], 0, 0, false);
      }
      expect(staleParent.remove).toHaveBeenCalledOnce();
      expect(staleChild.remove).toHaveBeenCalledOnce();
      expect(manual.remove).not.toHaveBeenCalled();
    });

    it("fails closed when a matching job cannot be removed", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobCounts.mockResolvedValue({ wait: 1 });
      syncQueue.getJobs.mockResolvedValueOnce([{
        id: toBullMqJobId("sync:stale:wallet-1"),
        name: "sync-wallet",
        data: {},
        remove: vi.fn().mockRejectedValue(new Error("job became active")),
      }]);

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "failed",
        error: "job became active",
      });
    });

    it("fails closed instead of deleting an indeterminate encoded identity", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      const unknown = {
        id: "b64_not+base64",
        name: "sync-wallet",
        data: { reason: "custom-source" },
        remove: vi.fn(),
      };
      syncQueue.getJobCounts.mockResolvedValue({ wait: 1 });
      syncQueue.getJobs.mockResolvedValueOnce([unknown]);

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "failed",
        error: expect.stringContaining("Cannot classify queued sync job"),
      });
      expect(unknown.remove).not.toHaveBeenCalled();
    });

    it("scans a legitimate backlog beyond the former fixed cardinality ceiling", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      const retained = Array.from({ length: 5_001 }, (_, index) => ({
        id: `manual-${index}`,
        name: "sync-wallet",
        data: { reason: "manual" },
        remove: vi.fn(),
      }));
      syncQueue.getJobCounts.mockResolvedValue({ wait: retained.length });
      syncQueue.getJobs.mockImplementation(async (
        states: string[],
        start: number,
        end: number,
      ) => states[0] === "wait" ? retained.slice(start, end + 1) : []);

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "absent",
      });
      expect(syncQueue.getJobs.mock.calls.filter(([states]: [string[]]) => (
        states[0] === "wait"
      )).length).toBeGreaterThan(20);
      expect(retained.every((job) => job.remove.mock.calls.length === 0)).toBe(true);
    });

    it("bounds each scan to the queue population observed at reconciliation start", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobs.mockClear();
      const retained = Array.from({ length: 250 }, (_, index) => ({
        id: `manual-${index}`,
        name: "sync-wallet",
        data: { reason: "manual" },
        remove: vi.fn(),
      }));
      syncQueue.getJobCounts.mockResolvedValue({ wait: retained.length });
      syncQueue.getJobs.mockResolvedValue(retained);

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "absent",
      });
      expect(syncQueue.getJobs).toHaveBeenCalledTimes(1);
      expect(syncQueue.getJobs).toHaveBeenCalledWith(["wait"], 0, 249, false);
    });

    it("isolates waiting pages from BullMQ's waiting-to-paused alias expansion", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobs.mockClear();
      const waiting = Array.from({ length: 500 }, (_, index) => ({
        id: `manual-waiting-${index}`,
        name: "sync-wallet",
        data: { reason: "manual" },
        remove: vi.fn(),
      }));
      const paused = Array.from({ length: 250 }, (_, index) => ({
        id: `manual-paused-${index}`,
        name: "sync-wallet",
        data: { reason: "manual" },
        remove: vi.fn(),
      }));
      syncQueue.getJobCounts.mockResolvedValue({
        wait: waiting.length,
        waiting: waiting.length,
        paused: paused.length,
      });
      syncQueue.getJobs.mockImplementation(async (
        states: string[],
        start: number,
        end: number,
      ) => {
        if (states[0] === "wait") return waiting.slice(start, end + 1);
        if (states[0] === "paused") return paused.slice(start, end + 1);
        if (states[0] === "waiting") {
          return [
            ...waiting.slice(start, end + 1),
            ...paused.slice(start, end + 1),
          ];
        }
        return [];
      });

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "absent",
      });
      expect(syncQueue.getJobs).toHaveBeenCalledWith(["wait"], 0, 249, false);
      expect(syncQueue.getJobs).toHaveBeenCalledWith(["wait"], 250, 499, false);
      expect(syncQueue.getJobs).toHaveBeenCalledWith(["paused"], 0, 249, false);
      expect(syncQueue.getJobs).not.toHaveBeenCalledWith(
        ["waiting"],
        expect.any(Number),
        expect.any(Number),
        false,
      );
    });

    it.each([-1, 0.5])("fails closed for an invalid queue snapshot count %s", async (count) => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobCounts.mockResolvedValue({ wait: count });

      await expect(queue.purgeStaleWalletScheduleJobs()).resolves.toEqual({
        status: "failed",
        error: `Invalid wait job count: ${String(count)}`,
      });
      expect(syncQueue.getJobs).toHaveBeenCalledTimes(1);
    });
  });
};
