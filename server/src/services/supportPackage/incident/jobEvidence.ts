import { Queue, type ConnectionOptions, type Job } from 'bullmq';
import { getRedisClient, isRedisConnected } from '../../../infrastructure/redis';
import { toBullMqJobId } from '../../../jobs/bullMqJobIds';
import {
  NOTIFICATION_FAILURE_CLASSES,
  NOTIFICATION_OUTCOMES,
  type NotificationFailureClass,
  type NotificationOutcome,
} from '../../notifications/outcomes';
import type {
  IncidentAgeBucket,
  IncidentAttemptBucket,
  IncidentExpectedDirection,
  IncidentJobEvidence,
  IncidentJobState,
  IncidentLookupStatus,
  IncidentRole,
  IncidentSelectors,
  IncidentTelegramFailureClass,
  IncidentTelegramOutcome,
} from './types';

const NOTIFICATION_QUEUE_NAME = 'notifications';
const WORKER_QUEUE_PREFIX = 'sanctuary:worker';
const DEFAULT_COMMAND_TIMEOUT_MS = 1_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 5_000;

interface JobRoleSelector {
  role: IncidentRole;
  expectedDirection: IncidentExpectedDirection;
  walletId: string;
}

interface IncidentJobReadOptions {
  commandTimeoutMs?: number;
  cleanupTimeoutMs?: number;
  nowMs?: number;
}

interface SafeCategoricalResult {
  outcome: NotificationOutcome;
  failureClass: NotificationFailureClass;
  channels: unknown[];
}
type MissingRetentionRecord = 'not_retained' | 'not_observed';
type HandlerObservation = IncidentJobEvidence['handler'];
type TerminalObservation = IncidentJobEvidence['terminal'];

class IncidentQueueTimeoutError extends Error {}

function boundedTimeout(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new Error('Incident queue timeout must be an integer from 1 to 5000ms');
  }
  return value;
}

function roleSelectors(selectors: IncidentSelectors): readonly [JobRoleSelector, JobRoleSelector] {
  return [
    { role: 'sender', expectedDirection: 'sent', walletId: selectors.senderWalletId },
    { role: 'receiver', expectedDirection: 'received', walletId: selectors.receiverWalletId },
  ];
}

function connectionOptions(): ConnectionOptions | null {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) return null;
  return {
    host: redis.options.host,
    port: redis.options.port,
    username: redis.options.username,
    password: redis.options.password,
    db: redis.options.db,
  };
}

function createReadQueue(connection: ConnectionOptions): Queue {
  return new Queue(NOTIFICATION_QUEUE_NAME, {
    connection,
    prefix: WORKER_QUEUE_PREFIX,
    skipMetasUpdate: true,
    skipWaitingForReady: true,
  });
}

async function withDeadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer!: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new IncidentQueueTimeoutError()), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function missingJobEvidence(
  selector: JobRoleSelector,
  lookupStatus: IncidentLookupStatus,
  record: MissingRetentionRecord = 'not_observed',
) {
  return {
    role: selector.role,
    expectedDirection: selector.expectedDirection,
    lookupStatus,
    present: 'not_observed',
    state: 'not_observed',
    attempts: 'unknown',
    enqueue: 'not_observed',
    handler: 'not_observed',
    terminal: 'not_observed',
    telegram: { outcome: 'not_observed', failureClass: 'not_observed' },
    ages: {
      created: 'not_observed',
      processed: 'not_observed',
      finished: 'not_observed',
    },
    retention: {
      record,
      horizon: 'unsupported',
      saturation: 'unknown',
    },
  } satisfies IncidentJobEvidence;
}

function normalizeState(value: string): IncidentJobState {
  switch (value) {
    case 'waiting':
    case 'active':
    case 'delayed':
    case 'failed':
    case 'completed':
    case 'prioritized':
      return value;
    case 'waiting-children':
      return 'waiting_children';
    default:
      return 'unknown';
  }
}

const attemptBucket = (value: unknown): IncidentAttemptBucket => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return 'unknown';
  if (value === 0) return 'none';
  if (value === 1) return 'one';
  if ((value as number) <= 3) return 'two_to_three';
  if ((value as number) <= 5) return 'four_to_five';
  return 'six_plus';
};

