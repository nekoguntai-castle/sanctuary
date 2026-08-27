/**
 * Job Queue Types
 *
 * Type definitions for the background job queue system.
 */

import type { Job, JobsOptions } from 'bullmq';

/**
 * Cooperative cancellation context for job handlers.
 *
 * Handlers should check it only between completed atomic side effects. It is
 * optional on handler signatures so existing direct callers remain compatible.
 */
export interface JobExecutionContext {
  signal: AbortSignal;
  throwIfAborted: () => void;
  /** Present only while this processor still owns the handler's distributed lock. */
  /** Ownership token is worker-internal and must never be logged or persisted. */
  readonly acquiredLock?: Readonly<{ key: string; token: string }>;
}

/** What the processor can tell a handler after giving up on lock contention. */
export interface LockRetryBudgetExhaustedDetail {
  lockKey: string;
  retryWindowMs: number;
  message: string;
  /** Whether the queue will retry the job after this failed attempt. */
  isFinalAttempt: boolean;
}

export interface PreLockJobCompletion {
  complete: true;
  result: unknown;
}

/** Distributed-lock behavior attached to a registered background job. */
export interface JobLockOptions<T = unknown> {
  lockKey: (data: T) => string;
  lockTtlMs?: number;
  /** Complete retired/invalid work before it can contend for a shared lock. */
  beforeLockAttempt?: (job: Job<T>) => Promise<PreLockJobCompletion | undefined>;
  retryDelayMsIfUnavailable?: (data: T) => number | null;
  maxLockRetryWindowMs?: number | ((data: T) => number);
  /** Resolve and, when needed, durably initialize this attempt's contention clock. */
  resolveLockRetryStartedAt?: (job: Job<T>) => Promise<number>;
  onLockRetryBudgetExhausted?: (
    data: unknown,
    detail: LockRetryBudgetExhaustedDetail,
  ) => Promise<void>;
}

/** Worker registration contract shared by job definitions and queue runtime. */
export interface WorkerJobHandler<T = unknown, R = void> {
  name: string;
  queue: 'sync' | 'notifications' | 'confirmations' | 'maintenance';
  handler: (job: Job<T>, execution?: JobExecutionContext) => Promise<R>;
  options?: JobsOptions;
  validateData?: (data: unknown) => boolean;
  lockOptions?: JobLockOptions<T>;
}

/**
 * Job definition for registering job handlers
 */
export interface JobDefinition<T = unknown, R = void> {
  /** Unique job name */
  name: string;
  /** Job handler function */
  handler: (job: Job<T>, execution?: JobExecutionContext) => Promise<R>;
  /** Default job options */
  options?: JobsOptions;
}

/**
 * Job queue configuration
 */
export interface JobQueueConfig {
  /** Queue name prefix */
  prefix?: string;
  /** Default job options */
  defaultJobOptions?: JobsOptions;
  /** Worker concurrency */
  concurrency?: number;
  /** Enable job removal on completion */
  removeOnComplete?: boolean | number;
  /** Enable job removal on failure */
  removeOnFail?: boolean | number;
}

/**
 * Job queue health status
 */
export interface QueueHealthStatus {
  healthy: boolean;
  queueName: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}

/**
 * Scheduled job options
 */
export interface ScheduleOptions {
  /** Cron expression for repeating jobs */
  cron?: string;
  /** Delay in milliseconds before first run */
  delay?: number;
  /** Timezone for cron expression */
  timezone?: string;
  /** Maximum number of runs */
  limit?: number;
  /** Optional job ID for idempotent scheduling */
  jobId?: string;
}

/**
 * Job result for tracking
 */
export interface JobResult<T = unknown> {
  id: string;
  name: string;
  data: T;
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress?: number;
  returnvalue?: unknown;
  failedReason?: string;
  attemptsMade: number;
  processedOn?: number;
  finishedOn?: number;
}
