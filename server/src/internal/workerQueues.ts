import { Queue, type ConnectionOptions, type Job, type JobType } from "bullmq";

export const WORKER_QUEUE_PREFIX = "sanctuary:worker";
export const NOTIFICATION_QUEUE_NAME = "notifications";

export const NOTIFICATION_QUEUE_STATES = [
  "waiting",
  "active",
  "delayed",
  "failed",
  "completed",
  "prioritized",
  "waitingChildren",
] as const;

export type NotificationQueueState = (typeof NOTIFICATION_QUEUE_STATES)[number];

export interface NotificationQueueReadHandle {
  getCounts?: () => Promise<Record<string, number>>;
  isPaused?: () => Promise<boolean>;
  getOldestTimestamp?: (
    state: NotificationQueueState,
  ) => Promise<number | null>;
  close: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const BULLMQ_STATES: Record<NotificationQueueState, JobType> = {
  waiting: "waiting",
  active: "active",
  delayed: "delayed",
  failed: "failed",
  completed: "completed",
  prioritized: "prioritized",
  waitingChildren: "waiting-children",
};

const COUNT_STATES = Object.values(BULLMQ_STATES);

function stateTimestamp(state: NotificationQueueState, job: Job): number {
  if (
    (state === "completed" || state === "failed") &&
    job.finishedOn !== undefined
  ) {
    return job.finishedOn;
  }
  if (state === "active" && job.processedOn !== undefined)
    return job.processedOn;
  if (state === "delayed") return job.timestamp + (job.delay ?? 0);
  return job.timestamp;
}

/**
 * Create a one-shot, getter-only view of the worker notification queue.
 * The BullMQ Queue never leaves this module, so callers cannot mutate jobs.
 */
export function createNotificationQueueReadHandle(
  connection: ConnectionOptions,
): NotificationQueueReadHandle {
  const queue = new Queue(NOTIFICATION_QUEUE_NAME, {
    connection,
    prefix: WORKER_QUEUE_PREFIX,
    skipMetasUpdate: true,
    skipWaitingForReady: true,
  });

  const getCounts =
    typeof queue.getJobCounts === "function"
      ? () => queue.getJobCounts(...COUNT_STATES)
      : undefined;
  const isPaused =
    typeof queue.isPaused === "function" ? () => queue.isPaused() : undefined;
  const getOldestTimestamp =
    typeof queue.getJobs === "function"
      ? async (state: NotificationQueueState): Promise<number | null> => {
          const jobs = await queue.getJobs(BULLMQ_STATES[state], 0, 0, true);
          const oldest = jobs[0];
          return oldest ? stateTimestamp(state, oldest as Job) : null;
        }
      : undefined;

  return Object.freeze({
    getCounts,
    isPaused,
    getOldestTimestamp,
    close: () => queue.close(),
    disconnect: () => queue.disconnect(),
  });
}
