/** Bounded aggregate-only reader for versioned notification telemetry. */
import Redis from 'ioredis';
import { z } from 'zod';
import { getConfig } from '../../config';
import {
  NOTIFICATION_FAILURE_CLASSES,
  NOTIFICATION_OUTCOMES,
  type NotificationFailureClass,
  type NotificationOutcome,
} from './outcomes';
import {
  getNotificationTelemetryLocalHealth,
  NOTIFICATION_LIFECYCLE_STAGES,
  type NotificationTelemetryLocalHealth,
  type NotificationExecutionPath,
  type NotificationLifecycleStage,
  type NotificationTelemetrySource,
} from './telemetry';

const KEY_PREFIX = 'sanctuary:diagnostics:notification:v1';
const READ_TIMEOUT_MS = 1_000;
const MAX_RECORDS = 256;
const MAX_COUNT = 1_000_000;

const countBucketSchema = z.enum([
  'zero', 'one', 'two_to_five', 'six_to_twenty', 'over_twenty',
]);
const observationAgeSchema = z.enum([
  'none',
  'within_one_minute',
  'within_five_minutes',
  'within_one_hour',
  'within_six_hours',
  'within_twenty_four_hours',
]);

const sourceAttendanceSchema = z.discriminatedUnion('observation', [
  z.object({
    observation: z.literal('observed'),
    attendance: z.enum(['none', 'partial', 'full']),
    observedBuckets: countBucketSchema,
    attestedEmitterCount: countBucketSchema,
    oldestObservationAge: observationAgeSchema,
    newestObservationAge: observationAgeSchema,
  }).strict(),
  z.object({ observation: z.literal('unavailable') }).strict(),
]);

const localWriterHealthSchema = z.discriminatedUnion('observation', [
  z.object({
    observation: z.literal('observed'),
    circuit: z.enum(['closed', 'open']),
    droppedEvents: countBucketSchema,
  }).strict(),
  z.object({ observation: z.literal('unavailable') }).strict(),
]);

export const notificationTelemetryRecordSchema = z.object({
  family: z.literal('transaction'),
  stage: z.enum(NOTIFICATION_LIFECYCLE_STAGES),
  source: z.enum(['api', 'worker']),
  path: z.enum(['queued', 'inline']),
  channel: z.enum(['none', 'telegram', 'push', 'other']),
  outcome: z.enum(['none', ...NOTIFICATION_OUTCOMES]),
  failureClass: z.enum(NOTIFICATION_FAILURE_CLASSES),
  count: z.number().int().min(0).max(MAX_COUNT),
  saturated: z.boolean(),
}).strict();

export const notificationTelemetryWindowSchema = z.object({
  observation: z.enum(['observed', 'unavailable', 'timeout']),
  coverage: z.enum(['degraded', 'unavailable']),
  records: z.array(notificationTelemetryRecordSchema).max(MAX_RECORDS),
  truncated: z.boolean(),
  droppedDimensionBucket: countBucketSchema,
  sources: z.object({
    api: sourceAttendanceSchema,
    worker: sourceAttendanceSchema,
  }).strict(),
}).strict();

export const notificationTelemetrySnapshotSchema = z.object({
  version: z.literal(1),
  localWriter: localWriterHealthSchema,
  windows: z.object({
    fiveMinutes: notificationTelemetryWindowSchema,
    oneHour: notificationTelemetryWindowSchema,
    twentyFourHours: notificationTelemetryWindowSchema,
  }).strict(),
}).strict();

export type NotificationTelemetrySnapshot = z.infer<typeof notificationTelemetrySnapshotSchema>;
type TelemetryRecord = z.infer<typeof notificationTelemetryRecordSchema>;

interface WindowDefinition {
  name: keyof NotificationTelemetrySnapshot['windows'];
  resolution: 'minute' | 'hour';
  buckets: number;
}

const WINDOWS: WindowDefinition[] = [
  { name: 'fiveMinutes', resolution: 'minute', buckets: 5 },
  { name: 'oneHour', resolution: 'minute', buckets: 60 },
  { name: 'twentyFourHours', resolution: 'hour', buckets: 24 },
];

