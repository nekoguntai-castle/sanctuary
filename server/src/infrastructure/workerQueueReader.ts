import type { ConnectionOptions } from "bullmq";
import { getRedisClient, isRedisConnected } from "./redis";
import {
  createNotificationQueueReadHandle,
  NOTIFICATION_QUEUE_STATES,
  type NotificationQueueReadHandle,
  type NotificationQueueState,
} from "../internal/workerQueues";
import {
  NOTIFICATION_JOB_FAMILIES,
  NOTIFICATION_RETENTION_CONTRACT_VERSION,
  NOTIFICATION_RETENTION_POLICIES,
  type NotificationJobFamily,
  type NotificationRetentionLimit,
} from "../internal/notificationRetention";

export type QueueObservation<T> =
  | { status: "observed"; value: T }
  | { status: "unavailable" }
  | { status: "timeout" }
  | { status: "unsupported" };

export type QueueAgeBucket =
  | "none"
  | "not_due"
  | "lt_1m"
  | "one_to_five_minutes"
  | "five_minutes_to_one_hour"
  | "one_to_twenty_four_hours"
  | "gte_twenty_four_hours";

export interface BoundedQueueCount {
  value: number;
  saturated: boolean;
}

export interface NotificationQueueStateObservation {
  count: QueueObservation<BoundedQueueCount>;
  oldestAge: QueueObservation<QueueAgeBucket>;
}

export type NotificationQueueObservation = {
  consistency: "approximate_non_atomic";
  paused: QueueObservation<boolean>;
  states: Record<NotificationQueueState, NotificationQueueStateObservation>;
  retention: NotificationRetentionObservation;
};

export interface NotificationRetentionObservation {
  contractVersion: typeof NOTIFICATION_RETENTION_CONTRACT_VERSION;
  producerCompatibility: "unknown";
  families: Record<
    NotificationJobFamily,
    {
      classification: "uniform" | "immediate_removal";
      completed: NotificationRetentionLimit;
      failed: NotificationRetentionLimit;
      retainedAge: { status: "unsupported" };
    }
  >;
}

export interface NotificationQueueReadOptions {
  commandTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 1_000;
const DEFAULT_CLEANUP_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 5_000;
const MAX_EXPORTED_COUNT = 1_000_000;

function retentionObservation(): NotificationRetentionObservation {
  return {
    contractVersion: NOTIFICATION_RETENTION_CONTRACT_VERSION,
    // Active API producer membership is not discoverable from BullMQ getters.
    // The worker fleet collector separately reports detectable version drift.
    producerCompatibility: "unknown",
    families: Object.fromEntries(
      NOTIFICATION_JOB_FAMILIES.map((family) => {
        const policy = NOTIFICATION_RETENTION_POLICIES[family];
        const immediate =
          policy.completed.kind === "immediate_removal" &&
          policy.failed.kind === "immediate_removal";
        return [
          family,
          {
            classification: immediate ? "immediate_removal" : "uniform",
            completed: policy.completed,
            failed: policy.failed,
            // BullMQ has no bounded name-filtered oldest-job getter.
            retainedAge: { status: "unsupported" },
          },
        ];
      }),
    ) as NotificationRetentionObservation["families"],
  };
}

class QueueReadTimeoutError extends Error {}

function timeoutMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value <= 0 || value > MAX_TIMEOUT_MS) {
    throw new Error(
      "Notification queue read timeout must be an integer from 1 to 5000ms",
    );
  }
  return value;
}

function dedicatedConnection(): ConnectionOptions | null {
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

async function withDeadline<T>(
  promise: Promise<T>,
  deadlineMs: number,
): Promise<T> {
  let timer!: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new QueueReadTimeoutError()), deadlineMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function observe<T>(
  operation: (() => Promise<T>) | undefined,
  commandTimeoutMs: number,
): Promise<QueueObservation<T>> {
  if (!operation) return { status: "unsupported" };
  try {
    return {
      status: "observed",
      value: await withDeadline(operation(), commandTimeoutMs),
    };
  } catch (error) {
    return {
      status:
        error instanceof QueueReadTimeoutError ? "timeout" : "unavailable",
    };
  }
}

function boundedCount(value: unknown): QueueObservation<BoundedQueueCount> {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return { status: "unavailable" };
  }
  return {
    status: "observed",
    value: {
      value: Math.min(value, MAX_EXPORTED_COUNT),
      saturated: value > MAX_EXPORTED_COUNT,
    },
  };
}

function normalizeCounts(
  observation: QueueObservation<Record<string, number>>,
): QueueObservation<Record<string, number>> {
  if (observation.status !== "observed") return observation;
  if (
    !observation.value ||
    typeof observation.value !== "object" ||
    Array.isArray(observation.value)
  ) {
    return { status: "unavailable" };
  }
  return observation;
}

function normalizePaused(
  observation: QueueObservation<boolean>,
): QueueObservation<boolean> {
  if (observation.status !== "observed") return observation;
  return typeof observation.value === "boolean"
    ? observation
    : { status: "unavailable" };
}

