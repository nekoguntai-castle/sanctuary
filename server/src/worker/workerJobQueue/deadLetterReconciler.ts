import type { Job } from 'bullmq';
import { deadLetterQueue } from '../../services/deadLetterQueue';
import { queueToDlqCategory } from './eventHandlers';
import { isRetainedUnrecoverableJobFailure } from './jobFailureClassification';
import type { QueueInstance } from './types';

export const DEAD_LETTER_RECONCILIATION_INTERVAL_MS = 60_000;
const MAX_FAILED_JOBS_PER_QUEUE = 250;
const FAILED_JOB_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export type DeadLetterReconciliationState = Map<string, Set<string>>;

interface QueueReconciliationResult {
  reconciled: number;
  retained: Set<string>;
  failures: unknown[];
}

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

function reconciliationIdentity(job: Job): string {
  const jobId = job.id ?? `${job.name}:${job.timestamp}`;
  return `${jobId}\u0000${job.attemptsMade}`;
}

const reconcileQueue = async (
  queueName: string,
  instance: QueueInstance,
  now: number,
  previous: ReadonlySet<string>,
): Promise<QueueReconciliationResult> => {
  const failedJobs = await instance.queue.getJobs(
    ['failed'],
    0,
    MAX_FAILED_JOBS_PER_QUEUE - 1,
    false,
  );
  const retained = new Set<string>();
  const failures: unknown[] = [];
  let reconciled = 0;

  for (const job of failedJobs) {
    if (!isExhausted(job) || !isRetainedFailureCurrent(job, now)) continue;
    const identity = reconciliationIdentity(job);
    if (previous.has(identity)) {
      retained.add(identity);
      continue;
    }
    try {
      await deadLetterQueue.addExhaustedJob(
        queueToDlqCategory(queueName),
        queueName,
        job,
        job.failedReason ?? 'Exhausted worker job',
        failureTime(job),
      );
      retained.add(identity);
      reconciled += 1;
    } catch (error) {
      failures.push(error);
    }
  }
  return { reconciled, retained, failures };
};

/**
 * Repair missed failure events from bounded, retained BullMQ history.
 * Individual failures are collected so one malformed job cannot starve others.
 */
export async function reconcileExhaustedJobs(
  queues: ReadonlyMap<string, QueueInstance>,
  now = Date.now(),
  state?: DeadLetterReconciliationState,
): Promise<number> {
  let reconciled = 0;
  const failures: unknown[] = [];
  for (const [queueName, instance] of queues) {
    try {
      const result = await reconcileQueue(
        queueName,
        instance,
        now,
        state?.get(queueName) ?? new Set(),
      );
      reconciled += result.reconciled;
      failures.push(...result.failures);
      state?.set(queueName, result.retained);
    } catch (error) {
      failures.push(error);
    }
  }
  if (state) {
    for (const queueName of state.keys()) {
      if (!queues.has(queueName)) state.delete(queueName);
    }
  }
  if (failures.length > 0) {
    throw new DeadLetterReconciliationError(failures);
  }
  return reconciled;
}
