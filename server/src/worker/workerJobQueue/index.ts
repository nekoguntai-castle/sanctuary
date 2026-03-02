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

import { Queue, Worker, Job, QueueEvents, type ConnectionOptions, type JobsOptions } from 'bullmq';
import { getRedisClient, isRedisConnected } from '../../infrastructure';
import { createLogger } from '../../utils/logger';
import type { WorkerJobHandler } from '../jobs/types';
import type { WorkerJobQueueConfig, QueueInstance, RegisteredHandler } from './types';
import { setupWorkerEventHandlers } from './eventHandlers';
import { processJobWithLock } from './jobProcessor';

export type { WorkerJobQueueConfig } from './types';

const log = createLogger('WorkerQueue');

export class WorkerJobQueue {
  private queues: Map<string, QueueInstance> = new Map();
  private handlers: Map<string, RegisteredHandler> = new Map();
  private config: WorkerJobQueueConfig;
  private connection: ConnectionOptions | null = null;
  private initialized = false;
  private shutdownPromise: Promise<void> | null = null;

  constructor(config: WorkerJobQueueConfig) {
    this.config = {
      prefix: config.prefix ?? 'sanctuary:worker',
      concurrency: config.concurrency,
      queues: config.queues,
      defaultJobOptions: config.defaultJobOptions ?? {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
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

    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      throw new Error('Redis is required for worker job queue');
    }

    // Create BullMQ connection options
    this.connection = {
      host: redis.options.host,
      port: redis.options.port,
      password: redis.options.password,
      db: redis.options.db,
    };

    // Create queues and workers for each queue name
    for (const queueName of this.config.queues) {
      await this.createQueue(queueName);
    }

    this.initialized = true;
    log.info('Worker job queue initialized', {
      queues: this.config.queues,
      concurrency: this.config.concurrency,
      prefix: this.config.prefix,
    });
  }

  /**
   * Create a queue and its worker
   */
  private async createQueue(queueName: string): Promise<void> {
    if (!this.connection) {
      throw new Error('Connection not established');
    }

    const queue = new Queue(queueName, {
      connection: this.connection,
      prefix: this.config.prefix,
      defaultJobOptions: this.config.defaultJobOptions,
    });

    const worker = new Worker(
      queueName,
      async (job) => this.processJob(queueName, job),
      {
        connection: this.connection,
        prefix: this.config.prefix,
        concurrency: this.config.concurrency,
      }
    );

    const events = new QueueEvents(queueName, {
      connection: this.connection,
      prefix: this.config.prefix,
    });

    // Set up event handlers
    setupWorkerEventHandlers(queueName, worker);

    this.queues.set(queueName, { queue, worker, events });
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

    return processJobWithLock(handlerKey, registered, job);
  }

  /**
   * Register a job handler
   */
  registerHandler<T, R>(queueName: string, handler: WorkerJobHandler<T, R>): void {
    const handlerKey = `${queueName}:${handler.name}`;

    if (this.handlers.has(handlerKey)) {
      log.warn(`Overwriting handler: ${handlerKey}`);
    }

    this.handlers.set(handlerKey, {
      handler: handler.handler as (job: Job) => Promise<unknown>,
      lockOptions: handler.lockOptions as RegisteredHandler['lockOptions'],
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
    options?: JobsOptions
  ): Promise<Job<T> | null> {
    const queueInstance = this.queues.get(queueName);
    if (!queueInstance) {
      log.warn(`Queue not found: ${queueName}`);
      return null;
    }

    try {
      const job = await queueInstance.queue.add(jobName, data, options);
      log.debug(`Job added: ${queueName}:${jobName}`, { jobId: job.id });
      return job;
    } catch (error) {
      log.error(`Failed to add job: ${queueName}:${jobName}`, { error });
      return null;
    }
  }

  /**
   * Add multiple jobs in bulk
   */
  async addBulkJobs<T>(
    queueName: string,
    jobs: Array<{ name: string; data: T; options?: JobsOptions }>
  ): Promise<Job<T>[]> {
    const queueInstance = this.queues.get(queueName);
    if (!queueInstance) {
      log.warn(`Queue not found: ${queueName}`);
      return [];
    }

    try {
      const result = await queueInstance.queue.addBulk(jobs);
      log.debug(`Bulk jobs added to ${queueName}`, { count: result.length });
      return result;
    } catch (error) {
      log.error(`Failed to add bulk jobs to ${queueName}`, { error });
      return [];
    }
  }

  /**
   * Schedule a recurring job with cron pattern
   */
  async scheduleRecurring<T>(
    queueName: string,
    jobName: string,
    data: T,
    cron: string,
    options?: Omit<JobsOptions, 'repeat'>
  ): Promise<Job<T> | null> {
    const queueInstance = this.queues.get(queueName);
    if (!queueInstance) {
      log.warn(`Queue not found: ${queueName}`);
      return null;
    }

    try {
      const jobId = options?.jobId ?? `repeat:${queueName}:${jobName}:${cron}`;
      const repeatableJobs = await queueInstance.queue.getRepeatableJobs();
      const existingJob = repeatableJobs.find(j => j.name === jobName && j.id === jobId);
      if (existingJob) {
        log.info(`Repeatable job already scheduled: ${queueName}:${jobName}`, { cron });
        return null;
      }

      const job = await queueInstance.queue.add(jobName, data, {
        ...options,
        jobId,
        repeat: { pattern: cron },
        removeOnComplete: options?.removeOnComplete ?? 10,
      });

      log.info(`Scheduled recurring job: ${queueName}:${jobName}`, { cron });
      return job;
    } catch (error) {
      log.error(`Failed to schedule recurring job: ${queueName}:${jobName}`, { error });
      return null;
    }
  }

  /**
   * Get health status for all queues
   */
  async getHealth(): Promise<{
    healthy: boolean;
    queues: Record<string, {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
      paused: boolean;
    }>;
  }> {
    const result: {
      healthy: boolean;
      queues: Record<string, {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        paused: boolean;
      }>;
    } = {
      healthy: true,
      queues: {},
    };

    for (const [name, instance] of this.queues) {
      try {
        const [waiting, active, completed, failed, delayed] = await Promise.all([
          instance.queue.getWaitingCount(),
          instance.queue.getActiveCount(),
          instance.queue.getCompletedCount(),
          instance.queue.getFailedCount(),
          instance.queue.getDelayedCount(),
        ]);
        const paused = await instance.queue.isPaused();

        result.queues[name] = { waiting, active, completed, failed, delayed, paused };
      } catch (error) {
        log.error(`Failed to get health for queue: ${name}`, { error });
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
    log.info('Shutting down worker job queue...');

    // Close all workers first (stop processing new jobs)
    const workerClosePromises = Array.from(this.queues.values()).map(
      instance => instance.worker.close()
    );
    await Promise.all(workerClosePromises);

    // Close queue events
    const eventClosePromises = Array.from(this.queues.values()).map(
      instance => instance.events.close()
    );
    await Promise.all(eventClosePromises);

    // Close queues last
    const queueClosePromises = Array.from(this.queues.values()).map(
      instance => instance.queue.close()
    );
    await Promise.all(queueClosePromises);

    this.queues.clear();
    this.handlers.clear();
    this.initialized = false;

    log.info('Worker job queue shutdown complete');
  }
}