function countBucket(value: number) {
  if (value <= 0) return 'zero' as const;
  if (value === 1) return 'one' as const;
  if (value <= 5) return 'two_to_five' as const;
  if (value <= 20) return 'six_to_twenty' as const;
  return 'over_twenty' as const;
}

function parseField(field: string, count: number): TelemetryRecord | null {
  const [family, stage, source, path, channel, outcome, failureClass, extra] = field.split('|');
  if (extra !== undefined) return null;
  const parsed = notificationTelemetryRecordSchema.safeParse({
    family,
    stage,
    source,
    path,
    channel,
    outcome,
    failureClass,
    count: Math.min(Math.max(count, 0), MAX_COUNT),
    saturated: count > MAX_COUNT,
  });
  return parsed.success ? parsed.data : null;
}

function keysFor(nowSeconds: number, definition: WindowDefinition): string[] {
  const size = definition.resolution === 'minute' ? 60 : 3600;
  const current = Math.floor(nowSeconds / size);
  return Array.from(
    { length: definition.buckets },
    (_, offset) => `${KEY_PREFIX}:${definition.resolution}:${current - offset}`,
  );
}

function coverageKey(key: string, source: NotificationTelemetrySource): string {
  // `key` is produced only by keysFor(). Keep this parser aligned with that
  // `<prefix>:<resolution>:<bucket>` format or attendance must fail closed.
  const [bucket] = key.split(':').slice(-1);
  const resolution = key.includes(':minute:') ? 'minute' : 'hour';
  return `${KEY_PREFIX}:coverage:${resolution}:${bucket}:${source}`;
}

type ObservationAge = z.infer<typeof observationAgeSchema>;

function ageForOffset(offset: number, resolution: WindowDefinition['resolution']): ObservationAge {
  if (resolution === 'minute') {
    if (offset === 0) return 'within_one_minute';
    if (offset <= 4) return 'within_five_minutes';
    return 'within_one_hour';
  }
  if (offset === 0) return 'within_one_hour';
  if (offset <= 5) return 'within_six_hours';
  return 'within_twenty_four_hours';
}

function sourceAttendance(
  counts: number[],
  resolution: WindowDefinition['resolution'],
): z.infer<typeof sourceAttendanceSchema> {
  const offsets = counts
    .map((value, offset) => value > 0 ? offset : -1)
    .filter((offset) => offset >= 0);
  if (offsets.length === 0) {
    return {
      observation: 'observed',
      attendance: 'none',
      observedBuckets: 'zero',
      attestedEmitterCount: 'zero',
      oldestObservationAge: 'none',
      newestObservationAge: 'none',
    };
  }
  return {
    observation: 'observed',
    attendance: offsets.length === counts.length ? 'full' : 'partial',
    observedBuckets: countBucket(offsets.length),
    attestedEmitterCount: countBucket(Math.max(...counts)),
    oldestObservationAge: ageForOffset(Math.max(...offsets), resolution),
    newestObservationAge: ageForOffset(Math.min(...offsets), resolution),
  };
}

function mergeHashes(
  hashes: Array<Record<string, string>>,
  coverage: Record<NotificationTelemetrySource, number[]>,
  definition: WindowDefinition,
): ReturnType<typeof buildWindow> {
  const totals = new Map<string, number>();
  for (const hash of hashes) {
    for (const [field, rawCount] of Object.entries(hash)) {
      const count = Number.parseInt(rawCount, 10);
      if (!Number.isSafeInteger(count) || count < 0) continue;
      totals.set(field, Math.min((totals.get(field) ?? 0) + count, Number.MAX_SAFE_INTEGER));
    }
  }
  return buildWindow(totals, coverage, definition);
}

