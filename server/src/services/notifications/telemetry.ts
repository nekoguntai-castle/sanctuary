/**
 * Best-effort, low-cardinality notification telemetry.
 *
 * Writes use a dedicated Redis connection with no offline queue or retry
 * backlog. Callers never await telemetry, so an observability outage cannot
 * delay enqueue or delivery. Only closed enum dimensions enter Redis keys.
 */
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { z } from 'zod';
import { getConfig } from '../../config';
import type { NotificationFailureClass, NotificationOutcome } from './outcomes';

export const NOTIFICATION_LIFECYCLE_STAGES = [
  'enqueue_resolved',
  'enqueue_failed',
  'handler_started',
  'transport_attempted',
  'inline_fallback_attempted',
  'inline_terminal_outcome',
  'attempt_failed',
  'transport_accepted',
  'terminal_completed',
  'terminal_failure',
] as const;

export type NotificationLifecycleStage = typeof NOTIFICATION_LIFECYCLE_STAGES[number];
export type NotificationTelemetrySource = 'api' | 'worker';
export type NotificationExecutionPath = 'queued' | 'inline';

export type NotificationTelemetryDropBucket =
  | 'zero'
  | 'one'
  | 'two_to_five'
  | 'six_to_twenty'
  | 'over_twenty';

export type NotificationTelemetryLocalHealth =
  | {
      observation: 'observed';
      circuit: 'closed' | 'open';
      droppedEvents: NotificationTelemetryDropBucket;
    }
  | { observation: 'unavailable' };

export interface NotificationTelemetryEvent {
  family: 'transaction';
  stage: NotificationLifecycleStage;
  source: NotificationTelemetrySource;
  path: NotificationExecutionPath;
  channel: 'none' | 'telegram' | 'push' | 'other';
  outcome: NotificationOutcome | 'none';
  failureClass: NotificationFailureClass;
}

export type NotificationTelemetryInput = Omit<NotificationTelemetryEvent, 'source'>;

const baseEventSchema = z.object({
  family: z.literal('transaction'),
  stage: z.enum(NOTIFICATION_LIFECYCLE_STAGES),
  source: z.enum(['api', 'worker']),
  path: z.enum(['queued', 'inline']),
  channel: z.enum(['none', 'telegram', 'push', 'other']),
  outcome: z.enum(['none', 'not_registered', 'no_recipients', 'accepted', 'rejected', 'partial', 'ambiguous']),
  failureClass: z.enum([
    'none', 'invalid_configuration', 'authentication', 'permission', 'rate_limited',
    'provider_rejected', 'provider_unavailable', 'timeout', 'circuit_open', 'network',
    'redis_unavailable', 'queue_add_failed', 'internal', 'unknown', 'other',
  ]),
}).strict();

const NONE_ONLY_STAGES = new Set<NotificationLifecycleStage>([
  'enqueue_resolved',
  'enqueue_failed',
  'handler_started',
  'inline_fallback_attempted',
]);
const WORKER_TERMINAL_STAGES = new Set<NotificationLifecycleStage>([
  'attempt_failed',
  'terminal_completed',
  'terminal_failure',
]);

// This matrix rejects semantically impossible stage/source/path/channel/outcome
// combinations before they can become durable metric dimensions.
function hasAllowedStageDimensions(event: NotificationTelemetryEvent): boolean {
  if (event.stage === 'handler_started') {
    return event.source === 'worker' && event.path === 'queued'
      && event.channel === 'none' && event.outcome === 'none';
  }
  if (event.stage === 'inline_fallback_attempted') {
    return event.path === 'inline' && event.channel === 'none' && event.outcome === 'none';
  }
  if (NONE_ONLY_STAGES.has(event.stage)) {
    return event.path === 'queued'
      && event.channel === 'none' && event.outcome === 'none';
  }
  if (WORKER_TERMINAL_STAGES.has(event.stage)) {
    return event.source === 'worker' && event.path === 'queued' && event.channel === 'none'
      && event.outcome !== 'none';
  }
  if (event.stage === 'inline_terminal_outcome') {
    return event.path === 'inline' && event.channel === 'none' && event.outcome !== 'none';
  }
  return event.channel !== 'none' && event.outcome !== 'none';
}

function dropBucket(value: number): NotificationTelemetryDropBucket {
  if (value <= 0) return 'zero';
  if (value === 1) return 'one';
  if (value <= 5) return 'two_to_five';
  if (value <= 20) return 'six_to_twenty';
  return 'over_twenty';
}

const eventSchema = baseEventSchema.refine(hasAllowedStageDimensions, {
  message: 'unsupported notification telemetry dimension combination',
});

const RECORD_SCRIPT = `
local now = redis.call('TIME')
local seconds = tonumber(now[1])
local minute = math.floor(seconds / 60)
local hour = math.floor(seconds / 3600)
local minuteKey = ARGV[1] .. ':minute:' .. minute
local hourKey = ARGV[1] .. ':hour:' .. hour
local minuteCoverage = ARGV[1] .. ':coverage:minute:' .. minute .. ':' .. ARGV[3]
local hourCoverage = ARGV[1] .. ':coverage:hour:' .. hour .. ':' .. ARGV[3]
redis.call('HINCRBY', minuteKey, ARGV[2], 1)
redis.call('EXPIRE', minuteKey, 3900)
redis.call('HINCRBY', hourKey, ARGV[2], 1)
redis.call('EXPIRE', hourKey, 93600)
redis.call('SADD', minuteCoverage, ARGV[4])
redis.call('EXPIRE', minuteCoverage, 3900)
redis.call('SADD', hourCoverage, ARGV[4])
redis.call('EXPIRE', hourCoverage, 93600)
return 1
`;

