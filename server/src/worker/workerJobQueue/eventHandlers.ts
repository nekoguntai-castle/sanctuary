/**
 * Worker Event Handlers
 *
 * Sets up BullMQ worker event handlers for logging and dead letter queue routing.
 */

import type { Job, Worker } from 'bullmq';
import { createLogger } from '../../utils/logger';
import { deadLetterQueue, type DeadLetterCategory } from '../../services/deadLetterQueue';
import { jobProcessingDuration } from '../../observability/metrics/infrastructureMetrics';

const log = createLogger('WORKER:QUEUE_EVENTS');

/**
 * Observe job processing duration if timing data is available.
 */
function observeJobDuration(
  queueName: string,
  jobName: string,
  status: 'completed' | 'failed',
  processedOn: number | undefined,
  finishedOn: number | undefined,
): void {
  if (finishedOn !== undefined && processedOn !== undefined) {
    jobProcessingDuration.observe(
      { job_name: `${queueName}:${jobName}`, status },
      (finishedOn - processedOn) / 1000,
    );
  }
}

/**
 * Map queue name to DLQ category
 */
export function queueToDlqCategory(queueName: string): DeadLetterCategory {
  switch (queueName) {
    case 'sync': return 'sync';
    case 'notifications': return 'notification';
    case 'maintenance': return 'other';
    case 'confirmations': return 'sync';
    default: return 'other';
  }
}

/**
 * Set up event handlers for a worker
 */
export function setupWorkerEventHandlers(
  queueName: string,
  worker: Worker,
  onRecurringCompleted?: (job: Job) => Promise<void>,
  recordExhaustedJob = (
    category: DeadLetterCategory,
    sourceQueue: string,
    job: Job,
    error: Error,
  ) => deadLetterQueue.addExhaustedJob(category, sourceQueue, job, error),
): void {
  worker.on('completed', (job) => {
    log.debug(`Job completed: ${queueName}:${job.name}`, {
      jobId: job.id,
      duration: job.finishedOn && job.processedOn ? job.finishedOn - job.processedOn : undefined,
    });

    observeJobDuration(queueName, job.name, 'completed', job.processedOn, job.finishedOn);

    if (job.repeatJobKey && onRecurringCompleted) {
      void onRecurringCompleted(job).catch((error) => {
        log.error(`Failed to persist recurring completion: ${queueName}:${job.name}`, {
          error: String(error),
        });
      });
    }
  });

  worker.on('failed', (job, error) => {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    const isExhausted = attemptsMade >= maxAttempts;

    log.error(`Job failed: ${queueName}:${job?.name}`, {
      jobId: job?.id,
      error: error.message,
      attemptsMade,
      maxAttempts,
      exhausted: isExhausted,
    });

    if (job) {
      observeJobDuration(queueName, job.name, 'failed', job.processedOn, job.finishedOn);
    }

    // Route exhausted jobs to dead letter queue for visibility and manual retry
    if (isExhausted && job) {
      const dlqCategory = queueToDlqCategory(queueName);
      recordExhaustedJob(
        dlqCategory,
        queueName,
        job,
        error,
      ).catch(dlqError => {
        log.debug('Failed to record exhausted job in DLQ', { error: String(dlqError) });
      });
    }
  });

  worker.on('error', (error) => {
    log.error(`Worker error on queue ${queueName}`, { error: error.message });
  });

  worker.on('stalled', (jobId) => {
    log.warn(`Job stalled: ${queueName}:${jobId}`);
  });
}
