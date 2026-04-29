import { Queue, type ConnectionOptions } from "bullmq";
import { getRedisClient, isRedisConnected } from "../infrastructure";
import { createLogger } from "../utils/logger";
import { getErrorMessage } from "../utils/errors";
import { toBullMqJobId } from "../jobs/bullMqJobIds";
import type { SyncWalletJobData } from "../worker/jobs/types";

const log = createLogger("WORKER_SYNC_QUEUE");

const WORKER_QUEUE_PREFIX = "sanctuary:worker";
const SYNC_QUEUE_NAME = "sync";

let syncQueue: Queue<SyncWalletJobData> | null = null;
let syncQueueConnectionKey: string | null = null;

function toBullPriority(priority: "high" | "normal" | "low"): number {
  switch (priority) {
    case "high":
      return 1;
    case "normal":
      return 2;
    case "low":
    default:
      return 3;
  }
}

function buildConnectionKey(connection: ConnectionOptions): string {
  // ConnectionOptions is a union; extract fields safely via type guard
  const opts = connection as Record<string, unknown>;
  return [
    (opts.host as string) ?? "",
    (opts.port as string) ?? "",
    (opts.db as string) ?? "",
    opts.password ? "auth" : "no-auth",
  ].join(":");
}

function getOrCreateSyncQueue(): Queue<SyncWalletJobData> | null {
  if (!isRedisConnected()) {
    return null;
  }

  const redis = getRedisClient();
  if (!redis) {
    return null;
  }

  const connection: ConnectionOptions = {
    host: redis.options.host,
    port: redis.options.port,
    password: redis.options.password,
    db: redis.options.db,
  };
  const connectionKey = buildConnectionKey(connection);

  if (syncQueue && syncQueueConnectionKey === connectionKey) {
    return syncQueue;
  }

  syncQueue = new Queue<SyncWalletJobData>(SYNC_QUEUE_NAME, {
    connection,
    prefix: WORKER_QUEUE_PREFIX,
  });
  syncQueueConnectionKey = connectionKey;

  return syncQueue;
}

export async function enqueueWalletSync(
  walletId: string,
  options: {
    priority?: "high" | "normal" | "low";
    reason?: string;
    delayMs?: number;
    jobId?: string;
  } = {},
): Promise<boolean> {
  const queue = getOrCreateSyncQueue();
  if (!queue) {
    log.warn("Worker sync queue unavailable, sync job not added", { walletId });
    return false;
  }

  const priority = options.priority ?? "normal";

  try {
    await queue.add(
      "sync-wallet",
      {
        walletId,
        priority,
        reason: options.reason,
      },
      {
        priority: toBullPriority(priority),
        delay: options.delayMs,
        jobId: options.jobId ? toBullMqJobId(options.jobId) : undefined,
      },
    );
    return true;
  } catch (error) {
    log.error("Failed to enqueue wallet sync", {
      walletId,
      error: getErrorMessage(error),
    });
    return false;
  }
}

export async function enqueueWalletSyncBatch(
  walletIds: string[],
  options: {
    priority?: "high" | "normal" | "low";
    reason?: string;
    staggerDelayMs?: number;
    jobIdPrefix?: string;
  } = {},
): Promise<number> {
  const queue = getOrCreateSyncQueue();
  if (!queue) {
    log.warn("Worker sync queue unavailable, batch sync jobs not added", {
      count: walletIds.length,
    });
    return 0;
  }

  if (walletIds.length === 0) {
    return 0;
  }

  const priority = options.priority ?? "normal";
  const staggerDelayMs = options.staggerDelayMs ?? 0;
  const batchId = `${options.jobIdPrefix ?? "manual-sync"}:${Date.now()}`;

  try {
    const jobs = await queue.addBulk(
      walletIds.map((walletId, index) => ({
        name: "sync-wallet",
        data: {
          walletId,
          priority,
          reason: options.reason,
        },
        opts: {
          priority: toBullPriority(priority),
          delay: index * staggerDelayMs,
          jobId: toBullMqJobId(`${batchId}:${walletId}`),
        },
      })),
    );

    return jobs.length;
  } catch (error) {
    log.error("Failed to enqueue wallet sync batch", {
      count: walletIds.length,
      error: getErrorMessage(error),
    });
    return 0;
  }
}

export async function closeWorkerSyncQueue(): Promise<void> {
  if (!syncQueue) return;

  await syncQueue.close();
  syncQueue = null;
  syncQueueConnectionKey = null;
}
