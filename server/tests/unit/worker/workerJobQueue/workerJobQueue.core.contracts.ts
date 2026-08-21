import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  WorkerJobQueue,
  createdWorkers,
  type WorkerJobHandler,
  type WorkerJobQueueAccessor,
} from "./workerJobQueueTestHarness";
import { toBullMqJobId } from "../../../../src/jobs/bullMqJobIds";

export const registerWorkerJobQueueCoreContracts = (
  getQueue: WorkerJobQueueAccessor,
) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
  });

  describe("constructor", () => {
    it("should create queue with provided config", () => {
      const customQueue = new WorkerJobQueue({
        concurrency: 5,
        queues: ["test"],
        prefix: "custom:prefix",
      });

      expect(customQueue).toBeDefined();
    });

    it("should use default prefix if not provided", () => {
      expect(queue).toBeDefined();
      // The default prefix 'sanctuary:worker' is set internally
    });
  });

  describe("initialize", () => {
    it("should create queues and workers", async () => {
      await queue.initialize();

      // Should have initialized successfully (no errors)
      expect(queue.isHealthy()).toBe(true);
    });

    it("keeps consumers stopped until explicitly started when autorun is disabled", async () => {
      const gatedQueue = new WorkerJobQueue({
        concurrency: 1,
        queues: ["maintenance"],
        autorun: false,
      });

      await gatedQueue.initialize();

      expect(createdWorkers).toHaveLength(1);
      expect(createdWorkers[0].options?.autorun).toBe(false);
      expect(gatedQueue.isHealthy()).toBe(false);
      expect(createdWorkers[0].run).not.toHaveBeenCalled();

      gatedQueue.startConsumers();

      expect(createdWorkers[0].run).toHaveBeenCalledOnce();
      expect(gatedQueue.isHealthy()).toBe(true);
      gatedQueue.startConsumers();
      expect(createdWorkers[0].run).toHaveBeenCalledOnce();
    });

    it("rejects consumer startup before queue initialization", () => {
      expect(() => queue.startConsumers()).toThrow(
        "Worker job queue must be initialized before consumers start",
      );
    });

    it("should not reinitialize if already initialized", async () => {
      await queue.initialize();
      const firstHealth = queue.isHealthy();

      await queue.initialize(); // Second call should be no-op
      const secondHealth = queue.isHealthy();

      expect(firstHealth).toBe(true);
      expect(secondHealth).toBe(true);
    });

    it("replaces the aborted execution signal when reinitialized after shutdown", async () => {
      await queue.initialize();
      await queue.shutdown();
      await queue.initialize();
      let observedSignal: AbortSignal | undefined;
      queue.registerHandler("sync", {
        name: "after-reinitialize",
        queue: "sync",
        handler: vi.fn(async (_job, execution) => {
          observedSignal = execution?.signal;
          return { processed: true };
        }),
      });

      await expect((queue as any).processJob("sync", {
        id: "job-after-reinitialize",
        name: "after-reinitialize",
        data: {},
      })).resolves.toEqual({ processed: true });
      expect(observedSignal?.aborted).toBe(false);
    });

    it("should throw if Redis is not connected", async () => {
      const { isRedisConnected } =
        await import("../../../../src/infrastructure");
      vi.mocked(isRedisConnected).mockReturnValueOnce(false);

      const newQueue = new WorkerJobQueue({
        concurrency: 1,
        queues: ["test"],
      });

      await expect(newQueue.initialize()).rejects.toThrow("Redis is required");
    });
  });

  describe("registerHandler", () => {
    it("reports handler registration only for the exact queue and job name", () => {
      expect(queue.hasRegisteredHandler("sync", "test-job")).toBe(false);

      queue.registerHandler("sync", {
        name: "test-job",
        queue: "sync",
        handler: vi.fn(),
      });

      expect(queue.hasRegisteredHandler("sync", "test-job")).toBe(true);
      expect(queue.hasRegisteredHandler("notifications", "test-job")).toBe(false);
      expect(queue.hasRegisteredHandler("sync", "other-job")).toBe(false);
    });

    it("should register a job handler", async () => {
      await queue.initialize();

      const handler: WorkerJobHandler<{ id: string }, { success: boolean }> = {
        name: "test-job",
        queue: "sync",
        handler: vi.fn().mockResolvedValue({ success: true }),
      };

      queue.registerHandler("sync", handler);

      expect(queue.getRegisteredJobs()).toContain("sync:test-job");
    });

    it("preserves payload validation when registering a handler", async () => {
      const handler = vi.fn();
      const validateData = vi.fn(() => false);

      queue.registerHandler("sync", {
        name: "validated-job",
        queue: "sync",
        handler,
        validateData,
      });

      await expect((queue as any).processJob("sync", {
        id: "invalid-job",
        name: "validated-job",
        data: { version: 2 },
      })).rejects.toMatchObject({
        name: "UnrecoverableError",
        message: "Unrecoverable job payload: invalid payload for sync:validated-job",
      });
      expect(validateData).toHaveBeenCalledWith({ version: 2 });
      expect(handler).not.toHaveBeenCalled();
    });

    it("should warn when overwriting existing handler", async () => {
      await queue.initialize();

      const handler: WorkerJobHandler<unknown, unknown> = {
        name: "test-job",
        queue: "sync",
        handler: vi.fn(),
      };

      queue.registerHandler("sync", handler);
      queue.registerHandler("sync", handler); // Register again

      // Should still work, just logs a warning
      expect(queue.getRegisteredJobs()).toContain("sync:test-job");
    });
  });

  describe("queue worker state", () => {
    it("reports only initialized, running queue workers", async () => {
      expect(queue.isQueueWorkerRunning("sync")).toBe(false);

      await queue.initialize();

      expect(queue.isQueueWorkerRunning("sync")).toBe(true);
      expect(queue.isQueueWorkerRunning("missing")).toBe(false);

      const syncWorker = (queue as any).queues.get("sync").worker;
      syncWorker.isRunning.mockReturnValue(false);
      expect(queue.isQueueWorkerRunning("sync")).toBe(false);
    });
  });

  describe("addJob", () => {
    it("should add a job to the queue", async () => {
      await queue.initialize();

      const job = await queue.addJob("sync", "test-job", { id: "123" });

      expect(job).toBeDefined();
    });

    it("should return null for non-existent queue", async () => {
      await queue.initialize();

      const job = await queue.addJob("nonexistent", "test-job", {});

      expect(job).toBeNull();
    });

    it("should pass job options", async () => {
      await queue.initialize();

      const job = await queue.addJob(
        "sync",
        "test-job",
        { id: "123" },
        {
          priority: 1,
          delay: 1000,
        },
      );

      expect(job).toBeDefined();
    });

    it("encodes custom job IDs before passing them to BullMQ", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;

      await queue.addJob(
        "sync",
        "test-job",
        { id: "123" },
        {
          jobId: "sync:wallet-1:startup",
        },
      );

      expect(syncQueue.add).toHaveBeenCalledWith(
        "test-job",
        { id: "123" },
        { jobId: toBullMqJobId("sync:wallet-1:startup") },
      );
    });

    it("merges registered handler defaults with explicit caller precedence", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      queue.registerHandler("sync", {
        name: "test-job",
        queue: "sync",
        options: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
          priority: 10,
        },
        handler: vi.fn(),
      });

      await queue.addJob("sync", "test-job", { id: "123" }, {
        attempts: 2,
        priority: 1,
        delay: 1000,
      });

      expect(syncQueue.add).toHaveBeenCalledWith(
        "test-job",
        { id: "123" },
        {
          attempts: 2,
          backoff: { type: "exponential", delay: 5000 },
          priority: 1,
          delay: 1000,
        },
      );
    });
  });

  describe("addBulkJobs", () => {
    it("should add multiple jobs at once", async () => {
      await queue.initialize();

      const jobs = await queue.addBulkJobs("sync", [
        { name: "job1", data: { id: "1" } },
        { name: "job2", data: { id: "2" } },
      ]);

      expect(jobs).toHaveLength(2);
    });

    it("passes BullMQ bulk options under opts with safe job IDs", async () => {
      await queue.initialize();
      const syncQueue = (queue as any).queues.get("sync").queue;
      queue.registerHandler("sync", {
        name: "sync-wallet",
        queue: "sync",
        options: {
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        },
        handler: vi.fn(),
      });

      await queue.addBulkJobs("sync", [
        {
          name: "sync-wallet",
          data: { walletId: "wallet-1" },
          options: {
            attempts: 4,
            delay: 100,
            jobId: "sync:stale:wallet-1",
          },
        },
      ]);

      expect(syncQueue.addBulk).toHaveBeenCalledWith([
        {
          name: "sync-wallet",
          data: { walletId: "wallet-1" },
          opts: {
            attempts: 4,
            backoff: { type: "exponential", delay: 5000 },
            delay: 100,
            jobId: toBullMqJobId("sync:stale:wallet-1"),
          },
        },
      ]);
    });

    it("should return empty array for non-existent queue", async () => {
      await queue.initialize();

      const jobs = await queue.addBulkJobs("nonexistent", [
        { name: "job1", data: {} },
      ]);

      expect(jobs).toEqual([]);
    });
  });
};
