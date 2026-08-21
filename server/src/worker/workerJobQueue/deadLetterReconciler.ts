import type { Job } from 'bullmq';
import { deadLetterQueue } from '../../services/deadLetterQueue';
import { queueToDlqCategory } from './eventHandlers';
import { isRetainedUnrecoverableJobFailure } from './jobFailureClassification';
import type { QueueInstance } from './types';

export const DEAD_LETTER_RECONCILIATION_INTERVAL_MS = 60_000;
const MAX_FAILED_JOBS_PER_QUEUE = 250;
const FAILED_JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

class DeadLetterReconciliationError extends Error {
  constructor(readonly errors: unknown[]) {
    super('Failed to reconcile exhausted jobs');
    this.name = 'DeadLetterReconciliationError';
  }
}

function isExhausted(job: Job): boolean {
  return job.attemptsMade >= (job.opts.attempts ?? 1)
    || isRetainedUnrecoverableJobFailure(job);
}

function isRetainedFailureCurrent(job: Job, now: number): boolean {
  return !job.finishedOn || job.finishedOn > now - FAILED_JOB_MAX_AGE_MS;
}

function failureTime(job: Job): Date {
  return new Date(job.finishedOn ?? job.processedOn ?? job.timestamp);
}

/**
 * Repair missed failure events from bounded, retained BullMQ history.
 * Individual failures are collected so one malformed job cannot starve others.
 */
export async function reconcileExhaustedJobs(
  queues: ReadonlyMap<string, QueueInstance>,
  now = Date.now(),
): Promise<number> {
  let reconciled = 0;
  const failures: unknown[] = [];
  for (const [queueName, instance] of queues) {
    let failedJobs: Job[];
    try {
      failedJobs = await instance.queue.getJobs(
        ['failed'],
        0,
        MAX_FAILED_JOBS_PER_QUEUE - 1,
        false,
      );
    } catch (error) {
      failures.push(error);
      continue;
    }
    for (const job of failedJobs) {
      if (!isExhausted(job) || !isRetainedFailureCurrent(job, now)) continue;
      try {
        await deadLetterQueue.addExhaustedJob(
          queueToDlqCategory(queueName),
          queueName,
          job,
          job.failedReason ?? 'Exhausted worker job',
          failureTime(job),
        );
        reconciled += 1;
      } catch (error) {
        failures.push(error);
      }
    }
  }
  if (failures.length > 0) {
    throw new DeadLetterReconciliationError(failures);
  }
  return reconciled;
}
