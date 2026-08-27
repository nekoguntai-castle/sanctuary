/**
 * Worker Job Queue Types
 */

import type { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';
import type { JobExecutionContext, JobLockOptions } from '../../jobs/types';

export interface WorkerJobQueueConfig {
  /** Worker concurrency per queue (default: 3) */
  concurrency: number;
  /** Optional queue-specific limits; unspecified queues use `concurrency`. */
  concurrencyByQueue?: Readonly<Record<string, number>>;
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
  validateData?: (data: unknown) => boolean;
  lockOptions?: JobLockOptions<unknown>;
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
