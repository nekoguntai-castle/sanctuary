import { Queue, type ConnectionOptions } from "bullmq";
import { getRedisClient, isRedisConnected } from "../infrastructure";
import { createLogger } from "../utils/logger";
import { getErrorMessage } from "../utils/errors";
import { mapWithConcurrency } from "../utils/async";
import { toBullMqJobId } from "../jobs/bullMqJobIds";
import {
  DEFAULT_SYNC_PRIORITY,
  SYNC_PRIORITY_BULLMQ_PRIORITY,
  type SyncPriority,
} from "@sanctuary/shared/constants/sync";
import type { SyncWalletJobData } from "../worker/jobs/types";
import { reserveFullResyncGeneration } from "../repositories/resyncRepository";
import { SYNC_WALLET_JOB_OPTIONS } from "../worker/jobs/jobOptions";
import { isSyncWalletEnvelope } from "./deadLetterJobEnvelope";
import type { DeadLetterJobEnvelope } from "./deadLetterQueueTypes";

const log = createLogger("WORKER_SYNC_QUEUE");

const WORKER_QUEUE_PREFIX = "sanctuary:worker";
const SYNC_QUEUE_NAME = "sync";
const FULL_RESYNC_ENQUEUE_CONCURRENCY = 10;

let syncQueue: Queue<SyncWalletJobData> | null = null;
let syncQueueConnectionKey: string | null = null;

