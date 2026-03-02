/**
 * Worker Job Queue Types
 */

import type { Queue, Worker, QueueEvents, JobsOptions } from 'bullmq';

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
  handler: (job: import('bullmq').Job) => Promise<unknown>;
  lockOptions?: {
    lockKey: (data: unknown) => string;
    lockTtlMs?: number;
  };
}
