import type Redis from 'ioredis';
import {
  parseDeadLetterEntry,
  serializeDeadLetterEntry,
} from './deadLetterRecord';
import type {
  DeadLetterCategory,
  DeadLetterClaimResult,
  DeadLetterEntry,
  DeadLetterStore,
} from './deadLetterQueueTypes';

const MAX_ENTRIES = 1_000;
const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
// The hash tag co-locates every script key in one Redis Cluster slot.
const ROOT_KEY = 'sanctuary:dlq:{v1}';

// Scripts preserve the caller's canonical JSON bytes: Redis cjson cannot
// distinguish an empty object from an empty array when re-encoding.
const UPSERT_SCRIPT = `
if redis.call('EXISTS', KEYS[5]) == 1 then return 0 end
local serverTime = redis.call('TIME')
local now = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
local candidate = cjson.decode(ARGV[1])
local current = redis.call('GET', KEYS[1])
if current then
  local decodedOk, decoded = pcall(cjson.decode, current)
  if decodedOk and type(decoded) == 'table' then
    if decoded.job and candidate.job then
      redis.call('ZADD', KEYS[2], decoded.lastFailedAt, decoded.id)
      redis.call('ZADD', ARGV[5] .. decoded.category, decoded.lastFailedAt, decoded.id)
      return current
    end
    if decoded.category ~= candidate.category then
      redis.call('ZREM', ARGV[5] .. decoded.category, candidate.id)
    end
  end
end
local remainingTtl = tonumber(ARGV[2]) - math.max(0, now - candidate.lastFailedAt)
remainingTtl = math.min(tonumber(ARGV[2]), remainingTtl)
if remainingTtl <= 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'PX', remainingTtl)
redis.call('ZADD', KEYS[2], candidate.lastFailedAt, candidate.id)
redis.call('ZADD', KEYS[3], candidate.lastFailedAt, candidate.id)
local overflow = redis.call('ZCARD', KEYS[2]) - tonumber(ARGV[3])
if overflow > 0 then
  local evicted = redis.call('ZRANGE', KEYS[2], 0, overflow - 1)
  for _, id in ipairs(evicted) do
    local raw = redis.call('GET', ARGV[4] .. id)
    if raw then
      local decodedOk, decoded = pcall(cjson.decode, raw)
      if decodedOk and type(decoded) == 'table' and decoded.category then
        redis.call('ZREM', ARGV[5] .. decoded.category, id)
      end
    end
    redis.call('DEL', ARGV[4] .. id, ARGV[6] .. id)
    redis.call('ZREM', KEYS[2], id)
    redis.call('SET', ARGV[7] .. id, '1', 'PX', ARGV[2])
  end
end
return ARGV[1]
`;

const LIST_SCRIPT = `
local serverTime = redis.call('TIME')
local now = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
for _, id in ipairs(expired) do
  local raw = redis.call('GET', ARGV[3] .. id)
  if raw then
    local decodedOk, decoded = pcall(cjson.decode, raw)
    if decodedOk and type(decoded) == 'table' and decoded.category then
      redis.call('ZREM', ARGV[4] .. decoded.category, id)
    end
  end
  redis.call('DEL', ARGV[3] .. id, ARGV[5] .. id)
  redis.call('ZREM', KEYS[1], id)
end
local source = KEYS[1]
if ARGV[2] ~= '' then source = ARGV[4] .. ARGV[2] end
local ids = redis.call('ZREVRANGE', source, 0, tonumber(ARGV[6]) - 1)
local entries = {}
for _, id in ipairs(ids) do
  local raw = redis.call('GET', ARGV[3] .. id)
  if raw then
    table.insert(entries, raw)
  else
    redis.call('ZREM', KEYS[1], id)
    redis.call('ZREM', source, id)
  end
end
return entries
`;

const REMOVE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return 0 end
local decodedOk, decoded = pcall(cjson.decode, raw)
redis.call('DEL', KEYS[1], KEYS[4])
redis.call('ZREM', KEYS[2], ARGV[1])
if decodedOk and type(decoded) == 'table' and decoded.category then
  redis.call('ZREM', ARGV[2] .. decoded.category, ARGV[1])
end
redis.call('SET', KEYS[3], '1', 'PX', ARGV[3])
return 1
`;

const CLEAR_CATEGORY_SCRIPT = `
local ids = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, id in ipairs(ids) do
  redis.call('DEL', ARGV[1] .. id, ARGV[2] .. id)
  redis.call('ZREM', KEYS[1], id)
  redis.call('SET', ARGV[3] .. id, '1', 'PX', ARGV[4])
end
redis.call('DEL', KEYS[2])
return #ids
`;

const CLAIM_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return {0} end
local claimed = redis.call('SET', KEYS[2], ARGV[1], 'NX', 'PX', ARGV[2])
if not claimed then return {2} end
local serverTime = redis.call('TIME')
local now = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
return {1, raw, now + tonumber(ARGV[2])}
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
return redis.call('DEL', KEYS[1])
`;

const ACKNOWLEDGE_SCRIPT = `
if redis.call('GET', KEYS[4]) ~= ARGV[2] then return 0 end
local raw = redis.call('GET', KEYS[1])
if raw then
  local decodedOk, decoded = pcall(cjson.decode, raw)
  if decodedOk and type(decoded) == 'table' and decoded.category then
    redis.call('ZREM', ARGV[3] .. decoded.category, ARGV[1])
  end
end
redis.call('DEL', KEYS[1], KEYS[4])
redis.call('ZREM', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], '1', 'PX', ARGV[4])
return 1
`;