function toBullPriority(priority: SyncPriority): number {
  return SYNC_PRIORITY_BULLMQ_PRIORITY[priority];
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

/**
 * Accept a durable retry or its already-retained stable BullMQ identity.
 * False means the caller must release its DLQ claim.
 */
export async function enqueueDeadLetterJob(
  envelope: DeadLetterJobEnvelope,
  retryEntryId: string,
): Promise<boolean> {
  if (!retryEntryId || !isSyncWalletEnvelope(envelope)) {
    log.warn("Unsupported dead-letter job envelope", {
      retryEntryId,
      version: envelope.version,
      queue: envelope.queue,
      name: envelope.name,
    });
    return false;
  }
  const queue = getOrCreateSyncQueue();
  if (!queue) {
    log.warn("Worker sync queue unavailable, dead-letter job not added", {
      retryEntryId,
    });
    return false;
  }

  try {
    const {
      attempts,
      backoff,
      priority,
      removeOnComplete,
      removeOnFail,
    } = envelope.options;
    await queue.add(envelope.name, envelope.data, {
      ...SYNC_WALLET_JOB_OPTIONS,
      attempts: attempts ?? SYNC_WALLET_JOB_OPTIONS.attempts,
      backoff: backoff ?? SYNC_WALLET_JOB_OPTIONS.backoff,
      ...(priority !== undefined ? { priority } : {}),
      ...(removeOnComplete !== undefined ? { removeOnComplete } : {}),
      ...(removeOnFail !== undefined ? { removeOnFail } : {}),
      jobId: toBullMqJobId(`dead-letter-retry:${retryEntryId}`),
    });
    return true;
  } catch (error) {
    log.error("Failed to enqueue dead-letter sync job", {
      retryEntryId,
      error: getErrorMessage(error),
    });
    return false;
  }
}

export async function enqueueWalletSync(
  walletId: string,
  options: {
    priority?: SyncPriority;
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

  const priority = options.priority ?? DEFAULT_SYNC_PRIORITY;

  try {
    await queue.add(
      "sync-wallet",
      {
        walletId,
        priority,
        reason: options.reason,
      },
      {
        ...SYNC_WALLET_JOB_OPTIONS,
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

export interface FullResyncEnqueueResult {
  outcomes: FullResyncWalletEnqueueOutcome[];
  acceptedWalletIds: string[];
  deduplicatedWalletIds: string[];
  rejectedWallets: Array<{
    walletId: string;
    reason: FullResyncRejectionReason;
  }>;
  indeterminateWallets: Array<{
    walletId: string;
    reason: FullResyncIndeterminateReason;
  }>;
}

export type FullResyncRejectionReason =
  | "queue_unavailable"
  | "queue_error";

export type FullResyncIndeterminateReason = "queue_state_unknown";

export type FullResyncWalletEnqueueOutcome =
  | { walletId: string; status: "accepted" | "deduplicated" }
  | {
      walletId: string;
      status: "rejected";
      reason: FullResyncRejectionReason;
    }
  | {
      walletId: string;
      status: "indeterminate";
      reason: FullResyncIndeterminateReason;
    };

const FULL_RESYNC_PRESTART_STATES = new Set([
  "delayed",
  "prioritized",
  "waiting",
  "waiting-children",
]);

function indeterminateFullResyncOutcome(
  walletId: string,
): FullResyncWalletEnqueueOutcome {
  return { walletId, status: "indeterminate", reason: "queue_state_unknown" };
}

async function reconcileFullResyncEnqueue(
  queue: Queue<SyncWalletJobData>,
  walletId: string,
  candidateJobId: string,
  deduplicationId: string,
): Promise<FullResyncWalletEnqueueOutcome> {
  const [candidateLookup, deduplicationLookup] = await Promise.allSettled([
    queue.getJob(candidateJobId),
    queue.getDeduplicationJobId(deduplicationId),
  ]);
  if (candidateLookup.status === "fulfilled" && candidateLookup.value) {
    return { walletId, status: "accepted" };
  }
  if (candidateLookup.status === "rejected" || deduplicationLookup.status === "rejected") {
    return indeterminateFullResyncOutcome(walletId);
  }

  const retainedJobId = deduplicationLookup.value;
  if (!retainedJobId) {
    return { walletId, status: "rejected", reason: "queue_error" };
  }
  if (retainedJobId === candidateJobId) {
    return indeterminateFullResyncOutcome(walletId);
  }

  const retainedJobLookup = await Promise.allSettled([queue.getJob(retainedJobId)]);
  const retainedJob = retainedJobLookup[0];
  if (retainedJob.status === "rejected" || !retainedJob.value) {
    return indeterminateFullResyncOutcome(walletId);
  }

  const stateLookup = await Promise.allSettled([retainedJob.value.getState()]);
  const state = stateLookup[0];
  return state.status === "fulfilled" && FULL_RESYNC_PRESTART_STATES.has(state.value)
    ? { walletId, status: "deduplicated" }
    : indeterminateFullResyncOutcome(walletId);
}

async function enqueueFullResyncWallet(
  queue: Queue<SyncWalletJobData>,
  walletId: string,
  reason: string,
  delayMs: number,
): Promise<FullResyncWalletEnqueueOutcome> {
  let fullResyncGeneration: number;
  try {
    fullResyncGeneration = await reserveFullResyncGeneration(walletId);
  } catch (error) {
    log.error("Failed to reserve full wallet resync generation", {
      walletId,
      error: getErrorMessage(error),
    });
    return { walletId, status: "rejected", reason: "queue_error" };
  }
  const candidateJobId = toBullMqJobId(
    `full-resync-attempt:${walletId}:${fullResyncGeneration}`,
  );
  const deduplicationId = toBullMqJobId(`full-resync:${walletId}`);
  try {
    const job = await queue.add(
      "sync-wallet",
      {
        walletId,
        priority: "high",
        reason,
        fullResync: true,
        fullResyncGeneration,
      },
      {
        ...SYNC_WALLET_JOB_OPTIONS,
        priority: toBullPriority("high"),
        delay: delayMs,
        jobId: candidateJobId,
        // Waiting/delayed work deduplicates normally. If the retained job is
        // already active, BullMQ stores this candidate as the single successor
        // so a request arriving after reset preparation cannot be lost.
        deduplication: { id: deduplicationId, keepLastIfActive: true },
      },
    );
    return {
      walletId,
      // BullMQ returns the retained job ID when deduplication wins, but the Job
      // instance still contains this candidate's submitted data.
      status: job.id === candidateJobId
        ? "accepted"
        : "deduplicated",
    };
  } catch (error) {
    log.error("Failed to enqueue full wallet resync", {
      walletId,
      error: getErrorMessage(error),
    });
    return reconcileFullResyncEnqueue(
      queue,
      walletId,
      candidateJobId,
      deduplicationId,
    );
  }
}

export async function enqueueFullResyncBatch(
  walletIds: string[],
  options: {
    reason: string;
    staggerDelayMs?: number;
  },
): Promise<FullResyncEnqueueResult> {
  const queue = getOrCreateSyncQueue();
  const outcomes = queue
    ? await mapWithConcurrency(walletIds, (walletId, index) => (
      enqueueFullResyncWallet(
        queue,
        walletId,
        options.reason,
        index * (options.staggerDelayMs ?? 0),
      )
    ), FULL_RESYNC_ENQUEUE_CONCURRENCY)
    : walletIds.map(walletId => ({
      walletId,
      status: "rejected" as const,
      reason: "queue_unavailable" as const,
    }));

  return {
    outcomes,
    acceptedWalletIds: outcomes
      .filter(outcome => outcome.status === "accepted")
      .map(outcome => outcome.walletId),
    deduplicatedWalletIds: outcomes
      .filter(outcome => outcome.status === "deduplicated")
      .map(outcome => outcome.walletId),
    rejectedWallets: outcomes
      .filter((outcome): outcome is Extract<
        FullResyncWalletEnqueueOutcome,
        { status: "rejected" }
      > => outcome.status === "rejected")
      .map(({ walletId, reason }) => ({ walletId, reason })),
    indeterminateWallets: outcomes
      .filter((outcome): outcome is Extract<
        FullResyncWalletEnqueueOutcome,
        { status: "indeterminate" }
      > => outcome.status === "indeterminate")
      .map(({ walletId, reason }) => ({ walletId, reason })),
  };
}

export async function enqueueWalletSyncBatch(
  walletIds: string[],
  options: {
    priority?: SyncPriority;
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

  const priority = options.priority ?? DEFAULT_SYNC_PRIORITY;
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
          ...SYNC_WALLET_JOB_OPTIONS,
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
