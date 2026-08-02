/** Privacy-safe, bounded aggregates for exhausted notification jobs. */
import type { Job } from 'bullmq';
import Redis from 'ioredis';
import { z } from 'zod';
import {
  NOTIFICATION_FAILURE_CLASSES,
  normalizeNotificationFailureClass,
} from './outcomes';

export const NOTIFICATION_DLQ_JOB_FAMILIES = [
  'transaction',
  'draft',
  'confirmation',
  'consolidation',
  'other',
] as const;

export const NOTIFICATION_DLQ_ATTEMPT_BUCKETS = [
  'unknown',
  'one',
  'two_to_three',
  'four_to_five',
  'six_plus',
] as const;

const LAST_SEEN_AGE_BUCKETS = [
  'lt_one_hour',
  'one_to_six_hours',
  'six_to_twenty_four_hours',
  'one_to_three_days',
  'three_to_seven_days',
] as const;

type JobFamily = typeof NOTIFICATION_DLQ_JOB_FAMILIES[number];
type AttemptBucket = typeof NOTIFICATION_DLQ_ATTEMPT_BUCKETS[number];
export interface NotificationDeadLetterClassification {
  jobFamily: JobFamily;
  failureClass: AggregateRecord['failureClass'];
  attempts: AttemptBucket;
}

const KEY_PREFIX = 'sanctuary:diagnostics:notification-dlq:{v1}';
const RETENTION_HOURS = 7 * 24;
const RETENTION_SECONDS = 8 * 24 * 60 * 60;
const READ_TIMEOUT_MS = 1_000;
const WRITE_TIMEOUT_MS = 100;
const MAX_RECORDS = 128;
const MAX_COUNT = 1_000_000;

const RECORD_SCRIPT = `
local now = redis.call('TIME')
local hour = math.floor(tonumber(now[1]) / 3600)
local aggregateKey = ARGV[1] .. ':hour:' .. hour
redis.call('HINCRBY', aggregateKey, ARGV[2], 1)
redis.call('EXPIRE', aggregateKey, ARGV[3])
return 1
`;

export const notificationDeadLetterRecordSchema = z.object({
  jobFamily: z.enum(NOTIFICATION_DLQ_JOB_FAMILIES),
  failureClass: z.enum(NOTIFICATION_FAILURE_CLASSES),
  attempts: z.enum(NOTIFICATION_DLQ_ATTEMPT_BUCKETS),
  count: z.number().int().min(0).max(MAX_COUNT),
  saturated: z.boolean(),
  lastSeenAge: z.enum(LAST_SEEN_AGE_BUCKETS),
}).strict();

export const notificationDeadLetterSnapshotSchema = z.object({
  version: z.literal(1),
  observation: z.enum(['observed', 'unavailable', 'timeout']),
  coverage: z.enum(['degraded', 'unavailable']),
  retention: z.object({
    window: z.literal('seven_days'),
    counts: z.literal('best_effort_exhaustion_attempt'),
    duplicateCallbacks: z.literal('may_increment'),
    retryClaimRemovalEffect: z.literal('historical_event_retained_until_expiry'),
  }).strict(),
  records: z.array(notificationDeadLetterRecordSchema).max(MAX_RECORDS),
  truncated: z.boolean(),
  droppedDimensionBucket: z.enum([
    'zero', 'one', 'two_to_five', 'six_to_twenty', 'over_twenty',
  ]),
}).strict();

export type NotificationDeadLetterSnapshot = z.infer<
  typeof notificationDeadLetterSnapshotSchema
>;
type AggregateRecord = z.infer<typeof notificationDeadLetterRecordSchema>;

export function classifyNotificationDeadLetter(job: Job): NotificationDeadLetterClassification {
  return {
    jobFamily: classifyJobFamily(job.name),
    failureClass: readFailureClass(job.progress, job.attemptsMade),
    attempts: bucketAttempts(job.attemptsMade),
  };
}

/**
 * Persist one safe aggregate attempt. Duplicate callbacks may increment again;
 * no per-event identifier or payload is retained for idempotency.
 */
export async function recordNotificationDeadLetterAggregate(
  classification: NotificationDeadLetterClassification,
  writer = defaultAggregateWriter(),
): Promise<void> {
  await writer.record(classification);
}

export class NotificationDeadLetterAggregateWriter {
  private client: Redis | null = null;
  private connection: { client: Redis; promise: Promise<void> } | null = null;

  constructor(
    private readonly createClient: () => Redis = createNotificationDeadLetterWriterClient,
  ) {}

  async record(classification: NotificationDeadLetterClassification): Promise<void> {
    const client = this.client ??= this.createClient();
    try {
      const operation = async () => {
        await this.connectIfNeeded(client);
        await writeNotificationDeadLetterAggregate(client, classification);
      };
      await withWriteTimeout(operation());
    } catch (error) {
      client.disconnect(false);
      if (this.client === client) {
        this.client = null;
        this.connection = null;
      }
      throw error;
    }
  }

