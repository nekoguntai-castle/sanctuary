/**
 * Durable dead-letter facade. Production reads and writes go directly to Redis;
 * the memory store is reserved for explicit tests. Worker retries use a
 * claim/lease/ack protocol so dispatch failure never removes the source entry.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { getRedisClient, isRedisConnected } from '../infrastructure';
import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';
import {
  DEAD_LETTER_CATEGORIES,
  DEAD_LETTER_VERSION,
  type DeadLetterCategory,
  type DeadLetterClaimResult,
  type DeadLetterEntry,
  type DeadLetterJobEnvelope,
  type DeadLetterStats,
  type DeadLetterStore,
} from './deadLetterQueueTypes';
import { MemoryDeadLetterStore } from './memoryDeadLetterStore';
import { RedisDeadLetterStore } from './redisDeadLetterStore';
import {
  classifyNotificationDeadLetter,
  recordNotificationDeadLetterAggregate,
  type NotificationDeadLetterClassification,
} from './notifications/deadLetterAggregates';

const log = createLogger('DLQ:SVC');
const RETRY_LEASE_MS = 30_000;
const MAX_SERIALIZED_ENTRY_BYTES = 256 * 1_024;

export type {
  DeadLetterCategory,
  DeadLetterClaim,
  DeadLetterClaimResult,
  DeadLetterEntry,
  DeadLetterJobEnvelope,
  DeadLetterStats,
} from './deadLetterQueueTypes';

type StoreProvider = () => DeadLetterStore;
type NotificationAggregateRecorder = (
  classification: NotificationDeadLetterClassification,
) => Promise<void>;

function createDefaultStoreProvider(): StoreProvider {
  let redisStore: RedisDeadLetterStore | null = null;
  let redisIdentity: object | null = null;
  const testStore = new MemoryDeadLetterStore();
  return () => {
    const redis = getRedisClient();
    if (redis && isRedisConnected()) {
      if (redisIdentity !== redis) {
        redisStore = new RedisDeadLetterStore(redis);
        redisIdentity = redis;
      }
      return redisStore!;
    }
    if (process.env.NODE_ENV === 'test') return testStore;
    throw new Error('Redis is required for the dead letter queue');
  };
}

function statsFromEntries(entries: DeadLetterEntry[]): DeadLetterStats {
  const byCategory = Object.fromEntries(
    DEAD_LETTER_CATEGORIES.map((category) => [category, 0]),
  ) as Record<DeadLetterCategory, number>;
  let oldest: Date | undefined;
  let newest: Date | undefined;
  for (const entry of entries) {
    byCategory[entry.category] += 1;
    if (!oldest || entry.firstFailedAt < oldest) oldest = entry.firstFailedAt;
    if (!newest || entry.lastFailedAt > newest) newest = entry.lastFailedAt;
  }
  return { total: entries.length, byCategory, oldest, newest };
}

function validateEntrySize(entry: DeadLetterEntry): void {
  const size = Buffer.byteLength(JSON.stringify(entry));
  if (size > MAX_SERIALIZED_ENTRY_BYTES) {
    throw new Error('Dead letter entry exceeds the maximum serialized size');
  }
}

function exhaustedJobId(envelope: DeadLetterJobEnvelope): string {
  // Duplicate BullMQ failure events and repair sweeps must converge on one entry.
  const identity = JSON.stringify([
    envelope.queue,
    envelope.jobId,
    envelope.exhaustedAttempt,
  ]);
  return `job-${createHash('sha256').update(identity).digest('hex').slice(0, 32)}`;
}

function retryOptions(job: Job): DeadLetterJobEnvelope['options'] {
  return {
    attempts: job.opts.attempts,
    backoff: job.opts.backoff,
    priority: job.opts.priority,
    removeOnComplete: job.opts.removeOnComplete,
    removeOnFail: job.opts.removeOnFail,
  };
}

export class DeadLetterQueue {
  constructor(
    private readonly storeProvider: StoreProvider,
    private readonly notificationAggregateRecorder?: NotificationAggregateRecorder,
  ) {}

  async start(): Promise<void> {
    await this.storeProvider().cleanup();
    log.info('Dead letter queue started');
  }

  stop(): void {
    log.info('Dead letter queue stopped');
  }

  async add(
    category: DeadLetterCategory,
    operation: string,
    payload: Record<string, unknown>,
    error: Error | string,
    attempts: number,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    return this.upsert({
      version: DEAD_LETTER_VERSION,
      id: `diagnostic-${randomUUID()}`,
      category,
      operation,
      payload,
      error: getErrorMessage(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      attempts,
      firstFailedAt: new Date(),
      lastFailedAt: new Date(),
      metadata,
    });
  }

  async addExhaustedJob(
    category: DeadLetterCategory,
    queueName: string,
    job: Job,
    error: Error | string,
    failedAt = new Date(),
  ): Promise<string> {
    const exhaustedAttempt = job.attemptsMade;
    const envelope: DeadLetterJobEnvelope = {
      version: DEAD_LETTER_VERSION,
      queue: queueName,
      name: job.name,
      jobId: job.id ?? `${job.name}:${job.timestamp}`,
      data: job.data,
      options: retryOptions(job),
      exhaustedAttempt,
    };
    const id = await this.upsert({
      version: DEAD_LETTER_VERSION,
      id: exhaustedJobId(envelope),
      category,
      operation: `${queueName}:${job.name}`,
      payload: {
        jobId: envelope.jobId,
        jobName: job.name,
        queue: queueName,
        data: job.data,
      },
      job: envelope,
      error: getErrorMessage(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      attempts: exhaustedAttempt,
      firstFailedAt: failedAt,
      lastFailedAt: failedAt,
      metadata: { queueName, jobId: envelope.jobId },
    });
    if (
      category === 'notification'
      && queueName === 'notifications'
      && this.notificationAggregateRecorder
    ) {
      try {
        await this.notificationAggregateRecorder(classifyNotificationDeadLetter(job));
      } catch {
        log.debug('Notification dead-letter aggregate unavailable', {
          code: 'notification_dlq_aggregate_unavailable',
        });
      }
    }
    return id;
  }

  async update(
    id: string,
    error: Error | string,
    attempts: number,
  ): Promise<void> {
    const entry = await this.get(id);
    if (!entry) return;
    await this.upsert({
      ...entry,
      error: getErrorMessage(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      attempts,
      lastFailedAt: new Date(),
    });
  }

  async get(id: string): Promise<DeadLetterEntry | null> {
    return this.storeProvider().get(id);
  }

  async getByCategory(
    category: DeadLetterCategory,
  ): Promise<DeadLetterEntry[]> {
    return this.storeProvider().list({ category });
  }

  async getAll(limit?: number): Promise<DeadLetterEntry[]> {
    return this.storeProvider().list({ limit });
  }

  async getSnapshot(options: {
    category?: DeadLetterCategory;
    limit?: number;
  } = {}): Promise<{ entries: DeadLetterEntry[]; stats: DeadLetterStats }> {
    const allEntries = await this.storeProvider().list();
    const limit = Math.max(0, options.limit ?? allEntries.length);
    const entries = allEntries
      .filter((entry) => !options.category || entry.category === options.category)
      .slice(0, limit);
    return { entries, stats: statsFromEntries(allEntries) };
  }

  async getStats(): Promise<DeadLetterStats> {
    return statsFromEntries(await this.storeProvider().list());
  }

  async claimForRetry(
    id: string,
    leaseMs = RETRY_LEASE_MS,
  ): Promise<DeadLetterClaimResult> {
    if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) {
      throw new Error('Dead letter retry lease must be a positive integer');
    }
    return this.storeProvider().claim(id, randomUUID(), leaseMs);
  }

  async releaseRetry(id: string, token: string): Promise<boolean> {
    return this.storeProvider().release(id, token);
  }

  async acknowledgeRetry(id: string, token: string): Promise<boolean> {
    return this.storeProvider().acknowledge(id, token);
  }

  async remove(id: string): Promise<boolean> {
    return this.storeProvider().remove(id);
  }

  async clearCategory(category: DeadLetterCategory): Promise<number> {
    return this.storeProvider().clearCategory(category);
  }

  async loadFromRedis(): Promise<void> {
    await this.storeProvider().cleanup();
  }

  private async upsert(entry: DeadLetterEntry): Promise<string> {
    validateEntrySize(entry);
    const id = await this.storeProvider().upsert(entry);
    log.warn('Dead letter entry recorded', {
      id,
      category: entry.category,
      operation: entry.operation,
      attempts: entry.attempts,
    });
    return id;
  }
}

export function createMemoryDeadLetterQueue(): DeadLetterQueue {
  const store = new MemoryDeadLetterStore();
  return new DeadLetterQueue(() => store);
}

export const deadLetterQueue = new DeadLetterQueue(
  createDefaultStoreProvider(),
  recordNotificationDeadLetterAggregate,
);

export async function recordSyncFailure(
  walletId: string,
  error: Error | string,
  attempts: number,
  additionalInfo?: Record<string, unknown>,
): Promise<string> {
  return deadLetterQueue.add(
    'sync',
    'wallet_sync',
    { walletId, ...additionalInfo },
    error,
    attempts,
    { walletId },
  );
}

export async function recordPushFailure(
  userId: string,
  token: string,
  error: Error | string,
  attempts: number,
  payload?: Record<string, unknown>,
): Promise<string> {
  return deadLetterQueue.add(
    'push',
    'push_notification',
    { userId, token: `${token.substring(0, 20)}...`, payload },
    error,
    attempts,
    { userId },
  );
}

export async function recordElectrumFailure(
  host: string,
  port: number,
  error: Error | string,
  attempts: number,
): Promise<string> {
  return deadLetterQueue.add(
    'electrum',
    'connection',
    { host, port },
    error,
    attempts,
  );
}

export async function recordTransactionFailure(
  walletId: string,
  txid: string,
  error: Error | string,
  attempts: number,
): Promise<string> {
  return deadLetterQueue.add(
    'transaction',
    'broadcast',
    { walletId, txid },
    error,
    attempts,
    { walletId, txid },
  );
}

export default deadLetterQueue;
