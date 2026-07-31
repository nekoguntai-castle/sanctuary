/**
 * Worker Job Queue Types
 */

import type { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import type { JobExecutionContext } from '../jobs/types';

export interface WorkerJobQueueConfig {
  /** Worker concurrency per queue (default: 3) */
  concurrency: number;
  /** Queue names to create */
  queues: string[];
  /** Redis key prefix (default: 'sanctuary:worker') */
  prefix?: string;
  /** Default job options */
  defaultJobOptions?: JobsOptions;
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
