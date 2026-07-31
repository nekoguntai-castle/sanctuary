import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { RepeatOptions } from 'bullmq';
import type { RecurringScheduleDefinition } from './types';
import {
  parseRecurringCompletion,
  parseRecurringGeneration,
  RECURRING_HEARTBEAT_VERSION,
  type RecurringHeartbeatRecord,
} from './recurringHeartbeatRecord';
import {
  recurrenceFingerprint,
  recurrenceFromRepeat,
} from './recurringRecurrence';

const MIN_HEARTBEAT_TTL_MS = 60_000;

const ENSURE_GENERATION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local decodedOk, decoded = pcall(cjson.decode, current)
  if decodedOk
     and type(decoded) == 'table'
     and decoded.version == tonumber(ARGV[1])
     and decoded.schedulerId == ARGV[2]
     and decoded.recurrenceFingerprint == ARGV[3]
     and type(decoded.generationToken) == 'string'
     and string.len(decoded.generationToken) > 0
     and type(decoded.activatedAt) == 'number'
     and decoded.activatedAt >= 0
     and decoded.activatedAt <= 9007199254740991
     and decoded.activatedAt == math.floor(decoded.activatedAt) then
    return current
  end
end
local serverTime = redis.call('TIME')
local activatedAt = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
local replacement = cjson.encode({
  version = tonumber(ARGV[1]),
  schedulerId = ARGV[2],
  recurrenceFingerprint = ARGV[3],
  generationToken = ARGV[4],
  activatedAt = activatedAt
})
redis.call('SET', KEYS[1], replacement)
redis.call('DEL', KEYS[2])
return replacement
`;

const RECORD_COMPLETION_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  return 0
end
local decodedOk, decoded = pcall(cjson.decode, current)
if not decodedOk
   or type(decoded) ~= 'table'
   or decoded.version ~= tonumber(ARGV[1])
   or decoded.schedulerId ~= ARGV[2]
   or decoded.recurrenceFingerprint ~= ARGV[3]
   or decoded.generationToken ~= ARGV[4]
   or type(decoded.activatedAt) ~= 'number'
   or decoded.activatedAt < 0
   or decoded.activatedAt > 9007199254740991
   or decoded.activatedAt ~= math.floor(decoded.activatedAt) then
  return 0
end
local serverTime = redis.call('TIME')
local completion = cjson.encode({
  version = tonumber(ARGV[1]),
  schedulerId = ARGV[2],
  recurrenceFingerprint = ARGV[3],
  generationToken = ARGV[4],
  lastCompletedAt = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
})
redis.call('SET', KEYS[2], completion, 'PX', ARGV[5])
return 1
`;

export interface RecurringHeartbeatSnapshot {
  healthy: boolean;
  records: Record<string, RecurringHeartbeatRecord>;
}

function heartbeatTtlMs(
  freshness: NonNullable<RecurringScheduleDefinition['freshness']>,
): number {
  const ttl = freshness.maxAgeMs * 2 + freshness.startupGraceMs;
  if (!Number.isSafeInteger(ttl) || ttl <= freshness.maxAgeMs) {
    throw new Error('Recurring heartbeat TTL exceeds the safe integer range');
  }
  return Math.max(MIN_HEARTBEAT_TTL_MS, ttl);
}

export class RecurringHeartbeatStore {
  private readonly failedSchedulerIds = new Set<string>();

  constructor(
    private readonly redis: Redis,
    private readonly queuePrefix: string,
  ) {}

  async ensureGeneration(
    definition: RecurringScheduleDefinition,
  ): Promise<string | undefined> {
    if (!definition.freshness) return undefined;
    const raw = await this.redis.eval(
      ENSURE_GENERATION_SCRIPT,
      2,
      this.generationKey(definition.schedulerId),
      this.completionKey(definition.schedulerId),
      RECURRING_HEARTBEAT_VERSION,
      definition.schedulerId,
      recurrenceFingerprint(definition.recurrence),
      randomUUID(),
    );
    const generation = parseRecurringGeneration(String(raw), definition);
    if (!generation) {
      throw new Error('Redis returned an invalid recurring generation');
    }
    return generation.generationToken;
  }