const ageBucket = (value: unknown, nowMs: number): IncidentAgeBucket => {
  if (!Number.isSafeInteger(value) || (value as number) < 0) return 'not_observed';
  const ageMs = nowMs - (value as number);
  if (ageMs < 0) return 'not_observed';
  if (ageMs < 60_000) return 'lt_1m';
  if (ageMs < 5 * 60_000) return 'one_to_five_minutes';
  if (ageMs < 60 * 60_000) return 'five_minutes_to_one_hour';
  if (ageMs < 24 * 60 * 60_000) return 'one_to_twenty_four_hours';
  return 'gte_twenty_four_hours';
};

const isExpectedJob = (job: Job, selector: JobRoleSelector, txid: string): boolean => {
  if (job.name !== 'transaction-notify') return false;
  if (!job.data || typeof job.data !== 'object') return false;
  const data = job.data as Record<string, unknown>;
  return data.walletId === selector.walletId
    && data.txid === txid
    && data.type === selector.expectedDirection;
};

const isOutcome = (value: unknown): value is NotificationOutcome => {
  return typeof value === 'string'
    && NOTIFICATION_OUTCOMES.includes(value as NotificationOutcome);
};

const isFailureClass = (value: unknown): value is NotificationFailureClass => {
  return typeof value === 'string'
    && NOTIFICATION_FAILURE_CLASSES.includes(value as NotificationFailureClass);
};

const categoricalResult = (candidate: unknown, channelsKey: string): SafeCategoricalResult | null => {
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Record<string, unknown>;
  const channels = record[channelsKey];
  if (record.version !== 1
    || !isOutcome(record.outcome)
    || !isFailureClass(record.failureClass)
    || !Array.isArray(channels)) return null;
  return {
    outcome: record.outcome,
    failureClass: record.failureClass,
    channels,
  };
};

const completedResult = (job: Job): SafeCategoricalResult | null => {
  return categoricalResult(job.returnvalue, 'channelOutcomes');
};

const failedResult = (job: Job): SafeCategoricalResult | null => {
  if (!job.progress || typeof job.progress !== 'object') return null;
  const progress = job.progress as Record<string, unknown>;
  if (progress.version !== 1
    || !Number.isSafeInteger(progress.attemptOrdinal)
    || progress.attemptOrdinal !== job.attemptsMade) return null;
  return categoricalResult(progress.notification, 'channels');
};

const telegramEvidence = (result: SafeCategoricalResult | null): {
  outcome: IncidentTelegramOutcome;
  failureClass: IncidentTelegramFailureClass;
} => {
  if (!result) return { outcome: 'not_observed', failureClass: 'not_observed' };
  const telegram = result.channels.filter((channel) => {
    if (!channel || typeof channel !== 'object') return false;
    return (channel as Record<string, unknown>).channel === 'telegram';
  });
  if (telegram.length === 0 && result.channels.length === 0
    && result.outcome === 'not_registered') {
    return { outcome: 'not_registered', failureClass: 'none' };
  }
  if (telegram.length !== 1) {
    return { outcome: 'not_observed', failureClass: 'not_observed' };
  }
  const record = telegram[0] as Record<string, unknown>;
  if (!isOutcome(record.outcome) || !isFailureClass(record.failureClass)) {
    return { outcome: 'not_observed', failureClass: 'not_observed' };
  }
  return { outcome: record.outcome, failureClass: record.failureClass };
};

function handlerState(
  state: IncidentJobState,
  attemptsMade: unknown,
  processedOn: unknown,
): HandlerObservation {
  if (Number.isSafeInteger(processedOn) || (Number.isSafeInteger(attemptsMade)
    && (attemptsMade as number) > 0)) return 'started';
  if (state === 'active' || state === 'completed' || state === 'failed') return 'started';
  if (attemptsMade === 0 && (
    state === 'waiting'
    || state === 'delayed'
    || state === 'prioritized'
    || state === 'waiting_children'
  )) return 'not_started';
  return 'not_observed';
}