  close(): void {
    const client = this.client;
    this.client = null;
    this.connection = null;
    client?.disconnect(false);
  }

  private async connectIfNeeded(client: Redis): Promise<void> {
    if (this.connection?.client === client) {
      await this.connection.promise;
      return;
    }
    if (client.status !== 'wait') return;
    const promise = client.connect();
    this.connection = { client, promise };
    try {
      await promise;
    } finally {
      if (this.connection?.promise === promise) this.connection = null;
    }
  }
}

let aggregateWriter: NotificationDeadLetterAggregateWriter | null = null;

function defaultAggregateWriter(): NotificationDeadLetterAggregateWriter {
  return aggregateWriter ??= new NotificationDeadLetterAggregateWriter();
}

/** Close the process-local isolated writer during graceful shutdown. */
export function shutdownNotificationDeadLetterAggregateWriter(): void {
  const active = aggregateWriter;
  aggregateWriter = null;
  active?.close();
}

export async function writeNotificationDeadLetterAggregate(
  client: Pick<Redis, 'eval'>,
  classification: NotificationDeadLetterClassification,
): Promise<void> {
  const parsed = z.object({
    jobFamily: z.enum(NOTIFICATION_DLQ_JOB_FAMILIES),
    failureClass: z.enum(NOTIFICATION_FAILURE_CLASSES),
    attempts: z.enum(NOTIFICATION_DLQ_ATTEMPT_BUCKETS),
  }).strict().parse(classification);
  await client.eval(
    RECORD_SCRIPT,
    0,
    KEY_PREFIX,
    aggregateField(parsed),
    RETENTION_SECONDS,
  );
}

export class NotificationDeadLetterAggregateReader {
  constructor(
    private readonly createClient: () => Redis = createNotificationDeadLetterReaderClient,
  ) {}

  async read(): Promise<NotificationDeadLetterSnapshot> {
    const client = this.createClient();
    try {
      return notificationDeadLetterSnapshotSchema.parse(
        await withTimeout(this.readWithClient(client)),
      );
    } catch (error) {
      return failureSnapshot(
        error instanceof Error && error.message === 'notification_dlq_read_timeout'
          ? 'timeout'
          : 'unavailable',
      );
    } finally {
      client.disconnect(false);
    }
  }

  private async readWithClient(client: Redis): Promise<NotificationDeadLetterSnapshot> {
    if (client.status === 'wait') await client.connect();
    const [seconds] = await client.time();
    const nowSeconds = Number.parseInt(String(seconds), 10);
    if (!Number.isSafeInteger(nowSeconds)) throw new Error('notification_dlq_time_invalid');
    const currentHour = Math.floor(nowSeconds / 3600);
    const pipeline = client.pipeline();
    for (let offset = 0; offset < RETENTION_HOURS; offset += 1) {
      pipeline.hgetall(`${KEY_PREFIX}:hour:${currentHour - offset}`);
    }
    const replies = await pipeline.exec();
    if (!replies) throw new Error('notification_dlq_read_failed');
    return buildSnapshot(replies, currentHour);
  }
}

function classifyJobFamily(name: string): JobFamily {
  switch (name) {
    case 'transaction-notify': return 'transaction';
    case 'draft-notify': return 'draft';
    case 'confirmation-notify': return 'confirmation';
    case 'consolidation-suggestion-notify': return 'consolidation';
    default: return 'other';
  }
}

function readFailureClass(
  progress: unknown,
  exhaustedAttemptOrdinal: number,
): AggregateRecord['failureClass'] {
  if (!progress || typeof progress !== 'object') return 'unknown';
  const progressRecord = progress as Record<string, unknown>;
  if (
    progressRecord.version !== 1
    || typeof progressRecord.attemptOrdinal !== 'number'
    || !Number.isSafeInteger(progressRecord.attemptOrdinal)
    || progressRecord.attemptOrdinal !== exhaustedAttemptOrdinal
  ) return 'unknown';
  const notification = progressRecord.notification;
  if (!notification || typeof notification !== 'object') return 'unknown';
  return normalizeNotificationFailureClass(
    (notification as Record<string, unknown>).failureClass,
    'unknown',
  );
}

function bucketAttempts(attempts: number): AttemptBucket {
  if (!Number.isSafeInteger(attempts) || attempts <= 0) return 'unknown';
  if (attempts === 1) return 'one';
  if (attempts <= 3) return 'two_to_three';
  if (attempts <= 5) return 'four_to_five';
  return 'six_plus';
}

function aggregateField(value: {
  jobFamily: JobFamily;
  failureClass: AggregateRecord['failureClass'];
  attempts: AttemptBucket;
}): string {
  return `${value.jobFamily}|${value.failureClass}|${value.attempts}`;
}

