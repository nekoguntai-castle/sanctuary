/**
 * Worker Event Handlers
 *
 * Sets up BullMQ worker event handlers for logging and dead letter queue routing.
 */

import type { Job, Worker } from 'bullmq';
import { createLogger } from '../../utils/logger';
import { deadLetterQueue, type DeadLetterCategory } from '../../services/deadLetterQueue';
import { jobProcessingDuration } from '../../observability/metrics/infrastructureMetrics';
import {
  normalizeNotificationFailureClass,
  normalizeNotificationOutcome,
  type NotificationFailureClass,
  type NotificationOutcome,
} from '../../services/notifications/outcomes';
import { recordNotificationTelemetry } from '../../services/notifications/telemetry';

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
    recordTransactionTerminalOutcome(queueName, job, 'terminal_completed');

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
      recordTransactionTerminalOutcome(queueName, job, 'attempt_failed');
      if (isExhausted) {
        recordTransactionTerminalOutcome(queueName, job, 'terminal_failure');
      }
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

type RecordedNotificationState = {
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
};

function recordTransactionTerminalOutcome(
  queueName: string,
  job: Job,
  stage: 'attempt_failed' | 'terminal_completed' | 'terminal_failure',
): void {
  if (queueName !== 'notifications' || job.name !== 'transaction-notify') return;
  const state = readRecordedNotificationState(job, stage === 'terminal_completed');
  recordNotificationTelemetry({
    family: 'transaction',
    stage,
    path: 'queued',
    channel: 'none',
    outcome: state.outcome,
    failureClass: state.failureClass,
  });
}

function readRecordedNotificationState(
  job: Job,
  completed: boolean,
): RecordedNotificationState {
  const candidate = completed
    ? job.returnvalue
    : getCurrentAttemptProgressNotification(job.progress, job.attemptsMade);
  if (!candidate || typeof candidate !== 'object') {
    return { outcome: 'ambiguous', failureClass: 'unknown' };
  }
  const record = candidate as Record<string, unknown>;
  return {
    outcome: normalizeNotificationOutcome(record.outcome, 'ambiguous'),
    failureClass: normalizeNotificationFailureClass(record.failureClass, 'unknown'),
  };
}

function getCurrentAttemptProgressNotification(
  progress: unknown,
  failedAttemptOrdinal: number,
): unknown {
  if (!progress || typeof progress !== 'object') return undefined;
  const record = progress as Record<string, unknown>;
  if (
    record.version !== 1
    || typeof record.attemptOrdinal !== 'number'
    || !Number.isSafeInteger(record.attemptOrdinal)
    || record.attemptOrdinal !== failedAttemptOrdinal
  ) return undefined;
  return record.notification;
}
