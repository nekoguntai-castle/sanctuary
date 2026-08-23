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
import type { SyncWalletJobData } from "../jobs/syncJobContract";
import {
  isFullResyncGenerationProcessed,
  reserveFullResyncGeneration,
} from "../repositories/resyncRepository";
import { isFullResyncGeneration } from "../constants/fullResync";
import { WALLET_SYNC_MUTATION_FENCE_FLOOR } from "../constants/walletSyncActivation";
import {
  SYNC_JOB_CONTRACT_VERSION,
  SYNC_QUEUE_NAME,
  SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
  SYNC_WALLET_JOB_NAME,
  SYNC_WALLET_JOB_READER_VERSION,
  SYNC_WALLET_JOB_OPTIONS,
  getSyncLockTtlMs,
  readSyncWalletJobData,
} from "../jobs/syncJobContract";
import { isSyncWalletEnvelope } from "./deadLetterJobEnvelope";
import type { DeadLetterJobEnvelope } from "./deadLetterQueueTypes";
import { classifyStaleWalletScheduleJob } from "../jobs/staleWalletJobPolicy";
import { readStaleWalletSchedulePolicy } from "../repositories/walletSyncSchedulePolicyRepository";

const log = createLogger("WORKER_SYNC_QUEUE");

const WORKER_QUEUE_PREFIX = "sanctuary:worker";
const FULL_RESYNC_ENQUEUE_CONCURRENCY = 10;

export interface IncrementalSyncWakeup {
  walletId: string;
  generation: number;
  /** Stable, BullMQ-safe identity supplied by durable admission. */
  jobId: string;
}

export interface ReservedFullResyncWakeup {
  walletId: string;
  generation: number;
  incrementalGeneration: number;
  reason?: string;
}

