import { afterEach, describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';

const redisConstructor = vi.hoisted(() => vi.fn());
vi.mock('ioredis', () => ({
  default: class RedisMock {
    constructor(...args: unknown[]) {
      return redisConstructor(...args);
    }
  },
}));
vi.mock('../../../../src/config', () => ({
  getConfig: () => ({ redis: { url: 'redis://telemetry-reader-test' } }),
}));
import { NotificationTelemetryReader } from '../../../../src/services/notifications/telemetryReader';

function mockClient(options: {
  time?: string;
  firstHash?: Record<string, string>;
  coverage?: { api?: number[]; worker?: number[] };
  pending?: boolean;
  status?: string;
  mutateReplies?: (replies: unknown[]) => unknown;
} = {}) {
  const exec = options.pending
    ? vi.fn(() => new Promise(() => undefined))
    : vi.fn(async (hashKeys: string[], coverageKeys: string[]) => {
      const replies = [
        ...hashKeys.map((_, index) => [null, index === 0 ? (options.firstHash ?? {}) : {}]),
        ...coverageKeys.map((key, index) => {
          const source = key.endsWith(':api') ? 'api' : 'worker';
          const offset = index % hashKeys.length;
          return [null, options.coverage?.[source]?.[offset] ?? 0];
        }),
      ];
      return options.mutateReplies ? options.mutateReplies(replies) : replies;
    });
  const pipeline = vi.fn(() => {
    const hashKeys: string[] = [];
    const coverageKeys: string[] = [];
    return {
      hgetall: vi.fn((key: string) => { hashKeys.push(key); }),
      scard: vi.fn((key: string) => { coverageKeys.push(key); }),
      exec: () => exec(hashKeys, coverageKeys),
    };
  });
  const client = {
    status: options.status ?? 'ready',
    connect: vi.fn().mockResolvedValue(undefined),
    time: vi.fn().mockResolvedValue([options.time ?? '3600', '0']),
    pipeline,
    disconnect: vi.fn(),
    on: vi.fn(),
  } as unknown as Redis;
  return { client, exec, pipeline };
}

describe('notification telemetry reader', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('aggregates only valid closed-dimension fields into fixed windows', async () => {
    const field = 'transaction|enqueue_resolved|api|queued|none|none|none';
    const { client } = mockClient({
      firstHash: { [field]: '2', 'wallet-poison': '99' },
      coverage: { api: [2, 0, 0, 1], worker: [] },
    });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes.records[0]).toMatchObject({ count: 2, source: 'api' });
    expect(JSON.stringify(result)).not.toContain('wallet-poison');
    expect(result.windows.fiveMinutes.coverage).toBe('degraded');
    expect(result.windows.fiveMinutes.sources.api).toEqual({
      observation: 'observed',
      attendance: 'partial',
      observedBuckets: 'two_to_five',
      attestedEmitterCount: 'two_to_five',
      oldestObservationAge: 'within_five_minutes',
      newestObservationAge: 'within_one_minute',
    });
    expect(result.windows.fiveMinutes.sources.worker).toMatchObject({
      observation: 'observed',
      attendance: 'none',
      oldestObservationAge: 'none',
    });
    expect(JSON.stringify(result)).not.toMatch(/bootEpoch|replicaId|hostname|workerId/i);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('returns unavailable without zero claims when Redis time fails', async () => {
    const { client } = mockClient();
    vi.mocked(client.time).mockRejectedValue(new Error('redis failed'));

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes).toMatchObject({
      observation: 'unavailable',
      coverage: 'unavailable',
      records: [],
      sources: {
        api: { observation: 'unavailable' },
        worker: { observation: 'unavailable' },
      },
    });
  });

  it('times out and force-disconnects a stalled bounded read', async () => {
    vi.useFakeTimers();
    const { client } = mockClient({ pending: true });
    const pending = new NotificationTelemetryReader(() => client).read();

    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toMatchObject({
      windows: { fiveMinutes: { observation: 'timeout' } },
    });
    expect(client.disconnect).toHaveBeenCalledWith(false);
    vi.useRealTimers();
  });

  it('keeps complete coverage fail-closed even when both sources attend every bucket', async () => {
    const { client } = mockClient({
      coverage: {
        api: Array(60).fill(1),
        worker: Array(60).fill(1),
      },
    });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes.sources.api).toMatchObject({ attendance: 'full' });
    expect(result.windows.fiveMinutes.sources.worker).toMatchObject({ attendance: 'full' });
    expect(result.windows.fiveMinutes.coverage).toBe('degraded');
    expect(JSON.stringify(result)).not.toContain('complete');
  });

  it('fails the whole snapshot closed on invalid coverage cardinality', async () => {
    const { client } = mockClient({ coverage: { api: [-1] } });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes).toMatchObject({
      observation: 'unavailable',
      coverage: 'unavailable',
      sources: {
        api: { observation: 'unavailable' },
        worker: { observation: 'unavailable' },
      },
    });
  });

  it('connects a lazy client before reading all three fixed windows', async () => {
    const { client, pipeline } = mockClient({ status: 'wait' });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(client.connect).toHaveBeenCalledOnce();
    expect(pipeline).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ version: 1, localWriter: { observation: 'unavailable' } });
  });

  it.each([
    ['not-a-number'],
    ['1.5'],
    [''],
    [' '],
    ['0x10'],
    ['+1'],
    ['1e3'],
    ['01'],
    ['9007199254740992'],
  ])('fails closed for invalid Redis time %s', async (time) => {
    const { client } = mockClient({ time });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes.observation).toBe('unavailable');
  });

  it.each([
    ['missing replies', () => null],
    ['wrong reply count', (replies: unknown[]) => replies.slice(1)],
    ['hash error', (replies: unknown[]) => { (replies[0] as unknown[])[0] = new Error('bad'); return replies; }],
    ['null hash', (replies: unknown[]) => { (replies[0] as unknown[])[1] = null; return replies; }],
    ['scalar hash', (replies: unknown[]) => { (replies[0] as unknown[])[1] = 'bad'; return replies; }],
    ['coverage error', (replies: unknown[]) => { (replies[5] as unknown[])[0] = new Error('bad'); return replies; }],
    ['noninteger coverage', (replies: unknown[]) => { (replies[5] as unknown[])[1] = 1.5; return replies; }],
  ] as const)('fails closed for malformed pipeline result: %s', async (_name, mutateReplies) => {
    const { client } = mockClient({ mutateReplies });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes.observation).toBe('unavailable');
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('ignores malformed and negative hash counts and saturates oversized totals', async () => {
    const accepted = 'transaction|transport_accepted|worker|queued|telegram|accepted|none';
    const malformedExtra = `${accepted}|extra`;
    const { client } = mockClient({
      firstHash: {
        [accepted]: '1000001',
        [malformedExtra]: '2',
        'transaction|enqueue_resolved|api|queued|none|none|none': '-1',
        'transaction|enqueue_failed|api|queued|none|none|none': 'not-a-count',
      },
    });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes.records).toEqual([
      expect.objectContaining({ count: 1_000_000, saturated: true }),
    ]);
  });

  it('reports minute and hourly observation-age bands and count buckets', async () => {
    const { client } = mockClient({
      coverage: {
        api: [21, 0, 0, 0, 0, 0, 1, ...Array(53).fill(0)],
        worker: [1, 0, 0, 0, 0, 2, ...Array(54).fill(0)],
      },
    });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.oneHour.sources.api).toMatchObject({
      observedBuckets: 'two_to_five',
      attestedEmitterCount: 'over_twenty',
      oldestObservationAge: 'within_one_hour',
      newestObservationAge: 'within_one_minute',
    });
    expect(result.windows.twentyFourHours.sources.worker).toMatchObject({
      oldestObservationAge: 'within_six_hours',
      newestObservationAge: 'within_one_hour',
    });
  });

  it('reports the oldest hourly bucket within twenty-four hours', async () => {
    const worker = Array(24).fill(0);
    worker[23] = 1;
    const { client } = mockClient({ coverage: { worker } });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.twentyFourHours.sources.worker).toMatchObject({
      attendance: 'partial',
      oldestObservationAge: 'within_twenty_four_hours',
      newestObservationAge: 'within_twenty_four_hours',
    });
  });

  it('buckets six through twenty observed buckets without exact counts', async () => {
    const { client } = mockClient({ coverage: { api: Array(10).fill(1) } });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.oneHour.sources.api).toMatchObject({
      observedBuckets: 'six_to_twenty',
      attestedEmitterCount: 'one',
    });
  });

  it('bounds record cardinality and buckets dropped dimensions', async () => {
    const stages = ['enqueue_resolved', 'enqueue_failed', 'handler_started', 'transport_attempted',
      'inline_fallback_attempted', 'inline_terminal_outcome', 'attempt_failed', 'transport_accepted',
      'terminal_completed', 'terminal_failure'];
    const outcomes = ['none', 'not_registered', 'no_recipients', 'accepted', 'rejected', 'partial', 'ambiguous'];
    const failures = ['none', 'authentication', 'permission', 'rate_limited', 'provider_rejected'];
    const firstHash: Record<string, string> = {};
    for (const stage of stages) {
      for (const outcome of outcomes) {
        for (const failure of failures) {
          firstHash[`transaction|${stage}|api|queued|telegram|${outcome}|${failure}`] = '1';
        }
      }
    }
    const { client } = mockClient({ firstHash });

    const result = await new NotificationTelemetryReader(() => client).read();

    expect(result.windows.fiveMinutes.records).toHaveLength(256);
    expect(result.windows.fiveMinutes).toMatchObject({
      truncated: true,
      droppedDimensionBucket: 'over_twenty',
    });
  });

  it('uses an isolated default client and installs a contained error listener', async () => {
    const { client } = mockClient();
    redisConstructor.mockReturnValue(client);

    const result = await new NotificationTelemetryReader().read();

    expect(result.version).toBe(1);
    expect(redisConstructor).toHaveBeenCalledWith('redis://telemetry-reader-test', expect.objectContaining({
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    }));
    expect(client.on).toHaveBeenCalledWith('error', expect.any(Function));
    const redisOptions = redisConstructor.mock.calls[0]?.[1] as { retryStrategy: () => null };
    expect(redisOptions.retryStrategy()).toBeNull();
    const errorListener = vi.mocked(client.on).mock.calls[0]?.[1] as () => undefined;
    expect(errorListener()).toBeUndefined();
  });
});