function countForState(
  counts: QueueObservation<Record<string, number>>,
  state: NotificationQueueState,
): QueueObservation<BoundedQueueCount> {
  if (counts.status !== "observed") return counts;
  if (state === "waiting") {
    const waiting = counts.value.waiting;
    const paused = counts.value.paused;
    if (waiting === undefined || paused === undefined)
      return { status: "unsupported" };
    return boundedCount(waiting + paused);
  }
  const key = state === "waitingChildren" ? "waiting-children" : state;
  return counts.value[key] === undefined
    ? { status: "unsupported" }
    : boundedCount(counts.value[key]);
}

function ageBucket(timestamp: number | null, now: number): QueueAgeBucket {
  if (timestamp === null) return "none";
  const ageMs = now - timestamp;
  if (ageMs < 0) return "not_due";
  if (ageMs < 60_000) return "lt_1m";
  if (ageMs < 5 * 60_000) return "one_to_five_minutes";
  if (ageMs < 60 * 60_000) return "five_minutes_to_one_hour";
  if (ageMs < 24 * 60 * 60_000) return "one_to_twenty_four_hours";
  return "gte_twenty_four_hours";
}

function bucketAge(
  observation: QueueObservation<number | null>,
  now: number,
): QueueObservation<QueueAgeBucket> {
  if (observation.status !== "observed") return observation;
  if (
    observation.value !== null &&
    (!Number.isSafeInteger(observation.value) || observation.value < 0)
  ) {
    return { status: "unavailable" };
  }
  return { status: "observed", value: ageBucket(observation.value, now) };
}

function emptyObservation(
  status: "unavailable" | "unsupported",
): NotificationQueueObservation {
  return {
    consistency: "approximate_non_atomic",
    retention: retentionObservation(),
    paused: { status },
    states: Object.fromEntries(
      NOTIFICATION_QUEUE_STATES.map((state) => [
        state,
        {
          count: { status },
          oldestAge: { status },
        },
      ]),
    ) as Record<NotificationQueueState, NotificationQueueStateObservation>,
  };
}

async function disposeHandle(
  handle: NotificationQueueReadHandle,
  cleanupTimeoutMs: number,
  forceDisconnect: boolean,
): Promise<void> {
  if (forceDisconnect) {
    await withDeadline(handle.disconnect(), cleanupTimeoutMs).catch(
      () => undefined,
    );
  }
  const closed = await withDeadline(handle.close(), cleanupTimeoutMs).then(
    () => true,
    () => false,
  );
  if (!closed && !forceDisconnect) {
    await withDeadline(handle.disconnect(), cleanupTimeoutMs).catch(
      () => undefined,
    );
  }
}

/** Read a bounded, non-mutating snapshot of the shared notifications queue. */
export async function readNotificationQueue(
  options: NotificationQueueReadOptions = {},
): Promise<NotificationQueueObservation> {
  const commandTimeoutMs = timeoutMs(
    options.commandTimeoutMs,
    DEFAULT_COMMAND_TIMEOUT_MS,
  );
  const cleanupTimeoutMs = timeoutMs(
    options.cleanupTimeoutMs,
    DEFAULT_CLEANUP_TIMEOUT_MS,
  );
  const connection = dedicatedConnection();
  if (!connection) return emptyObservation("unavailable");

  let handle: NotificationQueueReadHandle;
  try {
    handle = createNotificationQueueReadHandle(connection);
  } catch {
    return emptyObservation("unavailable");
  }

  let forceDisconnect = false;
  try {
    const countsPromise = observe(handle.getCounts, commandTimeoutMs);
    const pausedPromise = observe(handle.isPaused, commandTimeoutMs);
    const agePromises = Object.fromEntries(
      NOTIFICATION_QUEUE_STATES.map((state) => [
        state,
        observe(
          handle.getOldestTimestamp
            ? () => handle.getOldestTimestamp!(state)
            : undefined,
          commandTimeoutMs,
        ),
      ]),
    ) as Record<
      NotificationQueueState,
      Promise<QueueObservation<number | null>>
    >;
    const [rawCounts, rawPaused, ageEntries] = await Promise.all([
      countsPromise,
      pausedPromise,
      Promise.all(
        NOTIFICATION_QUEUE_STATES.map(
          async (state) => [state, await agePromises[state]] as const,
        ),
      ),
    ]);
    const counts = normalizeCounts(rawCounts);
    const paused = normalizePaused(rawPaused);
    const now = Date.now();
    const states = Object.fromEntries(
      ageEntries.map(([state, age]) => [
        state,
        {
          count: countForState(counts, state),
          oldestAge: bucketAge(age, now),
        },
      ]),
    ) as Record<NotificationQueueState, NotificationQueueStateObservation>;
    forceDisconnect =
      counts.status === "timeout" ||
      paused.status === "timeout" ||
      Object.values(states).some(
        (state) => state.oldestAge.status === "timeout",
      );
    return {
      consistency: "approximate_non_atomic",
      paused,
      states,
      retention: retentionObservation(),
    };
  } finally {
    await disposeHandle(handle, cleanupTimeoutMs, forceDisconnect);
  }
}
