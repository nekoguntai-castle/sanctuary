import type Redis from 'ioredis';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseDeadLetterEntry,
  serializeDeadLetterEntry,
} from '../../../src/services/deadLetterRecord';
import { MemoryDeadLetterStore } from '../../../src/services/memoryDeadLetterStore';
import { RedisDeadLetterStore } from '../../../src/services/redisDeadLetterStore';
import type { DeadLetterEntry } from '../../../src/services/deadLetterQueueTypes';

function entry(
  id = 'entry-1',
  overrides: Partial<DeadLetterEntry> = {},
): DeadLetterEntry {
  return {
    version: 1,
    id,
    category: 'sync',
    operation: 'sync:sync-wallet',
    payload: { walletId: 'wallet-1' },
    error: 'failed',
    attempts: 3,
    firstFailedAt: new Date('2026-07-01T00:00:00.000Z'),
    lastFailedAt: new Date('2026-07-02T00:00:00.000Z'),
    ...overrides,
  };
}

function currentEntry(
  id = 'entry-1',
  overrides: Partial<DeadLetterEntry> = {},
): DeadLetterEntry {
  return entry(id, {
    firstFailedAt: new Date(Date.now() - 1_000),
    lastFailedAt: new Date(),
    ...overrides,
  });
}

describe('dead letter record serialization', () => {
  it('round-trips canonical entries and restores independent Date values', () => {
    const original = entry();
    const parsed = parseDeadLetterEntry(serializeDeadLetterEntry(original));

    expect(parsed).toEqual(original);
    expect(parsed.firstFailedAt).toBeInstanceOf(Date);
    expect(parsed.firstFailedAt).not.toBe(original.firstFailedAt);
    expect(parsed.lastFailedAt).not.toBe(original.lastFailedAt);
  });

  it.each([
    ['version', { version: 2 }],
    ['id', { id: 123 }],
    ['empty id', { id: '' }],
    ['category', { category: 'unknown' }],
    ['operation', { operation: 123 }],
    ['empty operation', { operation: '' }],
    ['missing payload', { payload: null }],
    ['primitive payload', { payload: 'wallet-1' }],
    ['array payload', { payload: [] }],
    ['error', { error: 123 }],
    ['attempts', { attempts: 1.5 }],
    ['negative attempts', { attempts: -1 }],
    ['first failure timestamp', { firstFailedAt: 1.5 }],
    ['negative first failure timestamp', { firstFailedAt: -1 }],
    ['last failure timestamp', { lastFailedAt: Number.MAX_SAFE_INTEGER + 1 }],
    ['last failure before first', { lastFailedAt: 0 }],
  ])('rejects an invalid %s', (_label, override) => {
    const stored = {
      ...JSON.parse(serializeDeadLetterEntry(entry())),
      ...override,
    };

    expect(() => parseDeadLetterEntry(JSON.stringify(stored))).toThrow(
      'Invalid dead letter entry in canonical store',
    );
  });

  it('propagates malformed JSON errors', () => {
    expect(() => parseDeadLetterEntry('{')).toThrow(SyntaxError);
  });
});

