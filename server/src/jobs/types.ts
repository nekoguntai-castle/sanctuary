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