function buildWindow(
  totals: Map<string, number>,
  coverage: Record<NotificationTelemetrySource, number[]>,
  definition: WindowDefinition,
) {
  const valid = [...totals.entries()]
    .map(([field, count]) => parseField(field, count))
    .filter((record): record is TelemetryRecord => record !== null)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const records = valid.slice(0, MAX_RECORDS);
  return {
    observation: 'observed' as const,
    // Replica membership is introduced by the worker-heartbeat collector. Until
    // it proves full emitter coverage, counters remain useful but non-authoritative.
    coverage: 'degraded' as const,
    records,
    truncated: valid.length > records.length,
    droppedDimensionBucket: countBucket(valid.length - records.length),
    sources: {
      api: sourceAttendance(coverage.api, definition.resolution),
      worker: sourceAttendance(coverage.worker, definition.resolution),
    },
  };
}

function failureSnapshot(
  observation: 'unavailable' | 'timeout',
  localWriter: NotificationTelemetryLocalHealth,
): NotificationTelemetrySnapshot {
  const window = {
    observation,
    coverage: 'unavailable' as const,
    records: [],
    truncated: false,
    droppedDimensionBucket: 'zero' as const,
    sources: {
      api: { observation: 'unavailable' as const },
      worker: { observation: 'unavailable' as const },
    },
  };
  return {
    version: 1,
    localWriter,
    windows: { fiveMinutes: window, oneHour: window, twentyFourHours: window },
  };
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('notification_telemetry_read_timeout')), READ_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class NotificationTelemetryReader {
  constructor(private readonly createClient: () => Redis = defaultClient) {}

  async read(): Promise<NotificationTelemetrySnapshot> {
    const localWriter = getNotificationTelemetryLocalHealth();
    const client = this.createClient();
    try {
      const operation = this.readWithClient(client);
      const snapshot = await withTimeout(operation);
      return notificationTelemetrySnapshotSchema.parse({ ...snapshot, localWriter });
    } catch (error) {
      return failureSnapshot(
        error instanceof Error && error.message === 'notification_telemetry_read_timeout'
          ? 'timeout'
          : 'unavailable',
        localWriter,
      );
    } finally {
      client.disconnect(false);
    }
  }

  private async readWithClient(
    client: Redis,
  ): Promise<Omit<NotificationTelemetrySnapshot, 'localWriter'>> {
    if (client.status === 'wait') await client.connect();
    const [seconds] = await client.time();
    const secondsText = String(seconds);
    if (!/^(0|[1-9]\d*)$/.test(secondsText)) {
      throw new Error('notification_telemetry_time_invalid');
    }
    const nowSeconds = Number(secondsText);
    if (!Number.isSafeInteger(nowSeconds)) throw new Error('notification_telemetry_time_invalid');
    const windows = {} as NotificationTelemetrySnapshot['windows'];
    for (const definition of WINDOWS) {
      const keys = keysFor(nowSeconds, definition);
      const pipeline = client.pipeline();
      for (const key of keys) pipeline.hgetall(key);
      for (const source of ['api', 'worker'] as const) {
        for (const key of keys) pipeline.scard(coverageKey(key, source));
      }
      const replies = await pipeline.exec();
      const expectedReplies = keys.length * 3;
      if (!replies || replies.length !== expectedReplies) {
        throw new Error('notification_telemetry_read_failed');
      }
      const hashes = replies.slice(0, keys.length).map(([error, value]) => {
        if (error || !value || typeof value !== 'object') {
          throw new Error('notification_telemetry_read_failed');
        }
        return value as Record<string, string>;
      });
      const coverage = { api: [] as number[], worker: [] as number[] };
      (['api', 'worker'] as const).forEach((source, sourceIndex) => {
        const start = keys.length * (sourceIndex + 1);
        coverage[source] = replies.slice(start, start + keys.length).map(([error, value]) => {
          const count = Number(value);
          if (error || !Number.isSafeInteger(count) || count < 0) {
            throw new Error('notification_telemetry_read_failed');
          }
          return count;
        });
      });
      windows[definition.name] = mergeHashes(hashes, coverage, definition);
    }
    return { version: 1, windows };
  }
}

function defaultClient(): Redis {
  const client = new Redis(getConfig().redis.url, {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  return client;
}

export type {
  NotificationExecutionPath,
  NotificationFailureClass,
  NotificationLifecycleStage,
  NotificationOutcome,
  NotificationTelemetrySource,
};
