import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RecurringHeartbeatStore,
  recurrenceFingerprint,
} from '../../../src/worker/workerJobQueue/recurringHeartbeatStore';
import type { RecurringScheduleDefinition } from '../../../src/worker/workerJobQueue';

const syncDefinition: RecurringScheduleDefinition = {
  schedulerId: 'sync:check-stale-wallets',
  queue: 'sync',
  name: 'check-stale-wallets',
  data: {},
  recurrence: { every: 90_000 },
  freshness: { maxAgeMs: 180_000, startupGraceMs: 120_000 },
};

const webhookDefinition: RecurringScheduleDefinition = {
  schedulerId: 'maintenance:webhook:recover-due-deliveries',
  queue: 'maintenance',
  name: 'webhook:recover-due-deliveries',
  data: {},
  recurrence: { pattern: '* * * * *', tz: 'UTC' },
  freshness: { maxAgeMs: 120_000, startupGraceMs: 90_000 },
};

function generation(
  definition: RecurringScheduleDefinition,
  activatedAt = 1_000,
  generationToken = 'generation-token',
) {
  return JSON.stringify({
    version: 1,
    schedulerId: definition.schedulerId,
    recurrenceFingerprint: recurrenceFingerprint(definition.recurrence),
    generationToken,
    activatedAt,
  });
}

function completion(
  definition: RecurringScheduleDefinition,
  lastCompletedAt = 2_000,
  generationToken = 'generation-token',
) {
  return JSON.stringify({
    version: 1,
    schedulerId: definition.schedulerId,
    recurrenceFingerprint: recurrenceFingerprint(definition.recurrence),
    generationToken,
    lastCompletedAt,
  });
}

