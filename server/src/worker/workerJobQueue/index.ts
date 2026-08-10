/**
 * Worker Job Queue
 *
 * BullMQ-based job queue for the background worker process.
 * Provides multiple named queues with distributed locking support.
 *
 * Features:
 * - Multiple named queues (sync, notifications, confirmations)
 * - Distributed locking to prevent duplicate job execution
 * - Automatic retries with exponential backoff
 * - Job scheduling (cron and delayed)
 * - Health monitoring
 */

import {
  Queue,
  Worker,
  Job,
  QueueEvents,
  type ConnectionOptions,
  type JobsOptions,
} from "bullmq";
import { getRedisClient, isRedisConnected } from "../../infrastructure";
import { createLogger } from "../../utils/logger";
import { getErrorMessage } from "../../utils/errors";
import { toBullMqJobId, withBullMqSafeJobId } from "../../jobs/bullMqJobIds";
import type { WorkerJobHandler } from "../jobs/types";
import type {
  WorkerJobQueueConfig,
  QueueInstance,
  RegisteredHandler,
  RecurringScheduleDefinition,
  RecurringScheduleInspection,
  RecurringScheduleResult,
  RecurringRemovalResult,
} from "./types";
import { setupWorkerEventHandlers } from "./eventHandlers";
import { processJobWithLock } from "./jobProcessor";
import {
  inspectRecurringScheduleDefinitions,
  reconcileRecurringSchedule,
} from "./recurringSchedules";
import {
  RecurringHeartbeatStore,
  type RecurringHeartbeatSnapshot,
} from "./recurringHeartbeatStore";
import { unwrapRecurringJobData } from "./recurringJobEnvelope";
import {
  DEAD_LETTER_RECONCILIATION_INTERVAL_MS,
  reconcileExhaustedJobs,
} from "./deadLetterReconciler";

export type { WorkerJobQueueConfig } from "./types";
export type {
  RecurringScheduleDefinition,
  RecurringScheduleRecurrence,
  RecurringScheduleInspection,
  RecurringScheduleResult,
  RecurringRemovalResult,
} from "./types";

const log = createLogger("WORKER:QUEUE");

function definedJobOptions(options?: JobsOptions): JobsOptions | undefined {
  if (!options) return undefined;
  const entries = Object.entries(options).filter(
    ([, value]) => value !== undefined,
  );
  return entries.length > 0
    ? (Object.fromEntries(entries) as JobsOptions)
    : undefined;
}

function mergeJobOptions(
  defaults?: JobsOptions,
  overrides?: JobsOptions,
): JobsOptions | undefined {
  return definedJobOptions({
    ...definedJobOptions(defaults),
    ...definedJobOptions(overrides),
  });
}

interface QueueFactoryOptions {
  queueName: string;
  connection: ConnectionOptions;
  prefix: string | undefined;
  concurrency: number;
  autorun: boolean;
  defaultJobOptions: JobsOptions | undefined;
  processJob: (queueName: string, job: Job) => Promise<unknown>;
  onRecurringCompleted: (job: Job) => Promise<void>;
}

function createBullQueue({
  queueName,
  connection,
  prefix,
  defaultJobOptions,
}: Pick<
  QueueFactoryOptions,
  "queueName" | "connection" | "prefix" | "defaultJobOptions"
>): Queue {
  return new Queue(queueName, {
    connection,
    prefix,
    defaultJobOptions,
  });
}

function createBullWorker({
  queueName,
  connection,
  prefix,
  concurrency,
  autorun,
  processJob,
}: Pick<
  QueueFactoryOptions,
  "queueName" | "connection" | "prefix" | "concurrency" | "autorun" | "processJob"
>): Worker {
  return new Worker(queueName, async (job) => processJob(queueName, job), {
    connection,
    prefix,
    concurrency,
    autorun,
  });
}

function createBullQueueEvents({
  queueName,
  connection,
  prefix,
}: Pick<
  QueueFactoryOptions,
  "queueName" | "connection" | "prefix"
>): QueueEvents {
  return new QueueEvents(queueName, {
    connection,
    prefix,
  });
}