describe('MemoryDeadLetterStore', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('preserves first failure, clones dates, filters, sorts, and limits', async () => {
    const store = new MemoryDeadLetterStore();
    const first = currentEntry('sync-old');
    const originalFirstFailedAt = new Date(first.firstFailedAt);
    await store.upsert(first);
    await store.upsert(currentEntry('sync-old', {
      error: 'new failure',
      firstFailedAt: new Date(Date.now() + 10_000),
      lastFailedAt: new Date(Date.now() + 4_000),
    }));
    await store.upsert(currentEntry('push-new', {
      category: 'push',
      lastFailedAt: new Date(Date.now() + 5_000),
    }));

    const fetched = await store.get('sync-old');
    expect(fetched).toEqual(expect.objectContaining({
      error: 'new failure',
      firstFailedAt: originalFirstFailedAt,
    }));
    fetched!.lastFailedAt.setUTCFullYear(2000);
    await expect(store.get('sync-old')).resolves.toEqual(expect.objectContaining({
      lastFailedAt: expect.any(Date),
    }));
    await expect(store.list()).resolves.toHaveLength(2);
    await expect(store.list({ category: 'sync', limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: 'sync-old' }),
    ]);
    await expect(store.list({ limit: 1 })).resolves.toEqual([
      expect.objectContaining({ id: 'push-new' }),
    ]);
    await expect(store.list({ limit: -1 })).resolves.toEqual([]);
    await expect(store.list({ limit: 5_000 })).resolves.toHaveLength(2);
    await expect(store.get('missing')).resolves.toBeNull();
  });

  it('preserves the original failure timestamp for duplicate exhausted jobs', async () => {
    const store = new MemoryDeadLetterStore();
    const firstFailedAt = new Date(Date.now() - 5_000);
    const duplicateFailedAt = new Date(Date.now());
    const job = {
      version: 1 as const,
      queue: 'sync',
      name: 'sync-wallet',
      jobId: 'job-1',
      data: { walletId: 'wallet-1' },
      options: { attempts: 3 },
      exhaustedAttempt: 3,
    };
    await store.upsert(currentEntry('job-entry', {
      job,
      firstFailedAt,
      lastFailedAt: firstFailedAt,
    }));
    await store.upsert(currentEntry('job-entry', {
      job,
      error: 'duplicate delivery',
      firstFailedAt: duplicateFailedAt,
      lastFailedAt: duplicateFailedAt,
    }));

    await expect(store.get('job-entry')).resolves.toEqual(expect.objectContaining({
      error: 'failed',
      firstFailedAt,
      lastFailedAt: firstFailedAt,
    }));
  });

  it('handles missing, busy, expired, wrong-token, and absent-entry claims', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    const store = new MemoryDeadLetterStore();
    await expect(store.claim('missing', 'token', 100)).resolves.toEqual({
      status: 'missing',
    });
    await store.upsert(currentEntry());
    const claimed = await store.claim('entry-1', 'token-1', 100);
    expect(claimed).toEqual(expect.objectContaining({ status: 'claimed' }));
    await expect(store.claim('entry-1', 'token-2', 100)).resolves.toEqual({
      status: 'busy',
    });
    await expect(store.release('missing', 'token')).resolves.toBe(false);
    await expect(store.release('entry-1', 'wrong')).resolves.toBe(false);
    vi.advanceTimersByTime(101);
    await expect(store.claim('entry-1', 'token-2', 100)).resolves.toEqual(
      expect.objectContaining({ status: 'claimed' }),
    );
    await expect(store.acknowledge('entry-1', 'wrong')).resolves.toBe(false);
    await expect(store.acknowledge('missing', 'token')).resolves.toBe(false);

    const internals = store as unknown as {
      entries: Map<string, DeadLetterEntry>;
      claims: Map<string, { token: string; expiresAt: number }>;
    };
    internals.entries.delete('entry-1');
    await expect(store.acknowledge('entry-1', 'token-2')).resolves.toBe(false);
  });

  it('clears only the selected category and tombstones removed identities', async () => {
    const store = new MemoryDeadLetterStore();
    await store.upsert(currentEntry('sync-1'));
    await store.upsert(currentEntry('push-1', { category: 'push' }));

    await expect(store.clearCategory('sync')).resolves.toBe(1);
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ id: 'push-1' }),
    ]);
    await store.upsert(currentEntry('sync-1', { error: 'late duplicate' }));
    await expect(store.get('sync-1')).resolves.toBeNull();
    await expect(store.remove('missing')).resolves.toBe(false);
    await expect(store.remove('push-1')).resolves.toBe(true);
    await store.upsert(currentEntry('push-1', { category: 'push' }));
    await expect(store.get('push-1')).resolves.toBeNull();
  });

  it('expires entries, claims, and tombstones during cleanup', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-10T00:00:00.000Z'));
    const store = new MemoryDeadLetterStore();
    await store.upsert(currentEntry('expired', {
      lastFailedAt: new Date('2026-07-01T00:00:00.000Z'),
    }));
    await store.upsert(currentEntry('current', {
      lastFailedAt: new Date('2026-07-10T00:00:00.000Z'),
    }));
    await store.claim('current', 'token', 100);
    await store.remove('expired');

    const internals = store as unknown as {
      tombstones: Map<string, number>;
    };
    internals.tombstones.set('old-tombstone', Date.now() - 1);
    vi.advanceTimersByTime(101);

    await expect(store.cleanup()).resolves.toBe(0);
    expect(internals.tombstones.has('old-tombstone')).toBe(false);
    await expect(store.release('current', 'token')).resolves.toBe(false);
  });
});