describe('RecurringHeartbeatStore', () => {
  const redis = {
    eval: vi.fn(),
    mget: vi.fn(),
    del: vi.fn(),
  };
  let store: RecurringHeartbeatStore;

  beforeEach(() => {
    vi.clearAllMocks();
    redis.eval.mockImplementation(
      (script: string, _keyCount: number, ...args: unknown[]) =>
        script.includes('local replacement')
          ? generation(
              syncDefinition,
              1_000,
              String(args[5]),
            )
          : Promise.resolve(1),
    );
    redis.mget.mockResolvedValue([]);
    redis.del.mockResolvedValue(1);
    store = new RecurringHeartbeatStore(redis as any, 'sanctuary:worker');
  });

  it('uses stable fingerprints for exact interval and UTC cron strategies', () => {
    expect(recurrenceFingerprint({ every: 90_000 })).toBe('every:90000');
    expect(
      recurrenceFingerprint({ pattern: '0 1 * * *', tz: 'UTC' }),
    ).toBe('pattern:0 1 * * *:tz:UTC');
  });

  it('atomically preserves a durable generation and repairs malformed content', async () => {
    await store.ensureGeneration(syncDefinition);

    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('pcall(cjson.decode, current)'),
      2,
      'sanctuary:worker:recurring-generation:v1:sync%3Acheck-stale-wallets',
      'sanctuary:worker:recurring-heartbeat:v1:sync%3Acheck-stale-wallets',
      1,
      syncDefinition.schedulerId,
      'every:90000',
      expect.any(String),
    );
    expect(redis.eval.mock.calls[0]![0]).toContain(
      "redis.call('SET', KEYS[1], replacement)",
    );
    expect(redis.eval.mock.calls[0]![0]).not.toContain('PEXPIRE');

    redis.eval.mockResolvedValueOnce('not-json');
    await expect(store.ensureGeneration(syncDefinition)).rejects.toThrow(
      'invalid recurring generation',
    );
  });

  it('does not create generations for schedules without freshness contracts', async () => {
    await store.ensureGeneration({
      ...syncDefinition,
      freshness: undefined,
    });
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('authenticates recurrence before recording with TTL', async () => {
    await expect(
      store.recordCompletion(
        syncDefinition.schedulerId,
        undefined,
        'generation-token',
        syncDefinition.freshness,
      ),
    ).resolves.toBe(false);
    await expect(
      store.recordCompletion(
        syncDefinition.schedulerId,
        { pattern: '* * * * *' },
        'generation-token',
        syncDefinition.freshness,
      ),
    ).resolves.toBe(false);
    expect(redis.eval).not.toHaveBeenCalled();

    await expect(
      store.recordCompletion(
        syncDefinition.schedulerId,
        { every: 90_000 },
        'generation-token',
        syncDefinition.freshness,
      ),
    ).resolves.toBe(true);
    expect(redis.eval).toHaveBeenCalledWith(
      expect.stringContaining('decoded.activatedAt ~= math.floor'),
      2,
      expect.stringContaining('recurring-generation'),
      expect.stringContaining('recurring-heartbeat'),
      1,
      syncDefinition.schedulerId,
      'every:90000',
      'generation-token',
      480_000,
    );

    redis.eval.mockResolvedValueOnce(0);
    await expect(
      store.recordCompletion(
        syncDefinition.schedulerId,
        { every: 90_000 },
        'generation-token',
        syncDefinition.freshness,
      ),
    ).resolves.toBe(false);
    redis.eval.mockResolvedValueOnce(1);
    await expect(
      store.recordCompletion(
        webhookDefinition.schedulerId,
        { pattern: '* * * * *', tz: 'UTC' },
        'generation-token',
        webhookDefinition.freshness,
      ),
    ).resolves.toBe(true);
  });

  it('clears write failures only after the same scheduler persists', async () => {
    redis.eval.mockRejectedValueOnce(new Error('sync SET unavailable'));
    await expect(
      store.recordCompletion(
        syncDefinition.schedulerId,
        { every: 90_000 },
        'generation-token',
        syncDefinition.freshness,
      ),
    ).rejects.toThrow('sync SET unavailable');

    redis.eval.mockResolvedValueOnce(1);
    await store.recordCompletion(
      webhookDefinition.schedulerId,
      { pattern: '* * * * *', tz: 'UTC' },
      'generation-token',
      webhookDefinition.freshness,
    );
    redis.mget
      .mockResolvedValueOnce([
        generation(syncDefinition),
        generation(webhookDefinition),
      ])
      .mockResolvedValueOnce([
        completion(syncDefinition),
        completion(webhookDefinition),
      ]);
    await expect(
      store.read([syncDefinition, webhookDefinition]),
    ).resolves.toEqual(expect.objectContaining({ healthy: false }));

    redis.eval.mockResolvedValueOnce(1);
    await store.recordCompletion(
      syncDefinition.schedulerId,
      { every: 90_000 },
      'generation-token',
      syncDefinition.freshness,
    );
    redis.mget
      .mockResolvedValueOnce([
        generation(syncDefinition),
        generation(webhookDefinition),
      ])
      .mockResolvedValueOnce([
        completion(syncDefinition, 3_000),
        completion(webhookDefinition),
      ]);
    await expect(
      store.read([syncDefinition, webhookDefinition]),
    ).resolves.toEqual(expect.objectContaining({ healthy: true }));
  });

  it('combines durable generations with optional expiring completions', async () => {
    redis.mget
      .mockResolvedValueOnce([generation(syncDefinition)])
      .mockResolvedValueOnce([]);
    await expect(store.read([syncDefinition])).resolves.toEqual({
      healthy: true,
      records: {
        [syncDefinition.schedulerId]: {
          version: 1,
          schedulerId: syncDefinition.schedulerId,
          recurrenceFingerprint: 'every:90000',
          generationToken: 'generation-token',
          activatedAt: 1_000,
        },
      },
    });

    redis.mget
      .mockResolvedValueOnce([generation(syncDefinition)])
      .mockResolvedValueOnce([completion(syncDefinition)]);
    await expect(store.read([syncDefinition])).resolves.toEqual({
      healthy: true,
      records: {
        [syncDefinition.schedulerId]: {
          version: 1,
          schedulerId: syncDefinition.schedulerId,
          recurrenceFingerprint: 'every:90000',
          generationToken: 'generation-token',
          activatedAt: 1_000,
          lastCompletedAt: 2_000,
        },
      },
    });
  });

  it('fails malformed, orphaned, and Redis read evidence closed', async () => {
    for (const [generationValue, completionValue] of [
      ['not-json', null],
      [generation(syncDefinition, 1.5), null],
      [generation(syncDefinition), 'not-json'],
      [generation(syncDefinition), completion(syncDefinition, 2.5)],
      [
        generation(syncDefinition),
        completion(syncDefinition, 2_000, 'stale-generation'),
      ],
      [generation(syncDefinition, -1), null],
      [generation(syncDefinition), completion(syncDefinition, -1)],
      [null, completion(syncDefinition)],
    ]) {
      redis.mget
        .mockResolvedValueOnce([generationValue])
        .mockResolvedValueOnce([completionValue]);
      await expect(store.read([syncDefinition])).resolves.toEqual(
        expect.objectContaining({ healthy: false }),
      );
    }

    redis.mget.mockRejectedValueOnce(new Error('GET unavailable'));
    await expect(store.read([syncDefinition])).resolves.toEqual({
      healthy: false,
      records: {},
    });
    await expect(store.read([])).resolves.toEqual({
      healthy: true,
      records: {},
    });
  });

  it('removes both generation and heartbeat keys and rejects TTL overflow', async () => {
    await store.remove(syncDefinition.schedulerId);
    expect(redis.del).toHaveBeenCalledWith(
      'sanctuary:worker:recurring-generation:v1:sync%3Acheck-stale-wallets',
      'sanctuary:worker:recurring-heartbeat:v1:sync%3Acheck-stale-wallets',
    );

    await expect(
      store.ensureGeneration({
        ...syncDefinition,
        freshness: {
          maxAgeMs: Number.MAX_SAFE_INTEGER,
          startupGraceMs: 1_000,
        },
      }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      store.recordCompletion(
        syncDefinition.schedulerId,
        { every: 90_000 },
        'generation-token',
        {
          maxAgeMs: Number.MAX_SAFE_INTEGER,
          startupGraceMs: 1_000,
        },
      ),
    ).rejects.toThrow('safe integer range');
  });
});