function createQueueInstance(options: QueueFactoryOptions): QueueInstance {
  const queue = createBullQueue(options);
  const worker = createBullWorker(options);
  const events = createBullQueueEvents(options);
  setupWorkerEventHandlers(
    options.queueName,
    worker,
    options.onRecurringCompleted,
  );
  return { queue, worker, events };
}

export class WorkerJobQueue {
  private queues: Map<string, QueueInstance> = new Map();
  private handlers: Map<string, RegisteredHandler> = new Map();
  private heartbeatDefinitions = new Map<string, RecurringScheduleDefinition>();
  private heartbeatStore: RecurringHeartbeatStore | null = null;
  private config: WorkerJobQueueConfig;
  private connection: ConnectionOptions | null = null;
  private initialized = false;
  private shutdownPromise: Promise<void> | null = null;
  private shutdownController = new AbortController();
  private deadLetterTimer: NodeJS.Timeout | null = null;
  private deadLetterReconciliation: Promise<void> | null = null;

  constructor(config: WorkerJobQueueConfig) {
    this.config = {
      prefix: config.prefix ?? "sanctuary:worker",
      concurrency: config.concurrency,
      autorun: config.autorun ?? true,
      queues: config.queues,
      defaultJobOptions: config.defaultJobOptions ?? {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 500,
        removeOnFail: 250,
      },
    };
  }

  /**
   * Initialize the job queue system
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.shutdownController.signal.aborted) {
      this.shutdownController = new AbortController();
      this.shutdownPromise = null;
    }

    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      throw new Error("Redis is required for worker job queue");
    }

    // Create BullMQ connection options
    this.connection = {
      host: redis.options.host,
      port: redis.options.port,
      password: redis.options.password,
      db: redis.options.db,
    };
    this.heartbeatStore = new RecurringHeartbeatStore(
      redis,
      this.config.prefix!,
    );

    // Create queues and workers for each queue name
    for (const queueName of this.config.queues) {
      await this.createQueue(queueName);
    }

    await this.reconcileDeadLetters();
    this.startDeadLetterReconciliation();
    this.initialized = true;
    log.info("Worker job queue initialized", {
      queues: this.config.queues,
      concurrency: this.config.concurrency,
      autorun: this.config.autorun!,
      prefix: this.config.prefix,
    });
  }

  /**
   * Start consumers created with autorun disabled.
   *
   * BullMQ's run promise remains pending for the lifetime of the consumer, so
   * startup is intentionally initiated rather than awaited. BullMQ marks the
   * worker running synchronously before the first asynchronous connection step.
   */
  startConsumers(): void {
    if (!this.initialized) {
      throw new Error("Worker job queue must be initialized before consumers start");
    }
    for (const [queueName, instance] of this.queues) {
      if (instance.worker.isRunning()) continue;
      void instance.worker.run().catch((error) => {
        log.error(`Worker consumer stopped unexpectedly: ${queueName}`, {
          error: getErrorMessage(error),
        });
      });
    }
  }

  private startDeadLetterReconciliation(): void {
    if (this.deadLetterTimer) return;
    this.deadLetterTimer = setInterval(() => {
      void this.reconcileDeadLetters().catch((error) => {
        log.error("Failed to reconcile exhausted jobs into the DLQ", {
          error: getErrorMessage(error),
        });
      });
    }, DEAD_LETTER_RECONCILIATION_INTERVAL_MS);
    this.deadLetterTimer.unref();
  }

  async reconcileDeadLetters(): Promise<void> {
    if (this.deadLetterReconciliation) return this.deadLetterReconciliation;
    const reconciliation = reconcileExhaustedJobs(this.queues).then(
      (count) => {
        if (count > 0) {
          log.info("Reconciled exhausted jobs into the DLQ", { count });
        }
      },
    );
    this.deadLetterReconciliation = reconciliation;
    try {
      await reconciliation;
    } finally {
      if (this.deadLetterReconciliation === reconciliation) {
        this.deadLetterReconciliation = null;
      }
    }
  }

