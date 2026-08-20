/**
 * Worker Job Queue Types
 */

import type { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import type { JobExecutionContext, LockRetryBudgetExhaustedDetail } from '../jobs/types';

export interface WorkerJobQueueConfig {
  /** Worker concurrency per queue (default: 3) */
  concurrency: number;
  /** Queue names to create */
  queues: string[];
  /** Redis key prefix (default: 'sanctuary:worker') */
  prefix?: string;
  /** Default job options */
  defaultJobOptions?: JobsOptions;
  /** Whether BullMQ consumers start as soon as they are constructed (default: true). */
  autorun?: boolean;
}

export interface QueueInstance {
  queue: Queue;
  worker: Worker;
  events: QueueEvents;
}

export interface RegisteredHandler {
  handler: (
    job: import('bullmq').Job,
    execution?: JobExecutionContext
  ) => Promise<unknown>;
  options?: JobsOptions;
  lockOptions?: {
    lockKey: (data: unknown) => string;
    lockTtlMs?: number;
    retryDelayMsIfUnavailable?: (data: unknown) => number | null;
    /**
     * Wall-clock budget for re-delaying a job whose lock is held. Defaults to
     * the lock TTL, which by construction outlives one run of the guarded work,
     * so legitimate contention still waits. Past the budget the job fails
     * normally instead of re-delaying forever.
     */
    maxLockRetryWindowMs?: number | ((data: unknown) => number);
    /**
     * Record what giving up on lock contention means for the guarded resource.
     *
     * The budget is spent before the handler ever runs, so the processor knows
     * only that the job was abandoned. Only the handler's owner knows what
     * durable state that leaves behind. Failures here are logged and swallowed:
     * the give-up is what releases the deduplication key, and no bookkeeping
     * error may turn it back into an unbounded re-delay.
     */
    onLockRetryBudgetExhausted?: (
      data: unknown,
      detail: LockRetryBudgetExhaustedDetail,
    ) => Promise<void>;
  };
}

export type RecurringScheduleRecurrence =
  | { every: number }
  | { pattern: string; tz: 'UTC' };

export interface RecurringScheduleDefinition<T = unknown> {
  schedulerId: string;
  queue: string;
  name: string;
  data: T;
  recurrence: RecurringScheduleRecurrence;
  options?: Omit<JobsOptions, "repeat">;
  freshness?: {
    maxAgeMs: number;
    startupGraceMs: number;
  };
}

export type RecurringScheduleResult =
  | { status: "created" | "unchanged" }
  | { status: "failed"; error: string };

export type RecurringRemovalResult =
  | { status: "removed" | "absent" }
  | { status: "failed"; error: string };

export interface RecurringScheduleInspection {
  healthy: boolean;
  missing: string[];
  mismatched: string[];
  unexpected: string[];
  inspectionFailures: string[];
}