const terminalState = (state: IncidentJobState): TerminalObservation => {
  if (state === 'completed') return 'completed';
  if (state === 'failed') return 'failed';
  return state === 'unknown' ? 'not_observed' : 'not_terminal';
};

const observedJobEvidence = (
  selector: JobRoleSelector,
  job: Job,
  state: IncidentJobState,
  nowMs: number,
): IncidentJobEvidence => {
  const handler = handlerState(state, job.attemptsMade, job.processedOn);
  const terminal = terminalState(state);
  const result = state === 'completed'
    ? completedResult(job)
    : state === 'failed' ? failedResult(job) : null;
  return {
    role: selector.role,
    expectedDirection: selector.expectedDirection,
    lookupStatus: 'observed',
    present: 'observed_true',
    state,
    attempts: attemptBucket(job.attemptsMade),
    enqueue: 'resolved',
    handler,
    terminal,
    telegram: telegramEvidence(result),
    ages: {
      created: ageBucket(job.timestamp, nowMs),
      processed: handler === 'not_started'
        ? 'not_applicable'
        : ageBucket(job.processedOn, nowMs),
      finished: terminal === 'not_terminal'
        ? 'not_applicable'
        : ageBucket(job.finishedOn, nowMs),
    },
    retention: {
      record: 'retained',
      horizon: 'unsupported',
      saturation: 'unknown',
    },
  };
};

async function readRoleJob(
  queue: Queue,
  txid: string,
  selector: JobRoleSelector,
  commandTimeoutMs: number,
  nowMs: number,
): Promise<IncidentJobEvidence> {
  try {
    const jobId = toBullMqJobId(`txnotify:${selector.walletId}:${txid}`);
    const job = await withDeadline(queue.getJob(jobId), commandTimeoutMs);
    if (!job) return missingJobEvidence(selector, 'observed', 'not_retained');
    if (!isExpectedJob(job, selector, txid)) {
      return missingJobEvidence(selector, 'unavailable');
    }
    const state = normalizeState(await withDeadline(job.getState(), commandTimeoutMs));
    return observedJobEvidence(selector, job, state, nowMs);
  } catch (error) {
    return missingJobEvidence(
      selector,
      error instanceof IncidentQueueTimeoutError ? 'timeout' : 'unavailable',
    );
  }
}

async function disposeQueue(queue: Queue, cleanupTimeoutMs: number): Promise<void> {
  const closed = await withDeadline(queue.close(), cleanupTimeoutMs).then(
    () => true,
    () => false,
  );
  if (!closed) {
    await withDeadline(queue.disconnect(), cleanupTimeoutMs).catch(() => undefined);
  }
}

/**
 * Read the two stable transaction-notification job IDs with BullMQ getters
 * only. Raw job payloads/results stay local and are reduced to categorical
 * role evidence before return.
 */
export async function readIncidentJobEvidence(
  selectors: IncidentSelectors,
  options: IncidentJobReadOptions = {},
): Promise<readonly [IncidentJobEvidence, IncidentJobEvidence]> {
  const commandTimeoutMs = boundedTimeout(
    options.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
  const cleanupTimeoutMs = boundedTimeout(
    options.cleanupTimeoutMs,
    DEFAULT_CLEANUP_TIMEOUT_MS,
  );
  const [sender, receiver] = roleSelectors(selectors);
  const connection = connectionOptions();
  if (!connection) {
    return [
      missingJobEvidence(sender, 'unavailable'),
      missingJobEvidence(receiver, 'unavailable'),
    ];
  }

  let queue: Queue;
  try {
    queue = createReadQueue(connection);
  } catch {
    return [
      missingJobEvidence(sender, 'unavailable'),
      missingJobEvidence(receiver, 'unavailable'),
    ];
  }

  try {
    const nowMs = options.nowMs ?? Date.now();
    return await Promise.all([
      readRoleJob(queue, selectors.txid, sender, commandTimeoutMs, nowMs),
      readRoleJob(queue, selectors.txid, receiver, commandTimeoutMs, nowMs),
    ]);
  } finally {
    await disposeQueue(queue, cleanupTimeoutMs);
  }
}