const KEY_PREFIX = 'sanctuary:diagnostics:notification:v1';
const COMMAND_TIMEOUT_MS = 100;
const CIRCUIT_COOLDOWN_MS = 30_000;

function fieldFor(event: NotificationTelemetryEvent): string {
  return [
    event.family, event.stage, event.source, event.path, event.channel,
    event.outcome, event.failureClass,
  ].join('|');
}

function boundedCommand<T>(promise: Promise<T>, timeoutMs = COMMAND_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('notification_telemetry_timeout')), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class NotificationTelemetryWriter {
  private client: Redis | null = null;
  private connection: { client: Redis; promise: Promise<void> } | null = null;
  private readonly bootEpoch = randomUUID();
  private circuitOpenedAt = 0;
  private dropped = 0;

  constructor(
    private readonly source: NotificationTelemetrySource,
    private readonly createClient: () => Redis = defaultClient,
  ) {}

  record(input: NotificationTelemetryInput): void {
    const parsed = eventSchema.safeParse({ ...input, source: this.source });
    if (!parsed.success || !this.canAttempt()) {
      this.dropped = Math.min(this.dropped + 1, Number.MAX_SAFE_INTEGER);
      return;
    }
    const client = this.client ??= this.createClient();
    const write = client.status === 'ready'
      ? this.write(client, parsed.data)
      : this.writeWhenReady(client, parsed.data);
    void boundedCommand(write).then(
      () => { this.circuitOpenedAt = 0; },
      () => {
        this.circuitOpenedAt = Date.now();
        this.dropped = Math.min(this.dropped + 1, Number.MAX_SAFE_INTEGER);
        client.disconnect(false);
        if (this.client === client) {
          this.client = null;
          this.connection = null;
        }
      },
    );
  }

  getLocalHealth(): { circuit: 'closed' | 'open'; dropped: number } {
    return {
      circuit: this.circuitOpenedAt === 0 ? 'closed' : 'open',
      dropped: this.dropped,
    };
  }

  getShareableLocalHealth(): NotificationTelemetryLocalHealth {
    return {
      observation: 'observed',
      circuit: this.circuitOpenedAt === 0 ? 'closed' : 'open',
      droppedEvents: dropBucket(this.dropped),
    };
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.connection = null;
    if (!client) return;
    await boundedCommand(client.quit()).catch(() => client.disconnect(false));
  }

  private canAttempt(): boolean {
    return this.circuitOpenedAt === 0 || Date.now() - this.circuitOpenedAt >= CIRCUIT_COOLDOWN_MS;
  }

  private async writeWhenReady(
    client: Redis,
    event: NotificationTelemetryEvent,
  ): Promise<unknown> {
    await this.connectIfNeeded(client);
    // Shutdown or a prior timed-out event may retire this client while its
    // connection is still resolving; never write through that stale socket.
    if (this.client !== client) throw new Error('notification_telemetry_client_replaced');
    return this.write(client, event);
  }

  private async connectIfNeeded(client: Redis): Promise<void> {
    // The writer exclusively owns its lazy client, so every normal connecting
    // state has this single-flight promise. A foreign/transient status without
    // that promise violates ownership and fails closed instead of offline-queuing.
    const active = this.connection;
    if (active?.client === client) {
      await active.promise;
      return;
    }
    if (client.status !== 'wait') {
      throw new Error('notification_telemetry_client_not_ready');
    }

    const promise = client.connect();
    this.connection = { client, promise };
    try {
      await promise;
    } finally {
      if (this.connection?.promise === promise) this.connection = null;
    }
  }

  private write(client: Redis, event: NotificationTelemetryEvent): Promise<unknown> {
    return client.eval(
      RECORD_SCRIPT,
      0,
      KEY_PREFIX,
      fieldFor(event),
      this.source,
      this.bootEpoch,
    );
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

let writer: NotificationTelemetryWriter | null = null;

/** Initialize the process-local writer once its runtime role is known. */
export function initializeNotificationTelemetry(source: NotificationTelemetrySource): void {
  writer ??= new NotificationTelemetryWriter(source);
}

/** Record without blocking the notification critical path. */
export function recordNotificationTelemetry(event: NotificationTelemetryInput): void {
  writer?.record(event);
}

/** Return only bounded process-local writer state suitable for support output. */
export function getNotificationTelemetryLocalHealth(): NotificationTelemetryLocalHealth {
  return writer?.getShareableLocalHealth() ?? { observation: 'unavailable' };
}

/** Close the isolated telemetry connection during graceful shutdown. */
export async function shutdownNotificationTelemetry(): Promise<void> {
  const active = writer;
  writer = null;
  await active?.close();
}
