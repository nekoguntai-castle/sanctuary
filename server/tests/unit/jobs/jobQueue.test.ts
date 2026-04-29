import { beforeEach, describe, expect, it, vi } from "vitest";
import { toBullMqJobId } from "../../../src/jobs/bullMqJobIds";

const queueInstances: any[] = [];
const workerInstances: any[] = [];
const queueEventsInstances: any[] = [];
let queueCtorError: Error | null = null;

class MockQueue {
  name: string;
  opts: any;
  add = vi.fn(async (name: string, data: any, options?: any) => ({
    id: `${name}-job`,
    name,
    data,
    opts: options,
  }));
  addBulk = vi.fn(
    async (jobs: Array<{ name: string; data: any; opts?: any }>) =>
      jobs.map((job, index) => ({
        id: `${job.name}-${index}`,
        name: job.name,
        data: job.data,
        opts: job.opts,
      })),
  );
  getRepeatableJobs = vi.fn(async () => []);
  getJob = vi.fn(async () => null);
  getWaitingCount = vi.fn(async () => 0);
  getActiveCount = vi.fn(async () => 0);
  getCompletedCount = vi.fn(async () => 0);
  getFailedCount = vi.fn(async () => 0);
  getDelayedCount = vi.fn(async () => 0);
  isPaused = vi.fn(async () => false);
  pause = vi.fn(async () => undefined);
  resume = vi.fn(async () => undefined);
  clean = vi.fn(async () => []);
  close = vi.fn(async () => undefined);

  constructor(name: string, opts: any) {
    if (queueCtorError) {
      throw queueCtorError;
    }
    this.name = name;
    this.opts = opts;
    queueInstances.push(this);
  }
}

class MockWorker {
  name: string;
  processor: any;
  opts: any;
  handlers: Record<string, any> = {};
  close = vi.fn(async () => undefined);

  constructor(name: string, processor: any, opts: any) {
    this.name = name;
    this.processor = processor;
    this.opts = opts;
    workerInstances.push(this);
  }

  on(event: string, handler: any) {
    this.handlers[event] = handler;
    return this;
  }
}

class MockQueueEvents {
  name: string;
  opts: any;
  close = vi.fn(async () => undefined);

  constructor(name: string, opts: any) {
    this.name = name;
    this.opts = opts;
    queueEventsInstances.push(this);
  }
}

const mockGetRedisClient = vi.fn();
const mockIsRedisConnected = vi.fn();

vi.mock("bullmq", () => ({
  Queue: MockQueue,
  Worker: MockWorker,
  QueueEvents: MockQueueEvents,
}));

vi.mock("../../../src/infrastructure", () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock("../../../src/utils/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("../../../src/utils/tracing", () => ({
  withSpan: vi.fn(
    async (
      _name: string,
      fn: (span: { setAttribute: (k: string, v: any) => void }) => any,
    ) => fn({ setAttribute: vi.fn() }),
  ),
}));

const loadJobQueueService = async (config: Record<string, any> = {}) => {
  const module = await import("../../../src/jobs/jobQueue");
  const instance = module.default;
  const JobQueueService = (instance as any).constructor;
  return new JobQueueService(config);
};

const createRedisClient = () => ({
  options: {
    host: "127.0.0.1",
    port: 6379,
    password: "secret",
    db: 2,
  },
});

