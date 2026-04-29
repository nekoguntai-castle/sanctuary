import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  queueToDlqCategory,
  type WorkerJobQueueAccessor,
} from "./workerJobQueueTestHarness";
import { toBullMqJobId } from "../../../../src/jobs/bullMqJobIds";

export const registerWorkerJobQueueInternalBranchContracts = (
  getQueue: WorkerJobQueueAccessor,
) => {
  let queue: ReturnType<WorkerJobQueueAccessor>;

  beforeEach(() => {
    queue = getQueue();
  });

  it("covers add/addBulk/schedule error and duplicate branches", async () => {
    await queue.initialize();
    const syncQueue = (queue as any).queues.get("sync").queue;

    syncQueue.add.mockRejectedValueOnce(new Error("add failed"));
    await expect(queue.addJob("sync", "broken", {})).resolves.toBeNull();

    syncQueue.addBulk.mockRejectedValueOnce(new Error("bulk failed"));
    await expect(
      queue.addBulkJobs("sync", [{ name: "bulk", data: {} }]),
    ).resolves.toEqual([]);

    syncQueue.getRepeatableJobs.mockResolvedValueOnce([
      {
        name: "repeat-job",
        id: toBullMqJobId("repeat:sync:repeat-job:*/5 * * * *"),
      },
    ]);
    await expect(
      queue.scheduleRecurring("sync", "repeat-job", {}, "*/5 * * * *"),
    ).resolves.toBeNull();

    syncQueue.getRepeatableJobs.mockRejectedValueOnce(
      new Error("repeat failed"),
    );
    await expect(
      queue.scheduleRecurring("sync", "repeat-job", {}, "*/5 * * * *"),
    ).resolves.toBeNull();
  });

  it("reports unhealthy queue metrics when queue stats fail", async () => {
    await queue.initialize();
    const syncQueue = (queue as any).queues.get("sync").queue;
    syncQueue.getWaitingCount.mockRejectedValueOnce(new Error("health failed"));

    const health = await queue.getHealth();
    expect(health.healthy).toBe(false);
    expect(health.queues.sync).toEqual({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: false,
    });
  });

  it("returns false from isHealthy when a worker is not running", async () => {
    await queue.initialize();
    const syncWorker = (queue as any).queues.get("sync").worker;
    syncWorker.isRunning.mockReturnValueOnce(false);

    expect(queue.isHealthy()).toBe(false);
  });

  it("covers queue-to-DLQ category mapping and concurrent shutdown promise reuse", async () => {
    expect(queueToDlqCategory("sync")).toBe("sync");
    expect(queueToDlqCategory("notifications")).toBe("notification");
    expect(queueToDlqCategory("maintenance")).toBe("other");
    expect(queueToDlqCategory("confirmations")).toBe("sync");
    expect(queueToDlqCategory("other-queue")).toBe("other");

    await queue.initialize();
    const first = queue.shutdown();
    const second = queue.shutdown();
    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    expect(queue.isHealthy()).toBe(false);
  });
};
