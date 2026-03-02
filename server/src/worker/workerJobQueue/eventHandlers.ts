/**
 * Worker Event Handlers
 *
 * Sets up BullMQ worker event handlers for logging and dead letter queue routing.
 */

import type { Worker } from 'bullmq';
import { createLogger } from '../../utils/logger';
import { deadLetterQueue, type DeadLetterCategory } from '../../services/deadLetterQueue';

const log = createLogger('WorkerQueue');

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
export function setupWorkerEventHandlers(queueName: string, worker: Worker): void {
  worker.on('completed', (job) => {
    log.debug(`Job completed: ${queueName}:${job.name}`, {
      jobId: job.id,
      duration: job.finishedOn && job.processedOn
        ? job.finishedOn - job.processedOn
        : undefined,
    });
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

    // Route exhausted jobs to dead letter queue for visibility and manual retry
    if (isExhausted && job) {
      const dlqCategory = queueToDlqCategory(queueName);
      deadLetterQueue.add(
        dlqCategory,
        `${queueName}:${job.name}`,
        { jobId: job.id, jobName: job.name, queue: queueName, data: job.data },
        error,
        attemptsMade,
        { queueName, jobId: job.id },
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