function resetReplayContentionClock(data: unknown): SyncWalletJobData {
  const normalized = readSyncWalletJobData(data);
  if (
    normalized?.version !== SYNC_WALLET_JOB_READER_VERSION
    && normalized?.version !== SYNC_WALLET_MUTATION_FENCE_JOB_VERSION
  ) {
    return data as SyncWalletJobData;
  }
  const { lockContention: _retiredClock, ...withoutContentionClock } = normalized;
  return withoutContentionClock;
}

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
  const staleClassification = classifyStaleWalletScheduleJob({
    name: envelope.name,
    jobId: envelope.jobId,
    data: envelope.data,
  });
  if (staleClassification === "indeterminate") {
    log.warn("Indeterminate dead-letter sync job is not replayable", {
      retryEntryId,
      jobId: envelope.jobId,
    });
    return false;
  }
  if (
    staleClassification === "stale"
    && (await readStaleWalletSchedulePolicy()).mode === "forbidden"
  ) {
    log.warn("Retired stale-wallet dead-letter job is not replayable", {
      retryEntryId,
      jobId: envelope.jobId,
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
    const replayData = resetReplayContentionClock(envelope.data);
    const logicalReplayId = staleClassification === "stale"
      ? `sync:stale:dead-letter-retry:${retryEntryId}`
      : `dead-letter-retry:${retryEntryId}`;
    await queue.add(envelope.name, replayData, {
      ...SYNC_WALLET_JOB_OPTIONS,
      attempts: attempts ?? SYNC_WALLET_JOB_OPTIONS.attempts,
      backoff: backoff ?? SYNC_WALLET_JOB_OPTIONS.backoff,
      ...(priority !== undefined ? { priority } : {}),
      ...(removeOnComplete !== undefined ? { removeOnComplete } : {}),
      ...(removeOnFail !== undefined ? { removeOnFail } : {}),
      jobId: toBullMqJobId(logicalReplayId),
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
      SYNC_WALLET_JOB_NAME,
      {
        version: SYNC_JOB_CONTRACT_VERSION,
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

/**
 * Add one generation-bound incremental wake-up. Durable admission remains the
 * authority; this queue entry carries no claim or reusable lock credential.
 */
export async function enqueueIncrementalSyncWakeup(
  wakeup: IncrementalSyncWakeup,
): Promise<boolean> {
  const data = {
    version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
    walletId: wakeup.walletId,
    incrementalSyncGeneration: wakeup.generation,
    requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  } as const;
  if (!wakeup.jobId || readSyncWalletJobData(data) === null) {
    log.warn("Invalid incremental wallet sync wake-up", {
      walletId: wakeup.walletId,
      generation: wakeup.generation,
    });
    return false;
  }

  const queue = getOrCreateSyncQueue();
  if (!queue) {
    log.warn("Worker sync queue unavailable, incremental wake-up not added", {
      walletId: wakeup.walletId,
      generation: wakeup.generation,
    });
    return false;
  }

  const existing = await prepareIncrementalSyncCandidate(queue, wakeup);
  if (existing === "live") return true;
  if (existing !== "ready") return false;

  try {
    const job = await queue.add(
      SYNC_WALLET_JOB_NAME,
      data,
      {
        ...SYNC_WALLET_JOB_OPTIONS,
        jobId: wakeup.jobId,
      },
    );
    return job.id === wakeup.jobId
      && isIncrementalWakeupAcceptedState(await job.getState());
  } catch (error) {
    log.error("Failed to enqueue incremental wallet sync wake-up", {
      walletId: wakeup.walletId,
      generation: wakeup.generation,
      error: getErrorMessage(error),
    });
    return false;
  }
}

/**
 * Repair one already-reserved full-resync generation without allocating a new
 * generation. This is intentionally separate from the operator-request path.
 */
export async function enqueueReservedFullResyncWakeup(
  wakeup: ReservedFullResyncWakeup,
): Promise<boolean> {
  const reason = wakeup.reason ?? "reconcile-stranded-full-resync";
  const data = {
    version: SYNC_WALLET_MUTATION_FENCE_JOB_VERSION,
    walletId: wakeup.walletId,
    priority: "high",
    reason,
    fullResync: true,
    fullResyncGeneration: wakeup.generation,
    incrementalSyncGeneration: wakeup.incrementalGeneration,
    requiredMutationFenceFloor: WALLET_SYNC_MUTATION_FENCE_FLOOR,
  } as const;
  if (
    wakeup.walletId.trim().length === 0
    || !isFullResyncGeneration(wakeup.generation)
    || readSyncWalletJobData(data) === null
  ) {
    log.warn("Invalid reserved full-resync wake-up", {
      walletId: wakeup.walletId,
      generation: wakeup.generation,
    });
    return false;
  }

  const queue = getOrCreateSyncQueue();
  if (!queue) return false;

  const candidateJobId = toBullMqJobId(
    `full-resync-attempt:${wakeup.walletId}:${wakeup.generation}`,
  );
  const deduplicationId = toBullMqJobId(`full-resync:${wakeup.walletId}`);
  const existing = await prepareReservedFullResyncCandidate(
    queue,
    wakeup.walletId,
    wakeup.generation,
    wakeup.incrementalGeneration,
    candidateJobId,
  );
  if (existing === "live") return true;
  if (existing !== "ready") return false;
  try {
    const job = await queue.add(SYNC_WALLET_JOB_NAME, data, {
      ...SYNC_WALLET_JOB_OPTIONS,
      priority: toBullPriority("high"),
      jobId: candidateJobId,
      deduplication: { id: deduplicationId, ttl: getSyncLockTtlMs() },
    });
    if (job.id === candidateJobId) {
      return FULL_RESYNC_LIVE_STATES.has(await job.getState());
    }
    return typeof job.id === "string" && await retainedFullResyncWakeupExists(
      queue,
      wakeup.walletId,
      wakeup.generation,
      wakeup.incrementalGeneration,
      job.id,
      deduplicationId,
    );
  } catch (error) {
    log.error("Failed to enqueue reserved full resync", {
      walletId: wakeup.walletId,
      generation: wakeup.generation,
      incrementalGeneration: wakeup.incrementalGeneration,
      error: getErrorMessage(error),
    });
    return reconcileReservedFullResyncWakeup(
      queue,
      wakeup.walletId,
      wakeup.generation,
      wakeup.incrementalGeneration,
      candidateJobId,
      deduplicationId,
    );
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
const FULL_RESYNC_LIVE_STATES = new Set([...FULL_RESYNC_PRESTART_STATES, "active"]);

function isIncrementalWakeupAcceptedState(state: string): boolean {
  return FULL_RESYNC_LIVE_STATES.has(state) || state === "completed";
}

async function prepareIncrementalSyncCandidate(
  queue: Queue<SyncWalletJobData>,
  wakeup: IncrementalSyncWakeup,
): Promise<"live" | "ready" | "unavailable"> {
  try {
    const existing = await queue.getJob(wakeup.jobId);
    if (!existing) return "ready";
    const data = readSyncWalletJobData(existing.data);
    if (
      (
        data?.version !== SYNC_WALLET_JOB_READER_VERSION
        && data?.version !== SYNC_WALLET_MUTATION_FENCE_JOB_VERSION
      )
      || data.walletId !== wakeup.walletId
      || data.incrementalSyncGeneration !== wakeup.generation
    ) return "unavailable";
    const state = await existing.getState();
    if (FULL_RESYNC_LIVE_STATES.has(state)) return "live";
    if (state !== "failed" && state !== "completed") return "unavailable";
    await existing.remove();
    return "ready";
  } catch {
    return "unavailable";
  }
}

async function prepareReservedFullResyncCandidate(
  queue: Queue<SyncWalletJobData>,
  walletId: string,
  generation: number,
  incrementalGeneration: number,
  candidateJobId: string,
): Promise<"live" | "ready" | "unavailable"> {
  try {
    const existing = await queue.getJob(candidateJobId);
    if (!existing) return "ready";
    const data = readSyncWalletJobData(existing.data);
    if (
      data?.walletId !== walletId
      || data.fullResync !== true
      || data.fullResyncGeneration !== generation
    ) return "unavailable";
    const state = await existing.getState();
    if (FULL_RESYNC_LIVE_STATES.has(state)) {
      return data.incrementalSyncGeneration === incrementalGeneration
        ? "live"
        : "unavailable";
    }
    if (state === "completed") {
      if (await isFullResyncGenerationProcessed(walletId, generation)) return "live";
    } else if (state !== "failed") {
      return "unavailable";
    }
    await existing.remove();
    return "ready";
  } catch {
    return "unavailable";
  }
}

function indeterminateFullResyncOutcome(
  walletId: string,
): FullResyncWalletEnqueueOutcome {
  return { walletId, status: "indeterminate", reason: "queue_state_unknown" };
}

/**
 * Drop a deduplication key that outlived its job. BullMQ only reaps the key when
 * the job it names finalizes, so a key naming a job that no longer exists would
 * block every later resync request for that wallet.
 */
async function releaseStaleDeduplicationKey(
  queue: Queue<SyncWalletJobData>,
  walletId: string,
  deduplicationId: string,
): Promise<void> {
  try {
    await queue.removeDeduplicationKey(deduplicationId);
  } catch (error) {
    log.warn("Failed to release stale full-resync deduplication key", {
      walletId,
      error: getErrorMessage(error),
    });
  }
}

async function retainedFullResyncWakeupExists(
  queue: Queue<SyncWalletJobData>,
  walletId: string,
  generation: number,
  incrementalGeneration: number,
  retainedJobId: string,
  deduplicationId: string,
): Promise<boolean> {
  try {
    const retainedJob = await queue.getJob(retainedJobId);
    if (!retainedJob) {
      await releaseStaleDeduplicationKey(queue, walletId, deduplicationId);
      return false;
    }
    const data = readSyncWalletJobData(retainedJob.data);
    if (
      data?.walletId !== walletId
      || data.fullResync !== true
      || data.fullResyncGeneration !== generation
      || data.incrementalSyncGeneration !== incrementalGeneration
    ) return false;
    return FULL_RESYNC_LIVE_STATES.has(await retainedJob.getState());
  } catch {
    return false;
  }
}

async function reconcileReservedFullResyncWakeup(
  queue: Queue<SyncWalletJobData>,
  walletId: string,
  generation: number,
  incrementalGeneration: number,
  candidateJobId: string,
  deduplicationId: string,
): Promise<boolean> {
  try {
    const candidate = await queue.getJob(candidateJobId);
    if (candidate) {
      const data = readSyncWalletJobData(candidate.data);
      return data?.walletId === walletId
        && data.fullResync === true
        && data.fullResyncGeneration === generation
        && data.incrementalSyncGeneration === incrementalGeneration
        && FULL_RESYNC_LIVE_STATES.has(await candidate.getState());
    }
    const retainedJobId = await queue.getDeduplicationJobId(deduplicationId);
    if (!retainedJobId) return false;
    return retainedFullResyncWakeupExists(
      queue,
      walletId,
      generation,
      incrementalGeneration,
      retainedJobId,
      deduplicationId,
    );
  } catch {
    return false;
  }
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
    // The key names this candidate, which the lookup above proved absent.
    await releaseStaleDeduplicationKey(queue, walletId, deduplicationId);
    return indeterminateFullResyncOutcome(walletId);
  }

  const retainedJobLookup = await Promise.allSettled([queue.getJob(retainedJobId)]);
  const retainedJob = retainedJobLookup[0];
  if (retainedJob.status === "rejected") {
    return indeterminateFullResyncOutcome(walletId);
  }
  if (!retainedJob.value) {
    await releaseStaleDeduplicationKey(queue, walletId, deduplicationId);
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
      SYNC_WALLET_JOB_NAME,
      {
        version: SYNC_JOB_CONTRACT_VERSION,
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
        // The key must expire on its own: BullMQ otherwise reaps it only when
        // the job it names finalizes, so one wedged job would block this wallet
        // forever. `keepLastIfActive` is deliberately absent - BullMQ ignores
        // `ttl` alongside it, and it stores a successor only while the retained
        // job is active, which a lock-contended job almost never is.
        deduplication: { id: deduplicationId, ttl: getSyncLockTtlMs() },
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
        name: SYNC_WALLET_JOB_NAME,
        data: {
          version: SYNC_JOB_CONTRACT_VERSION,
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
