import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkerJobQueue,
  type WorkerJobQueueAccessor,
} from "./workerJobQueueTestHarness";

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
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
      );

      expect(result.status).toBe("created");
    });

    it("returns null when scheduling on missing queue", async () => {
      await queue.initialize();

      const result = await queue.scheduleRecurring(
        "missing",
        "check-stale",
        {},
        "*/5 * * * *",
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
          template: { data: {} },
        },
      ]);

      const result = await queue.scheduleRecurring(
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
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
        },
      ]);

      await expect(
        queue.scheduleRecurring("sync", "check-stale", {}, "*/5 * * * *"),
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
          template: { data: {} },
        },
      ]);
      syncQueue.getRepeatableJobs.mockResolvedValueOnce([
        { name: "check-stale", key: "legacy-key" },
      ]);

      await expect(
        queue.scheduleRecurring("sync", "check-stale", {}, "*/5 * * * *"),
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
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
      );

      expect(syncQueue.removeRepeatableByKey).toHaveBeenCalledWith(
        "legacy-key",
      );
      expect(result.status).toBe("created");
      expect(syncQueue.upsertJobScheduler).toHaveBeenCalledWith(
        "sync:check-stale",
        { pattern: "*/5 * * * *" },
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
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
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
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
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
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
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
        "sync",
        "check-stale",
        {},
        "*/5 * * * *",
      );

      expect(result.status).toBe("failed");
      expect(syncQueue.removeRepeatableByKey).not.toHaveBeenCalled();
    });

    it("inspects required schedules and reports missing or duplicate definitions", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        { name: "check-stale", key: "sync:check-stale", pattern: "*/5 * * * *" },
        { name: "check-stale", key: "legacy-key", pattern: "*/10 * * * *" },
      ]);

      const health = await queue.inspectRecurringSchedules([
        {
          schedulerId: "sync:check-stale",
          queue: "sync",
          name: "check-stale",
          data: {},
          cron: "*/5 * * * *",
        },
        {
          schedulerId: "sync:missing",
          queue: "sync",
          name: "missing",
          data: {},
          cron: "* * * * *",
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
      const syncDefinition = {
        schedulerId: "sync:check-stale",
        queue: "sync",
        name: "check-stale",
        data: {},
        cron: "*/5 * * * *",
      };
      const missingDefinition = {
        schedulerId: "missing:check-stale",
        queue: "missing",
        name: "check-stale",
        data: {},
        cron: "*/5 * * * *",
      };
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
      const forbidden = {
        schedulerId: "sync:conditional",
        queue: "sync",
        name: "conditional",
        data: {},
        cron: "*/5 * * * *",
      };
      syncQueue.getJobSchedulers.mockResolvedValueOnce([
        {
          name: "conditional",
          key: "sync:conditional",
          pattern: "*/5 * * * *",
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
};