function buildSnapshot(
  replies: Array<[Error | null, unknown]>,
  currentHour: number,
): NotificationDeadLetterSnapshot {
  const totals = new Map<string, { count: number; latestHour: number }>();
  let rejectedDimensions = 0;
  replies.forEach(([error, value], offset) => {
    if (error || !value || typeof value !== 'object') {
      throw new Error('notification_dlq_read_failed');
    }
    for (const [field, rawCount] of Object.entries(value as Record<string, string>)) {
      const parsed = parseAggregateField(field, rawCount, currentHour - offset);
      if (!parsed) {
        rejectedDimensions += 1;
        continue;
      }
      const current = totals.get(field);
      totals.set(field, {
        count: Math.min((current?.count ?? 0) + parsed.count, Number.MAX_SAFE_INTEGER),
        latestHour: Math.max(current?.latestHour ?? parsed.latestHour, parsed.latestHour),
      });
    }
  });
  const valid = [...totals.entries()]
    .map(([field, total]) => toRecord(field, total, currentHour))
    .sort(compareRecords);
  const records = valid.slice(0, MAX_RECORDS);
  const dropped = rejectedDimensions + valid.length - records.length;
  return {
    version: 1,
    observation: 'observed',
    coverage: 'degraded',
    retention: retentionContract(),
    records,
    truncated: dropped > 0,
    droppedDimensionBucket: countBucket(dropped),
  };
}

function parseAggregateField(
  field: string,
  rawCount: string,
  latestHour: number,
): { count: number; latestHour: number } | null {
  const [jobFamily, failureClass, attempts, extra] = field.split('|');
  if (!/^(?:0|[1-9]\d*)$/.test(rawCount)) return null;
  const count = Number(rawCount);
  if (extra !== undefined || !Number.isSafeInteger(count)) return null;
  const dimensions = z.object({
    jobFamily: z.enum(NOTIFICATION_DLQ_JOB_FAMILIES),
    failureClass: z.enum(NOTIFICATION_FAILURE_CLASSES),
    attempts: z.enum(NOTIFICATION_DLQ_ATTEMPT_BUCKETS),
  }).strict().safeParse({ jobFamily, failureClass, attempts });
  return dimensions.success ? { count, latestHour } : null;
}

function toRecord(
  field: string,
  total: { count: number; latestHour: number },
  currentHour: number,
): AggregateRecord {
  const [jobFamily, failureClass, attempts] = field.split('|');
  return notificationDeadLetterRecordSchema.parse({
    jobFamily,
    failureClass,
    attempts,
    count: Math.min(total.count, MAX_COUNT),
    saturated: total.count > MAX_COUNT,
    lastSeenAge: ageBucket(currentHour - total.latestHour),
  });
}

function ageBucket(hours: number): typeof LAST_SEEN_AGE_BUCKETS[number] {
  if (hours < 1) return 'lt_one_hour';
  if (hours < 6) return 'one_to_six_hours';
  if (hours < 24) return 'six_to_twenty_four_hours';
  if (hours < 72) return 'one_to_three_days';
  return 'three_to_seven_days';
}

function compareRecords(left: AggregateRecord, right: AggregateRecord): number {
  return aggregateField(left).localeCompare(aggregateField(right));
}

function retentionContract() {
  return {
    window: 'seven_days' as const,
    counts: 'best_effort_exhaustion_attempt' as const,
    duplicateCallbacks: 'may_increment' as const,
    retryClaimRemovalEffect: 'historical_event_retained_until_expiry' as const,
  };
}

function failureSnapshot(
  observation: 'unavailable' | 'timeout',
): NotificationDeadLetterSnapshot {
  return {
    version: 1,
    observation,
    coverage: 'unavailable',
    retention: retentionContract(),
    records: [],
    truncated: false,
    droppedDimensionBucket: 'zero',
  };
}

function countBucket(value: number) {
  if (value <= 0) return 'zero' as const;
  if (value === 1) return 'one' as const;
  if (value <= 5) return 'two_to_five' as const;
  if (value <= 20) return 'six_to_twenty' as const;
  return 'over_twenty' as const;
}

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('notification_dlq_read_timeout')), READ_TIMEOUT_MS);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function withWriteTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('notification_dlq_aggregate_timeout')),
      WRITE_TIMEOUT_MS,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function createNotificationDeadLetterWriterClient(): Redis {
  return isolatedNotificationDeadLetterClient();
}

export function createNotificationDeadLetterReaderClient(): Redis {
  return isolatedNotificationDeadLetterClient();
}

function isolatedNotificationDeadLetterClient(): Redis {
  const client = new Redis(notificationDiagnosticsRedisUrl(), {
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  client.on('error', () => undefined);
  return client;
}

function notificationDiagnosticsRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('notification_dlq_aggregate_unavailable');
  return url;
}