describe("JobQueueService", () => {
  beforeEach(() => {
    queueInstances.length = 0;
    workerInstances.length = 0;
    queueEventsInstances.length = 0;
    queueCtorError = null;
    vi.clearAllMocks();
  });

  it("throws if Redis is not available", async () => {
    mockGetRedisClient.mockReturnValue(null);
    mockIsRedisConnected.mockReturnValue(false);
    const queue = await loadJobQueueService();

    await expect(queue.initialize()).rejects.toThrow("Redis not available");
  });

  it("initializes queue, worker, and events with config", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService({
      prefix: "test:jobs",
      concurrency: 7,
    });

    await queue.initialize();

    expect(queueInstances).toHaveLength(1);
    expect(workerInstances).toHaveLength(1);
    expect(queueEventsInstances).toHaveLength(1);

    expect(queueInstances[0].opts.prefix).toBe("test:jobs");
    expect(workerInstances[0].opts.prefix).toBe("test:jobs");
    expect(workerInstances[0].opts.concurrency).toBe(7);
  });

  it("is idempotent on repeated initialize calls and wires worker event handlers", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();

    await queue.initialize();
    await queue.initialize();

    expect(queueInstances).toHaveLength(1);
    expect(workerInstances).toHaveLength(1);
    expect(queueEventsInstances).toHaveLength(1);
    expect(Object.keys(workerInstances[0].handlers).sort()).toEqual([
      "completed",
      "error",
      "failed",
      "stalled",
    ]);

    workerInstances[0].handlers.completed({
      name: "done",
      id: "j-1",
      processedOn: 10,
      finishedOn: 20,
    });
    workerInstances[0].handlers.completed({
      name: "done-2",
      id: "j-2",
    });
    workerInstances[0].handlers.failed(
      { name: "bad", id: "j-3", attemptsMade: 2 },
      new Error("boom"),
    );
    workerInstances[0].handlers.failed(undefined, new Error("boom-2"));
    workerInstances[0].handlers.error(new Error("worker-failed"));
    workerInstances[0].handlers.stalled("stalled-1");
  });

  it("propagates initialize errors from BullMQ setup", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    queueCtorError = new Error("queue-ctor-failed");
    const queue = await loadJobQueueService();

    await expect(queue.initialize()).rejects.toThrow("queue-ctor-failed");
  });

  it("tracks processing count during handler execution", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();

    await queue.initialize();

    let resolveHandler: () => void;
    const handlerPromise = new Promise<void>((resolve) => {
      resolveHandler = resolve;
    });

    queue.register({
      name: "sample-job",
      handler: vi.fn(async () => handlerPromise),
    });

    const processor = workerInstances[0].processor;
    const job = { id: "job-1", name: "sample-job", attemptsMade: 0 };

    const runPromise = processor(job);
    expect(queue.getProcessingCount()).toBe(1);

    resolveHandler!();
    await runPromise;
    expect(queue.getProcessingCount()).toBe(0);
  });

  it("processes jobs with missing id using unknown span attribute fallback", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queue.register({
      name: "id-optional-job",
      handler: vi.fn(async () => ({ ok: true })),
    });

    const processor = workerInstances[0].processor;
    await expect(
      processor({ name: "id-optional-job", attemptsMade: 0 }),
    ).resolves.toEqual({ ok: true });
  });

  it("rejects unknown handlers and resets processing count when a handler throws", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const processor = workerInstances[0].processor;
    await expect(
      processor({ id: "missing", name: "missing-handler", attemptsMade: 0 }),
    ).rejects.toThrow("No handler registered for job: missing-handler");

    queue.register({
      name: "throwing-job",
      handler: vi.fn(async () => {
        throw new Error("handler-failed");
      }),
    });

    expect(queue.getProcessingCount()).toBe(0);
    await expect(
      processor({ id: "boom", name: "throwing-job", attemptsMade: 1 }),
    ).rejects.toThrow("handler-failed");
    expect(queue.getProcessingCount()).toBe(0);
  });

  it("returns null when adding a job without an initialized queue", async () => {
    const queue = await loadJobQueueService();
    const result = await queue.add("test", { ok: true });
    expect(result).toBeNull();
  });

  it("returns empty array when adding bulk jobs without an initialized queue", async () => {
    const queue = await loadJobQueueService();
    const result = await queue.addBulk([{ name: "test", data: { ok: true } }]);
    expect(result).toEqual([]);
  });

  it("adds jobs and handles add/addBulk errors", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const added = await queue.add(
      "send-email",
      { to: "user@example.com" },
      {
        attempts: 2,
        jobId: "send:email:user-1",
      },
    );
    expect(added?.id).toBe("send-email-job");
    expect(queueInstances[0].add).toHaveBeenCalledWith(
      "send-email",
      { to: "user@example.com" },
      { attempts: 2, jobId: toBullMqJobId("send:email:user-1") },
    );

    queueInstances[0].add.mockRejectedValueOnce(new Error("add failed"));
    await expect(
      queue.add("send-email", { to: "user@example.com" }),
    ).resolves.toBeNull();

    const bulkAdded = await queue.addBulk([
      { name: "a", data: { v: 1 } },
      { name: "b", data: { v: 2 }, options: { delay: 100, jobId: "bulk:b:2" } },
    ]);
    expect(bulkAdded).toHaveLength(2);
    expect(queueInstances[0].addBulk).toHaveBeenCalledWith([
      { name: "a", data: { v: 1 }, opts: undefined },
      {
        name: "b",
        data: { v: 2 },
        opts: { delay: 100, jobId: toBullMqJobId("bulk:b:2") },
      },
    ]);

    queueInstances[0].addBulk.mockRejectedValueOnce(
      new Error("addBulk failed"),
    );
    await expect(queue.addBulk([{ name: "a", data: {} }])).resolves.toEqual([]);
  });

  it("returns null when scheduling without an initialized queue", async () => {
    const queue = await loadJobQueueService();
    const result = await queue.schedule("cleanup", {}, { cron: "0 0 * * *" });
    expect(result).toBeNull();
  });

  it("skips scheduling when repeatable job already exists", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const repeatableId = toBullMqJobId("repeat:cleanup:0 0 * * *:UTC:limit=5");
    queueInstances[0].getRepeatableJobs.mockResolvedValue([
      { name: "cleanup", id: repeatableId },
    ]);

    const result = await queue.schedule(
      "cleanup",
      {},
      { cron: "0 0 * * *", timezone: "UTC", limit: 5 },
    );
    expect(result).toBeNull();
    expect(queueInstances[0].add).not.toHaveBeenCalled();
  });

  it("schedules cron jobs with deterministic jobId and repeat options", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    await queue.schedule(
      "cleanup",
      {},
      { cron: "0 0 * * *", timezone: "UTC", limit: 5 },
    );

    expect(queueInstances[0].add).toHaveBeenCalledWith(
      "cleanup",
      {},
      expect.objectContaining({
        jobId: toBullMqJobId("repeat:cleanup:0 0 * * *:UTC:limit=5"),
        repeat: {
          pattern: "0 0 * * *",
          tz: "UTC",
          limit: 5,
        },
      }),
    );
  });

  it("schedules cron jobs without timezone or limit using base repeat job id", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    await queue.schedule("hourly", {}, { cron: "0 * * * *" });

    expect(queueInstances[0].add).toHaveBeenCalledWith(
      "hourly",
      {},
      expect.objectContaining({
        jobId: toBullMqJobId("repeat:hourly:0 * * * *"),
        repeat: {
          pattern: "0 * * * *",
          tz: undefined,
          limit: undefined,
        },
      }),
    );
  });

  it("schedules one-off jobs with delay/explicit jobId and handles schedule errors", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    await queue.schedule(
      "once",
      { id: 1 },
      { delay: 5000, jobId: "custom-id" },
    );
    expect(queueInstances[0].add).toHaveBeenCalledWith(
      "once",
      { id: 1 },
      expect.objectContaining({
        delay: 5000,
        jobId: "custom-id",
      }),
    );

    queueInstances[0].add.mockRejectedValueOnce(new Error("schedule failed"));
    await expect(
      queue.schedule("broken", {}, { cron: "*/5 * * * *", timezone: "UTC" }),
    ).resolves.toBeNull();
  });

  it("returns job status details", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const job = {
      id: "job-123",
      name: "test",
      data: { value: 1 },
      progress: 25,
      returnvalue: { ok: true },
      failedReason: null,
      attemptsMade: 1,
      processedOn: 10,
      finishedOn: 20,
      getState: vi.fn(async () => "completed"),
    };

    queueInstances[0].getJob.mockResolvedValue(job);

    const status = await queue.getJobStatus("job-123");
    expect(status).toEqual({
      id: "job-123",
      name: "test",
      data: { value: 1 },
      status: "completed",
      progress: 25,
      returnvalue: { ok: true },
      failedReason: null,
      attemptsMade: 1,
      processedOn: 10,
      finishedOn: 20,
    });
  });

  it("returns null when getJob/getJobStatus fail or job is missing", async () => {
    const uninitialized = await loadJobQueueService();
    await expect(uninitialized.getJob("id-1")).resolves.toBeNull();
    await expect(uninitialized.getJobStatus("id-1")).resolves.toBeNull();

    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].getJob.mockRejectedValueOnce(new Error("lookup failed"));
    await expect(queue.getJob("id-2")).resolves.toBeNull();
    await expect(queue.getJobStatus("id-2")).resolves.toBeNull();
  });

  it("removes a job successfully and returns false when removal errors", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    const removable = {
      remove: vi.fn(async () => undefined),
    };
    queueInstances[0].getJob.mockResolvedValueOnce(removable);
    await expect(queue.removeJob("ok")).resolves.toBe(true);

    const failing = {
      remove: vi.fn(async () => {
        throw new Error("remove failed");
      }),
    };
    queueInstances[0].getJob.mockResolvedValueOnce(failing);
    await expect(queue.removeJob("bad")).resolves.toBe(false);
  });

  it("returns false when removing a missing job", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].getJob.mockResolvedValue(null);
    const result = await queue.removeJob("missing");
    expect(result).toBe(false);
  });

  it("reports health status from queue counts", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].getWaitingCount.mockResolvedValue(2);
    queueInstances[0].getActiveCount.mockResolvedValue(1);
    queueInstances[0].getCompletedCount.mockResolvedValue(3);
    queueInstances[0].getFailedCount.mockResolvedValue(4);
    queueInstances[0].getDelayedCount.mockResolvedValue(5);
    queueInstances[0].isPaused.mockResolvedValue(true);

    const health = await queue.getHealth();
    expect(health).toEqual({
      healthy: true,
      queueName: "main",
      waiting: 2,
      active: 1,
      completed: 3,
      failed: 4,
      delayed: 5,
      paused: true,
    });
  });

  it("returns unhealthy defaults when queue is unavailable or health calls fail", async () => {
    const uninitialized = await loadJobQueueService();
    await expect(uninitialized.getHealth()).resolves.toEqual({
      healthy: false,
      queueName: "main",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: false,
    });

    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].getWaitingCount.mockRejectedValueOnce(
      new Error("health failed"),
    );
    await expect(queue.getHealth()).resolves.toEqual({
      healthy: false,
      queueName: "main",
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: false,
    });
  });

  it("pauses/resumes/cleans queue and handles clean failures", async () => {
    const uninitialized = await loadJobQueueService();
    await uninitialized.pause();
    await uninitialized.resume();
    await expect(uninitialized.clean()).resolves.toEqual([]);

    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    queueInstances[0].clean.mockResolvedValueOnce(["job-1", "job-2"]);
    await queue.pause();
    await queue.resume();
    await expect(queue.clean(60000, 10, "failed")).resolves.toEqual([
      "job-1",
      "job-2",
    ]);

    queueInstances[0].clean.mockRejectedValueOnce(new Error("clean failed"));
    await expect(queue.clean()).resolves.toEqual([]);
  });

  it("tracks registered job names and overwrites duplicate handlers", async () => {
    const queue = await loadJobQueueService();
    queue.register({ name: "alpha", handler: vi.fn() });
    queue.register({ name: "beta", handler: vi.fn() });
    queue.register({ name: "alpha", handler: vi.fn() });
    expect(queue.getRegisteredJobs().sort()).toEqual(["alpha", "beta"]);
  });

  it("no-ops setupEventHandlers when worker is not initialized", async () => {
    const queue = await loadJobQueueService();
    expect(() => (queue as any).setupEventHandlers()).not.toThrow();
  });

  it("shuts down worker, events, and queue", async () => {
    mockGetRedisClient.mockReturnValue(createRedisClient());
    mockIsRedisConnected.mockReturnValue(true);
    const queue = await loadJobQueueService();
    await queue.initialize();

    expect(queue.isAvailable()).toBe(true);
    await queue.shutdown();

    expect(workerInstances[0].close).toHaveBeenCalled();
    expect(queueEventsInstances[0].close).toHaveBeenCalled();
    expect(queueInstances[0].close).toHaveBeenCalled();
    expect(queue.isAvailable()).toBe(false);
  });

  it("shuts down safely when queue components were never initialized", async () => {
    const queue = await loadJobQueueService();
    await expect(queue.shutdown()).resolves.toBeUndefined();
    expect(queue.isAvailable()).toBe(false);
  });
});