  /**
   * Create a queue and its worker
   */
  private async createQueue(queueName: string): Promise<void> {
    if (!this.connection) {
      throw new Error("Connection not established");
    }

    const instance = createQueueInstance({
      queueName,
      connection: this.connection,
      prefix: this.config.prefix,
      defaultJobOptions: this.config.defaultJobOptions,
      concurrency: this.config.concurrency,
      autorun: this.config.autorun!,
      processJob: (name, job) => this.processJob(name, job),
      onRecurringCompleted: (job) =>
        this.recordRecurringCompletion(queueName, job),
    });

    this.queues.set(queueName, instance);
    log.debug(`Created queue: ${queueName}`);
  }

  /**
   * Process a job - delegates to processJobWithLock
   */
  private async processJob(queueName: string, job: Job): Promise<unknown> {
    const handlerKey = `${queueName}:${job.name}`;
    const registered = this.handlers.get(handlerKey);

    if (!registered) {
      throw new Error(`No handler registered for ${handlerKey}`);
    }

    const recurringEnvelope = unwrapRecurringJobData(job.data);
    if (!recurringEnvelope) {
      return processJobWithLock(handlerKey, registered, job, {
        shutdownSignal: this.shutdownController.signal,
      });
    }
    const originalData = job.data;
    job.data = recurringEnvelope.payload;
    try {
      return await processJobWithLock(handlerKey, registered, job, {
        shutdownSignal: this.shutdownController.signal,
      });
    } finally {
      job.data = originalData;
    }
  }

  /**
   * Register a job handler
   */
  registerHandler<T, R>(
    queueName: string,
    handler: WorkerJobHandler<T, R>,
  ): void {
    const handlerKey = `${queueName}:${handler.name}`;

    if (this.handlers.has(handlerKey)) {
      log.warn(`Overwriting handler: ${handlerKey}`);
    }

    this.handlers.set(handlerKey, {
      handler: handler.handler as RegisteredHandler["handler"],
      options: handler.options,
      lockOptions: handler.lockOptions as RegisteredHandler["lockOptions"],
    });

    log.debug(`Registered handler: ${handlerKey}`);
  }

  /**
   * Add a job to a queue
   */
  async addJob<T>(
    queueName: string,
    jobName: string,
    data: T,
    options?: JobsOptions,
  ): Promise<Job<T> | null> {
    const queueInstance = this.queues.get(queueName);
    if (!queueInstance) {
      log.warn(`Queue not found: ${queueName}`);
      return null;
    }

    try {
      const handlerOptions = this.handlers.get(
        `${queueName}:${jobName}`,
      )?.options;
      const job = await queueInstance.queue.add(
        jobName,
        data,
        withBullMqSafeJobId(mergeJobOptions(handlerOptions, options)),
      );
      log.debug(`Job added: ${queueName}:${jobName}`, { jobId: job.id });
      return job;
    } catch (error) {
      log.error(`Failed to add job: ${queueName}:${jobName}`, {
        error: getErrorMessage(error),
      });
      return null;
    }
  }

