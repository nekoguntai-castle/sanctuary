/**
 * Job Queue Service
 *
 * Background job processing using BullMQ with Redis.
 * Supports job scheduling, retries, and monitoring.
 *
 * ## Features
 *
 * - Redis-backed persistent job storage
 * - Automatic retries with exponential backoff
 * - Scheduled and recurring jobs (cron)
 * - Job progress tracking
 * - Health monitoring
 *
 * ## Usage
 *
 * ```typescript
 * import { jobQueue } from './jobs/jobQueue';
 *
 * // Register job handler
 * jobQueue.register({
 *   name: 'send-email',
 *   handler: async (job) => {
 *     await sendEmail(job.data.to, job.data.subject);
 *   },
 *   options: { attempts: 3 },
 * });
 *
 * // Add job to queue
 * await jobQueue.add('send-email', { to: 'user@example.com', subject: 'Hello' });
 *
 * // Schedule recurring job
 * await jobQueue.schedule('cleanup', {}, { cron: '0 0 * * *' }); // Daily at midnight
 * ```
 */

import {
  Queue,
  Worker,
  Job,
  QueueEvents,
  type ConnectionOptions,
  type JobsOptions,
} from "bullmq";
import { getRedisClient, isRedisConnected } from "../infrastructure";
import { createLogger } from "../utils/logger";
import { getErrorMessage } from "../utils/errors";
import { withSpan } from "../utils/tracing";
import { toBullMqJobId, withBullMqSafeJobId } from "./bullMqJobIds";
import type {
  JobDefinition,
  JobQueueConfig,
  QueueHealthStatus,
  ScheduleOptions,
  JobResult,
} from "./types";

const log = createLogger("JOB:QUEUE");

// Default configuration
const DEFAULT_CONFIG: Required<JobQueueConfig> = {
  prefix: "sanctuary:jobs",
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: 500, // Keep last 500 completed jobs
    removeOnFail: 250, // Keep last 250 failed jobs
  },
  concurrency: 3,
  removeOnComplete: 500,
  removeOnFail: 250,
};

function buildRepeatableJobId(
  name: string,
  scheduleOptions: ScheduleOptions,
): string {
  // Called only for cron schedules, so cron is always defined here.
  const parts = [name, scheduleOptions.cron!];
  if (scheduleOptions.timezone) parts.push(scheduleOptions.timezone);
  if (scheduleOptions.limit !== undefined)
    parts.push(`limit=${scheduleOptions.limit}`);
  return `repeat:${parts.join(":")}`;
}

class JobQueueService {
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private queueEvents: QueueEvents | null = null;
  private handlers: Map<string, JobDefinition["handler"]> = new Map();
  private config: Required<JobQueueConfig>;
  private initialized = false;
  private processingJobs = 0;