describe('RedisDeadLetterStore', () => {
  let evalMock: ReturnType<typeof vi.fn>;
  let getMock: ReturnType<typeof vi.fn>;
  let store: RedisDeadLetterStore;

  beforeEach(() => {
    evalMock = vi.fn();
    getMock = vi.fn();
    store = new RedisDeadLetterStore(
      { eval: evalMock, get: getMock } as unknown as Redis,
      'test:dlq:{v1}',
    );
  });

  it('upserts canonical replies, accepts tombstones, and propagates invalid replies', async () => {
    evalMock.mockResolvedValueOnce(serializeDeadLetterEntry(entry()));
    await expect(store.upsert(entry())).resolves.toBe('entry-1');
    expect(evalMock).toHaveBeenCalledWith(
      expect.any(String),
      5,
      'test:dlq:{v1}:entry:entry-1',
      'test:dlq:{v1}:index',
      'test:dlq:{v1}:category:sync',
      'test:dlq:{v1}:claim:entry-1',
      'test:dlq:{v1}:tombstone:entry-1',
      expect.any(String),
      expect.any(Number),
      1_000,
      'test:dlq:{v1}:entry:',
      'test:dlq:{v1}:category:',
      'test:dlq:{v1}:claim:',
      'test:dlq:{v1}:tombstone:',
    );
    const script = String(evalMock.mock.calls[0]?.[0]);
    expect(script).toContain('if decoded.job and candidate.job then');
    expect(script).toContain('return current');
    expect(script).toContain('remainingTtl = math.min');
    expect(script).not.toContain('cjson.encode(candidate)');

    evalMock.mockResolvedValueOnce(0).mockResolvedValueOnce('0');
    await expect(store.upsert(entry('zero-number'))).resolves.toBe('zero-number');
    await expect(store.upsert(entry('zero-string'))).resolves.toBe('zero-string');
    evalMock.mockResolvedValueOnce('invalid');
    await expect(store.upsert(entry('invalid'))).rejects.toThrow();
  });

  it('gets existing and missing entries directly from expiring entry keys', async () => {
    getMock
      .mockResolvedValueOnce(serializeDeadLetterEntry(entry()))
      .mockResolvedValueOnce(null);

    await expect(store.get('entry-1')).resolves.toEqual(entry());
    await expect(store.get('missing')).resolves.toBeNull();
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('lists global/category entries with bounded limits and validates replies', async () => {
    evalMock.mockResolvedValueOnce([
      serializeDeadLetterEntry(entry('entry-1')),
      serializeDeadLetterEntry(entry('entry-2')),
    ]);
    await expect(store.list()).resolves.toHaveLength(2);
    expect(evalMock).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      'test:dlq:{v1}:index',
      expect.any(Number),
      '',
      'test:dlq:{v1}:entry:',
      'test:dlq:{v1}:category:',
      'test:dlq:{v1}:claim:',
      1_000,
    );

    evalMock.mockResolvedValueOnce([]);
    await expect(store.list({ category: 'sync', limit: 5_000 })).resolves.toEqual([]);
    expect(evalMock).toHaveBeenLastCalledWith(
      expect.any(String),
      1,
      expect.any(String),
      expect.any(Number),
      'sync',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      1_000,
    );
    await expect(store.list({ limit: -1 })).resolves.toEqual([]);
    evalMock.mockResolvedValueOnce('not-an-array');
    await expect(store.list({ limit: 1 })).rejects.toThrow(
      'Redis returned an invalid dead letter result',
    );
    evalMock.mockResolvedValueOnce(['invalid']);
    await expect(store.list({ limit: 1 })).rejects.toThrow();
  });

  it('decodes remove, clear, release, acknowledge, and cleanup results', async () => {
    evalMock
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce('2')
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce('3');

    await expect(store.remove('entry-1')).resolves.toBe(true);
    await expect(store.remove('missing')).resolves.toBe(false);
    await expect(store.clearCategory('sync')).resolves.toBe(2);
    await expect(store.release('entry-1', 'token')).resolves.toBe(true);
    await expect(store.release('entry-1', 'wrong')).resolves.toBe(false);
    await expect(store.acknowledge('entry-1', 'token')).resolves.toBe(true);
    await expect(store.acknowledge('entry-1', 'wrong')).resolves.toBe(false);
    await expect(store.cleanup()).resolves.toBe(3);
  });

  it('decodes every claim status and rejects malformed claims', async () => {
    evalMock
      .mockResolvedValueOnce([0])
      .mockResolvedValueOnce([2])
      .mockResolvedValueOnce([
        1,
        serializeDeadLetterEntry(entry()),
        Date.parse('2026-07-30T00:00:30.000Z'),
      ])
      .mockResolvedValueOnce([9])
      .mockResolvedValueOnce('invalid');

    await expect(store.claim('missing', 'token', 30_000)).resolves.toEqual({
      status: 'missing',
    });
    await expect(store.claim('busy', 'token', 30_000)).resolves.toEqual({
      status: 'busy',
    });
    await expect(store.claim('entry-1', 'token', 30_000)).resolves.toEqual({
      status: 'claimed',
      claim: {
        entry: entry(),
        token: 'token',
        expiresAt: new Date('2026-07-30T00:00:30.000Z'),
      },
    });
    await expect(store.claim('invalid', 'token', 30_000)).rejects.toThrow(
      'Redis returned an invalid claim status',
    );
    await expect(store.claim('invalid', 'token', 30_000)).rejects.toThrow(
      'Redis returned an invalid dead letter result',
    );
  });

  it('propagates Redis command failures', async () => {
    evalMock.mockRejectedValueOnce(new Error('Redis unavailable'));
    await expect(store.cleanup()).rejects.toThrow('Redis unavailable');
  });
});