  /**
   * Add multiple jobs in bulk
   */
  async addBulkJobs<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; options?: JobsOptions }>,
  ): Promise<Job<T>[]> {
    const queueInstance = this.queues.get(queueName);
    if (!queueInstance) {
      log.warn(`Queue not found: ${queueName}`);
      return [];
    }

    try {
      const result = await queueInstance.queue.addBulk(
        jobs.map((job) => ({
          name: job.name,
          data: job.data,
          opts: withBullMqSafeJobId(
            mergeJobOptions(
              this.handlers.get(`${queueName}:${job.name}`)?.options,
              job.options,
            ),
          ),
        })),
      );
      log.debug(`Bulk jobs added to ${queueName}`, { count: result.length });
      return result;
    } catch (error) {
      log.error(`Failed to add bulk jobs to ${queueName}`, {
        error: getErrorMessage(error),
      });
      return [];
    }
  }

  /**
   * Reconcile a recurring scheduler and its durable freshness generation.
   */
  async scheduleRecurring<T>(
    definition: RecurringScheduleDefinition<T>,
  ): Promise<RecurringScheduleResult> {
    const registeredOptions = this.handlers.get(
      `${definition.queue}:${definition.name}`,
    )?.options;
    const effectiveDefinition = {
      ...definition,
      options: mergeJobOptions(registeredOptions, definition.options),
    };
    if (!effectiveDefinition.freshness) {
      return reconcileRecurringSchedule(
        this.queues.get(effectiveDefinition.queue),
        effectiveDefinition,
      );
    }
    try {
      const generationToken =
        await this.heartbeatStore!.ensureGeneration(effectiveDefinition);
      this.heartbeatDefinitions.set(
        effectiveDefinition.schedulerId,
        effectiveDefinition,
      );
      return await reconcileRecurringSchedule(
        this.queues.get(effectiveDefinition.queue),
        effectiveDefinition,
        generationToken,
      );
    } catch (error) {
      return { status: "failed", error: getErrorMessage(error) };
    }
  }

  private async recordRecurringCompletion(
    queueName: string,
    job: Job,
  ): Promise<void> {
    const schedulerId = job.repeatJobKey;
    if (!schedulerId || !this.heartbeatStore) return;
    const recurringEnvelope = unwrapRecurringJobData(job.data);
    if (!recurringEnvelope) return;
    const definition = this.heartbeatDefinitions.get(schedulerId);
    if (
      !definition ||
      definition.queue !== queueName ||
      definition.name !== job.name ||
      definition.schedulerId !== `${queueName}:${job.name}`
    ) {
      return;
    }
    await this.heartbeatStore.recordCompletion(
      schedulerId,
      job.opts.repeat,
      recurringEnvelope.generationToken,
      definition.freshness,
    );
  }

  async getRecurringHeartbeatSnapshot(
    definitions: RecurringScheduleDefinition[],
  ): Promise<RecurringHeartbeatSnapshot> {
    if (!this.heartbeatStore) return { healthy: false, records: {} };
    return this.heartbeatStore.read(definitions);
  }

  async inspectRecurringSchedules(
    definitions: RecurringScheduleDefinition[],
    forbiddenDefinitions: RecurringScheduleDefinition[] = [],
  ): Promise<RecurringScheduleInspection> {
    const withRegisteredOptions = (
      definition: RecurringScheduleDefinition,
    ): RecurringScheduleDefinition => ({
      ...definition,
      options: mergeJobOptions(
        this.handlers.get(`${definition.queue}:${definition.name}`)?.options,
        definition.options,
      ),
    });
    return inspectRecurringScheduleDefinitions(
      this.queues,
      definitions.map(withRegisteredOptions),
      forbiddenDefinitions.map(withRegisteredOptions),
    );
  }

  /**
   * Remove a recurring job by name
   */
  async removeRecurring(
    queueName: string,
    jobName: string,
    options?: { purgeQueued?: boolean },
  ): Promise<RecurringRemovalResult> {
    const queueInstance = this.queues.get(queueName);
    if (!queueInstance) {
      log.warn(`Queue not found: ${queueName}`);
      return { status: "failed", error: `Queue not found: ${queueName}` };
    }

    try {
      // Remove repeatable job definitions
      let removed = await queueInstance.queue.removeJobScheduler(
        `${queueName}:${jobName}`,
      );
      const repeatableJobs = await queueInstance.queue.getRepeatableJobs();
      for (const existing of repeatableJobs) {
        if (existing.name === jobName) {
          await queueInstance.queue.removeRepeatableByKey(existing.key);
          removed = true;
          log.info(`Removed repeatable job: ${queueName}:${jobName}`, {
            key: existing.key,
          });
        }
      }

      // Optionally purge waiting/delayed jobs
      if (options?.purgeQueued) {
        const jobs = await queueInstance.queue.getJobs(["waiting", "delayed"]);
        const toRemove = jobs.filter((job) => job.name === jobName);
        await Promise.all(toRemove.map((job) => job.remove()));

        if (toRemove.length > 0) {
          removed = true;
          log.info(
            `Purged ${toRemove.length} queued jobs: ${queueName}:${jobName}`,
          );
        }
      }
      await this.heartbeatStore?.remove(`${queueName}:${jobName}`);
      this.heartbeatDefinitions.delete(`${queueName}:${jobName}`);
      return { status: removed ? "removed" : "absent" };
    } catch (error) {
      const errorMessage = getErrorMessage(error);
      log.error(`Failed to remove recurring job: ${queueName}:${jobName}`, {
        error: errorMessage,
      });
      return { status: "failed", error: errorMessage };
    }
  }

  /**
   * Get health status for all queues
   */
  async getHealth(): Promise<{
    healthy: boolean;
    queues: Record<
      string,
      {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        paused: boolean;
      }
    >;
  }> {
    const result: {
      healthy: boolean;
      queues: Record<
        string,
        {
          waiting: number;
          active: number;
          completed: number;
          failed: number;
          delayed: number;
          paused: boolean;
        }
      >;
    } = {
      healthy: true,
      queues: {},
    };

    for (const [name, instance] of this.queues) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all(
          [
            instance.queue.getWaitingCount(),
            instance.queue.getActiveCount(),
            instance.queue.getCompletedCount(),
            instance.queue.getFailedCount(),
            instance.queue.getDelayedCount(),
          ],
        );
        const paused = await instance.queue.isPaused();

        result.queues[name] = {
          waiting,
          active,
          completed,
          failed,
          delayed,
          paused,
        };
      } catch (error) {
        log.error(`Failed to get health for queue: ${name}`, {
          error: getErrorMessage(error),
        });
        result.healthy = false;
        result.queues[name] = {
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          paused: false,
        };
      }
    }

    return result;
  }

  /**
   * Check if the job queue is healthy
   */
  isHealthy(): boolean {
    if (!this.initialized) return false;

    for (const instance of this.queues.values()) {
      if (!instance.worker.isRunning()) return false;
    }

    return true;
  }

  isQueueWorkerRunning(queueName: string): boolean {
    return this.initialized && (this.queues.get(queueName)?.worker.isRunning() ?? false);
  }

  hasRegisteredHandler(queueName: string, jobName: string): boolean {
    return this.handlers.has(`${queueName}:${jobName}`);
  }

  /**
   * Register a callback for when a specific job completes on a queue.
   * Uses the BullMQ Worker 'completed' event.
   */
  onJobCompleted(
    queueName: string,
    jobName: string,
    callback: (returnvalue: unknown) => void | Promise<void>,
  ): void {
    const instance = this.queues.get(queueName);
    if (!instance) {
      log.warn(`Queue not found for onJobCompleted: ${queueName}`);
      return;
    }

    instance.worker.on("completed", (job, returnvalue) => {
      if (job.name !== jobName) return;

      try {
        const result = callback(returnvalue);
        if (result && typeof (result as Promise<void>).catch === "function") {
          (result as Promise<void>).catch((err) => {
            log.error(
              `onJobCompleted callback error for ${queueName}:${jobName}`,
              { error: String(err) },
            );
          });
        }
      } catch (err) {
        log.error(`onJobCompleted callback error for ${queueName}:${jobName}`, {
          error: String(err),
        });
      }
    });
  }

  /**
   * Get registered job names
   */
  getRegisteredJobs(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Gracefully shutdown the job queue
   */
  async shutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.doShutdown();
    return this.shutdownPromise;
  }

  private async doShutdown(): Promise<void> {
    log.info("Shutting down worker job queue...");
    this.shutdownController.abort(new Error('Worker job queue is shutting down'));
    if (this.deadLetterTimer) {
      clearInterval(this.deadLetterTimer);
      this.deadLetterTimer = null;
    }
    await this.deadLetterReconciliation?.catch((error) => {
      log.warn("DLQ reconciliation did not settle cleanly during shutdown", {
        error: getErrorMessage(error),
      });
    });

    // Close all workers first (stop processing new jobs)
    const workerClosePromises = Array.from(this.queues.values()).map(
      (instance) => instance.worker.close(),
    );
    await Promise.all(workerClosePromises);

    // Close queue events
    const eventClosePromises = Array.from(this.queues.values()).map(
      (instance) => instance.events.close(),
    );
    await Promise.all(eventClosePromises);

    // Close queues last
    const queueClosePromises = Array.from(this.queues.values()).map(
      (instance) => instance.queue.close(),
    );
    await Promise.all(queueClosePromises);

    this.queues.clear();
    this.handlers.clear();
    this.heartbeatDefinitions.clear();
    this.heartbeatStore = null;
    this.initialized = false;

    log.info("Worker job queue shutdown complete");
  }
}