  constructor(config: JobQueueConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize the job queue
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const redisClient = getRedisClient();
    if (!redisClient || !isRedisConnected()) {
      throw new Error("Redis not available, job queue requires Redis");
    }

    try {
      // Create connection options (BullMQ needs its own connection)
      const connection: ConnectionOptions = {
        host: redisClient.options.host,
        port: redisClient.options.port,
        password: redisClient.options.password,
        db: redisClient.options.db,
      };

      // Create queue
      this.queue = new Queue("main", {
        connection,
        prefix: this.config.prefix,
        defaultJobOptions: this.config.defaultJobOptions,
      });

      // Create worker
      this.worker = new Worker(
        "main",
        async (job) => {
          const handler = this.handlers.get(job.name);
          if (!handler) {
            throw new Error(`No handler registered for job: ${job.name}`);
          }

          this.processingJobs++;
          try {
            // Wrap job execution in a trace span
            return await withSpan(`job.${job.name}`, async (span) => {
              span.setAttribute("job.id", job.id || "unknown");
              span.setAttribute("job.name", job.name);
              span.setAttribute("job.attemptsMade", job.attemptsMade);
              return await handler(job);
            });
          } finally {
            this.processingJobs--;
          }
        },
        {
          connection,
          prefix: this.config.prefix,
          concurrency: this.config.concurrency,
        },
      );

      // Create queue events for monitoring
      this.queueEvents = new QueueEvents("main", {
        connection,
        prefix: this.config.prefix,
      });

      // Set up event handlers
      this.setupEventHandlers();

      this.initialized = true;
      log.info("Job queue initialized", {
        prefix: this.config.prefix,
        concurrency: this.config.concurrency,
      });
    } catch (error) {
      log.error("Failed to initialize job queue", {
        error: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Set up event handlers for logging and monitoring
   */
  private setupEventHandlers(): void {
    if (!this.worker) return;

    this.worker.on("completed", (job) => {
      log.debug("Job completed", {
        name: job.name,
        id: job.id,
        duration:
          job.finishedOn && job.processedOn
            ? job.finishedOn - job.processedOn
            : undefined,
      });
    });

    this.worker.on("failed", (job, error) => {
      log.error("Job failed", {
        name: job?.name,
        id: job?.id,
        error: error.message,
        attemptsMade: job?.attemptsMade,
      });
    });

    this.worker.on("error", (error) => {
      log.error("Worker error", { error: error.message });
    });

    this.worker.on("stalled", (jobId) => {
      log.warn("Job stalled", { jobId });
    });
  }

  /**
   * Register a job handler
   */
  register(definition: JobDefinition<any, any>): void {
    if (this.handlers.has(definition.name)) {
      log.warn("Overwriting existing job handler", { name: definition.name });
    }

    this.handlers.set(definition.name, definition.handler);
    log.debug("Registered job handler", { name: definition.name });
  }

  /**
   * Add a job to the queue
   */
  async add<T>(
    name: string,
    data: T,
    options?: JobsOptions,
  ): Promise<Job<T> | null> {
    if (!this.queue) {
      log.warn("Queue not available, job not added", { name });
      return null;
    }

    try {
      const job = await this.queue.add(
        name,
        data,
        withBullMqSafeJobId(options),
      );
      log.debug("Job added", { name, id: job.id });
      return job;
    } catch (error) {
      log.error("Failed to add job", { name, error: getErrorMessage(error) });
      return null;
    }
  }

  /**
   * Add multiple jobs in bulk
   */
  async addBulk<T>(
    jobs: Array<{ name: string; data: T; options?: JobsOptions }>,
  ): Promise<Job<T>[]> {
    if (!this.queue) {
      log.warn("Queue not available, jobs not added");
      return [];
    }

    try {
      const result = await this.queue.addBulk(
        jobs.map((job) => ({
          name: job.name,
          data: job.data,
          opts: withBullMqSafeJobId(job.options),
        })),
      );
      log.debug("Bulk jobs added", { count: result.length });
      return result;
    } catch (error) {
      log.error("Failed to add bulk jobs", { error: getErrorMessage(error) });
      return [];
    }
  }

  /**
   * Schedule a job (with cron or delay)
   */
  async schedule<T>(
    name: string,
    data: T,
    scheduleOptions: ScheduleOptions,
  ): Promise<Job<T> | null> {
    if (!this.queue) {
      log.warn("Queue not available, job not scheduled", { name });
      return null;
    }

    const jobOptions: JobsOptions = {};

    if (scheduleOptions.cron) {
      jobOptions.repeat = {
        pattern: scheduleOptions.cron,
        tz: scheduleOptions.timezone,
        limit: scheduleOptions.limit,
      };
      jobOptions.jobId = toBullMqJobId(
        scheduleOptions.jobId || buildRepeatableJobId(name, scheduleOptions),
      );
    }

    if (scheduleOptions.delay) {
      jobOptions.delay = scheduleOptions.delay;
    }

    if (!jobOptions.jobId && scheduleOptions.jobId) {
      jobOptions.jobId = toBullMqJobId(scheduleOptions.jobId);
    }

    try {
      if (scheduleOptions.cron && jobOptions.jobId) {
        const repeatableJobs = await this.queue.getRepeatableJobs();
        const existing = repeatableJobs.find(
          (job) => job.name === name && job.id === jobOptions.jobId,
        );
        if (existing) {
          log.info("Repeatable job already scheduled", {
            name,
            jobId: jobOptions.jobId,
            cron: scheduleOptions.cron,
          });
          return null;
        }
      }

      const job = await this.queue.add(name, data, jobOptions);
      log.debug("Job scheduled", {
        name,
        id: job.id,
        cron: scheduleOptions.cron,
        delay: scheduleOptions.delay,
      });
      return job;
    } catch (error) {
      log.error("Failed to schedule job", {
        name,
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Get a job by ID
   */
  async getJob<T>(id: string): Promise<Job<T> | null> {
    if (!this.queue) return null;

    try {
      return (await this.queue.getJob(id)) as Job<T> | null;
    } catch (error) {
      log.error("Failed to get job", { id, error: getErrorMessage(error) });
      return null;
    }
  }

  /**
   * Get job status
   */
  async getJobStatus<T>(id: string): Promise<JobResult<T> | null> {
    const job = await this.getJob<T>(id);
    if (!job) return null;

    const state = await job.getState();

    return {
      id: job.id!,
      name: job.name,
      data: job.data,
      status: state as JobResult["status"],
      progress: job.progress as number,
      returnvalue: job.returnvalue,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade,
      processedOn: job.processedOn,
      finishedOn: job.finishedOn,
    };
  }

  /**
   * Remove a job
   */
  async removeJob(id: string): Promise<boolean> {
    const job = await this.getJob(id);
    if (!job) return false;

    try {
      await job.remove();
      return true;
    } catch (error) {
      log.error("Failed to remove job", { id, error: getErrorMessage(error) });
      return false;
    }
  }

  /**
   * Get queue health status
   */
  async getHealth(): Promise<QueueHealthStatus> {
    if (!this.queue) {
      return {
        healthy: false,
        queueName: "main",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      };
    }

    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);

      const isPaused = await this.queue.isPaused();

      return {
        healthy: true,
        queueName: "main",
        waiting,
        active,
        completed,
        failed,
        delayed,
        paused: isPaused,
      };
    } catch (error) {
      log.error("Failed to get queue health", {
        error: getErrorMessage(error),
      });
      return {
        healthy: false,
        queueName: "main",
        waiting: 0,
        active: 0,
        completed: 0,
        failed: 0,
        delayed: 0,
        paused: false,
      };
    }
  }

  /**
   * Pause the queue
   */
  async pause(): Promise<void> {
    if (this.queue) {
      await this.queue.pause();
      log.info("Queue paused");
    }
  }

  /**
   * Resume the queue
   */
  async resume(): Promise<void> {
    if (this.queue) {
      await this.queue.resume();
      log.info("Queue resumed");
    }
  }

  /**
   * Clean old jobs
   */
  async clean(
    grace: number = 0,
    limit: number = 1000,
    type: "completed" | "failed" | "delayed" | "wait" = "completed",
  ): Promise<string[]> {
    if (!this.queue) return [];

    try {
      const removed = await this.queue.clean(grace, limit, type);
      log.info("Cleaned old jobs", { type, count: removed.length });
      return removed;
    } catch (error) {
      log.error("Failed to clean jobs", { error: getErrorMessage(error) });
      return [];
    }
  }

  /**
   * Get registered job names
   */
  getRegisteredJobs(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Check if queue is available
   */
  isAvailable(): boolean {
    return this.queue !== null && this.initialized;
  }

  /**
   * Get number of currently processing jobs
   */
  getProcessingCount(): number {
    return this.processingJobs;
  }

  /**
   * Shutdown the job queue gracefully
   */
  async shutdown(): Promise<void> {
    log.info("Shutting down job queue");

    // Close worker first (stop processing new jobs)
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }

    // Close queue events
    if (this.queueEvents) {
      await this.queueEvents.close();
      this.queueEvents = null;
    }

    // Close queue last
    if (this.queue) {
      await this.queue.close();
      this.queue = null;
    }

    this.initialized = false;
    log.info("Job queue shutdown complete");
  }
}

// Singleton instance
export const jobQueue = new JobQueueService();

export default jobQueue;