const CLEANUP_SCRIPT = `
local serverTime = redis.call('TIME')
local now = (tonumber(serverTime[1]) * 1000) + math.floor(tonumber(serverTime[2]) / 1000)
local expired = redis.call('ZRANGEBYSCORE', KEYS[1], '-inf', now - tonumber(ARGV[1]))
for _, id in ipairs(expired) do
  local raw = redis.call('GET', ARGV[2] .. id)
  if raw then
    local decodedOk, decoded = pcall(cjson.decode, raw)
    if decodedOk and type(decoded) == 'table' and decoded.category then
      redis.call('ZREM', ARGV[3] .. decoded.category, id)
    end
  end
  redis.call('DEL', ARGV[2] .. id, ARGV[4] .. id)
  redis.call('ZREM', KEYS[1], id)
end
return #expired
`;

function expectArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('Redis returned an invalid dead letter result');
  }
  return value;
}

export class RedisDeadLetterStore implements DeadLetterStore {
  constructor(
    private readonly redis: Redis,
    private readonly rootKey = ROOT_KEY,
  ) {}

  async upsert(entry: DeadLetterEntry): Promise<string> {
    const raw = await this.redis.eval(
      UPSERT_SCRIPT,
      5,
      this.entryKey(entry.id),
      this.indexKey(),
      this.categoryKey(entry.category),
      this.claimKey(entry.id),
      this.tombstoneKey(entry.id),
      serializeDeadLetterEntry(entry),
      ENTRY_TTL_MS,
      MAX_ENTRIES,
      this.entryPrefix(),
      this.categoryPrefix(),
      this.claimPrefix(),
      this.tombstonePrefix(),
    );
    if (raw !== 0 && raw !== '0') parseDeadLetterEntry(String(raw));
    return entry.id;
  }

  async get(id: string): Promise<DeadLetterEntry | null> {
    const raw = await this.redis.get(this.entryKey(id));
    return raw ? parseDeadLetterEntry(raw) : null;
  }

  async list(options: {
    category?: DeadLetterCategory;
    limit?: number;
  } = {}): Promise<DeadLetterEntry[]> {
    const limit = Math.max(0, Math.min(options.limit ?? MAX_ENTRIES, MAX_ENTRIES));
    if (limit === 0) return [];
    const result = expectArray(await this.redis.eval(
      LIST_SCRIPT,
      1,
      this.indexKey(),
      ENTRY_TTL_MS,
      options.category ?? '',
      this.entryPrefix(),
      this.categoryPrefix(),
      this.claimPrefix(),
      limit,
    ));
    return result.map((raw) => parseDeadLetterEntry(String(raw)));
  }

  async remove(id: string): Promise<boolean> {
    const result = await this.redis.eval(
      REMOVE_SCRIPT,
      4,
      this.entryKey(id),
      this.indexKey(),
      this.tombstoneKey(id),
      this.claimKey(id),
      id,
      this.categoryPrefix(),
      ENTRY_TTL_MS,
    );
    return Number(result) === 1;
  }

  async clearCategory(category: DeadLetterCategory): Promise<number> {
    const result = await this.redis.eval(
      CLEAR_CATEGORY_SCRIPT,
      2,
      this.indexKey(),
      this.categoryKey(category),
      this.entryPrefix(),
      this.claimPrefix(),
      this.tombstonePrefix(),
      ENTRY_TTL_MS,
    );
    return Number(result);
  }

  async claim(
    id: string,
    token: string,
    leaseMs: number,
  ): Promise<DeadLetterClaimResult> {
    const result = expectArray(await this.redis.eval(
      CLAIM_SCRIPT,
      2,
      this.entryKey(id),
      this.claimKey(id),
      token,
      leaseMs,
    ));
    const status = Number(result[0]);
    if (status === 0) return { status: 'missing' };
    if (status === 2) return { status: 'busy' };
    if (status !== 1) throw new Error('Redis returned an invalid claim status');
    return {
      status: 'claimed',
      claim: {
        entry: parseDeadLetterEntry(String(result[1])),
        token,
        expiresAt: new Date(Number(result[2])),
      },
    };
  }

  async release(id: string, token: string): Promise<boolean> {
    return Number(await this.redis.eval(
      RELEASE_SCRIPT,
      1,
      this.claimKey(id),
      token,
    )) === 1;
  }

  async acknowledge(id: string, token: string): Promise<boolean> {
    return Number(await this.redis.eval(
      ACKNOWLEDGE_SCRIPT,
      4,
      this.entryKey(id),
      this.indexKey(),
      this.tombstoneKey(id),
      this.claimKey(id),
      id,
      token,
      this.categoryPrefix(),
      ENTRY_TTL_MS,
    )) === 1;
  }

  async cleanup(): Promise<number> {
    return Number(await this.redis.eval(
      CLEANUP_SCRIPT,
      1,
      this.indexKey(),
      ENTRY_TTL_MS,
      this.entryPrefix(),
      this.categoryPrefix(),
      this.claimPrefix(),
    ));
  }

  private indexKey(): string {
    return `${this.rootKey}:index`;
  }

  private entryPrefix(): string {
    return `${this.rootKey}:entry:`;
  }

  private entryKey(id: string): string {
    return `${this.entryPrefix()}${id}`;
  }

  private categoryPrefix(): string {
    return `${this.rootKey}:category:`;
  }

  private categoryKey(category: DeadLetterCategory): string {
    return `${this.categoryPrefix()}${category}`;
  }

  private claimPrefix(): string {
    return `${this.rootKey}:claim:`;
  }

  private claimKey(id: string): string {
    return `${this.claimPrefix()}${id}`;
  }

  private tombstonePrefix(): string {
    return `${this.rootKey}:tombstone:`;
  }

  private tombstoneKey(id: string): string {
    return `${this.tombstonePrefix()}${id}`;
  }
}