  async recordCompletion(
    schedulerId: string,
    repeat: RepeatOptions | undefined,
    generationToken: string | undefined,
    freshness: RecurringScheduleDefinition['freshness'],
  ): Promise<boolean> {
    const recurrence = recurrenceFromRepeat(repeat);
    if (!recurrence || !generationToken || !freshness) {
      return false;
    }
    try {
      const result = await this.redis.eval(
        RECORD_COMPLETION_SCRIPT,
        2,
        this.generationKey(schedulerId),
        this.completionKey(schedulerId),
        RECURRING_HEARTBEAT_VERSION,
        schedulerId,
        recurrenceFingerprint(recurrence),
        generationToken,
        heartbeatTtlMs(freshness),
      );
      const recorded = Number(result) === 1;
      if (recorded) this.failedSchedulerIds.delete(schedulerId);
      return recorded;
    } catch (error) {
      this.failedSchedulerIds.add(schedulerId);
      throw error;
    }
  }

  async read(
    definitions: RecurringScheduleDefinition[],
  ): Promise<RecurringHeartbeatSnapshot> {
    const freshnessDefinitions = definitions.filter(
      (definition) => definition.freshness,
    );
    if (freshnessDefinitions.length === 0) {
      return { healthy: true, records: {} };
    }
    try {
      return await this.readFreshnessRecords(freshnessDefinitions);
    } catch {
      return { healthy: false, records: {} };
    }
  }

  async remove(schedulerId: string): Promise<void> {
    await this.redis.del(
      this.generationKey(schedulerId),
      this.completionKey(schedulerId),
    );
    this.failedSchedulerIds.delete(schedulerId);
  }

  private async readFreshnessRecords(
    definitions: RecurringScheduleDefinition[],
  ): Promise<RecurringHeartbeatSnapshot> {
    const generationValues = await this.redis.mget(
      ...definitions.map(({ schedulerId }) => this.generationKey(schedulerId)),
    );
    const completionValues = await this.redis.mget(
      ...definitions.map(({ schedulerId }) => this.completionKey(schedulerId)),
    );
    const records: Record<string, RecurringHeartbeatRecord> = {};
    let recordsHealthy = true;
    for (const [index, definition] of definitions.entries()) {
      const generationRaw = generationValues[index] ?? null;
      const completionRaw = completionValues[index] ?? null;
      const generation = parseRecurringGeneration(generationRaw, definition);
      const completion = parseRecurringCompletion(completionRaw, definition);
      const completionMatchesGeneration =
        completion !== null &&
        generation !== null &&
        completion.generationToken === generation.generationToken;
      if (generation) {
        records[definition.schedulerId] = {
          ...generation,
          ...(completionMatchesGeneration
            ? { lastCompletedAt: completion.lastCompletedAt }
            : {}),
        };
      }
      if (
        (generationRaw !== null && !generation) ||
        (completionRaw !== null && !completion) ||
        (completion !== null && !completionMatchesGeneration)
      ) {
        recordsHealthy = false;
      }
    }
    const desiredWriteFailed = definitions.some(({ schedulerId }) =>
      this.failedSchedulerIds.has(schedulerId),
    );
    return {
      healthy: recordsHealthy && !desiredWriteFailed,
      records,
    };
  }

  private generationKey(schedulerId: string): string {
    return `${this.queuePrefix}:recurring-generation:v${RECURRING_HEARTBEAT_VERSION}:${encodeURIComponent(schedulerId)}`;
  }

  private completionKey(schedulerId: string): string {
    return `${this.queuePrefix}:recurring-heartbeat:v${RECURRING_HEARTBEAT_VERSION}:${encodeURIComponent(schedulerId)}`;
  }
}

export { recurrenceFingerprint } from './recurringRecurrence';
