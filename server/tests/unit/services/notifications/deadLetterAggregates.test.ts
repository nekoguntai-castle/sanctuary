import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationDeadLetterAggregateWriter,
  NotificationDeadLetterAggregateReader,
  classifyNotificationDeadLetter,
  createNotificationDeadLetterReaderClient,
  createNotificationDeadLetterWriterClient,
  notificationDeadLetterSnapshotSchema,
  recordNotificationDeadLetterAggregate,
  shutdownNotificationDeadLetterAggregateWriter,
  writeNotificationDeadLetterAggregate,
} from '../../../../src/services/notifications/deadLetterAggregates';

function fakeReaderClient(options: {
  hashes?: Array<Record<string, string>>;
  time?: Promise<[string, string]>;
  pipelineError?: Error;
} = {}) {
  const keys: string[] = [];
  const hashes = options.hashes ?? [];
  const pipeline = {
    hgetall: vi.fn((key: string) => {
      keys.push(key);
      return pipeline;
    }),
    exec: vi.fn(async () => keys.map((_, index) => [
      options.pipelineError ?? null,
      hashes[index] ?? {},
    ])),
  };
  return {
    status: 'ready',
    time: vi.fn(() => options.time ?? Promise.resolve(['720000', '0'])),
    pipeline: vi.fn(() => pipeline),
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
    keys,
  };
}

describe('notification dead-letter aggregates', () => {
  afterEach(() => {
    shutdownNotificationDeadLetterAggregateWriter();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('covers every closed family and attempts bucket without inspecting job data', () => {
    const classify = (name: string, attemptsMade: number, progress?: unknown) => (
      classifyNotificationDeadLetter({ name, attemptsMade, progress } as Job)
    );
    expect(classify('draft-notify', 1)).toMatchObject({ jobFamily: 'draft', attempts: 'one' });
    expect(classify('confirmation-notify', 2, { notification: null })).toMatchObject({
      jobFamily: 'confirmation', attempts: 'two_to_three', failureClass: 'unknown',
    });
    expect(classify('consolidation-suggestion-notify', 6)).toMatchObject({
      jobFamily: 'consolidation', attempts: 'six_plus',
    });
  });

  it('classifies only allowlisted job metadata and never parses operational errors', () => {
    const poison = 'wallet-secret txid-secret chat-secret provider-secret';
    const classified = classifyNotificationDeadLetter({
      name: 'transaction-notify',
      attemptsMade: 5,
      progress: {
        version: 1,
        attemptOrdinal: 5,
        notification: {
          failureClass: 'authentication',
          providerError: poison,
        },
      },
      failedReason: poison,
      data: { walletId: poison, txid: poison },
    } as unknown as Job);

    expect(classified).toEqual({
      jobFamily: 'transaction',
      failureClass: 'authentication',
      attempts: 'four_to_five',
    });
    expect(JSON.stringify(classified)).not.toContain(poison);
    expect(classifyNotificationDeadLetter({
      name: poison,
      attemptsMade: Number.NaN,
      progress: {
        version: 1,
        attemptOrdinal: 1,
        notification: { failureClass: poison },
      },
    } as unknown as Job)).toEqual({
      jobFamily: 'other',
      failureClass: 'unknown',
      attempts: 'unknown',
    });
  });

  it('classifies stale or incomplete attempt progress as unknown', () => {
    const stale = classifyNotificationDeadLetter({
      name: 'transaction-notify',
      attemptsMade: 2,
      progress: {
        version: 1,
        attemptOrdinal: 1,
        notification: { failureClass: 'authentication' },
      },
    } as unknown as Job);
    const incomplete = classifyNotificationDeadLetter({
      name: 'transaction-notify',
      attemptsMade: 2,
      progress: {
        version: 1,
        notification: { failureClass: 'authentication' },
      },
    } as unknown as Job);

    expect(stale.failureClass).toBe('unknown');
    expect(incomplete.failureClass).toBe('unknown');
    expect(classifyNotificationDeadLetter({
      name: 'transaction-notify',
      attemptsMade: 2,
      progress: { version: 1, attemptOrdinal: 2, notification: 'not-an-object' },
    } as unknown as Job).failureClass).toBe('unknown');
  });

  it('persists only closed dimensions without a per-event identifier', async () => {
    const client = { eval: vi.fn().mockResolvedValue(1) };
    await writeNotificationDeadLetterAggregate(
      client as never,
      {
        jobFamily: 'transaction',
        failureClass: 'timeout',
        attempts: 'four_to_five',
      },
    );

    const serializedCall = JSON.stringify(client.eval.mock.calls[0]);
    expect(client.eval).toHaveBeenCalledWith(
      expect.any(String),
      0,
      'sanctuary:diagnostics:notification-dlq:{v1}',
      'transaction|timeout|four_to_five',
      691200,
    );
    expect(serializedCall).not.toMatch(/wallet|txid|chat|provider|job-[a-z0-9]/i);
    await writeNotificationDeadLetterAggregate(client as never, {
      jobFamily: 'transaction', failureClass: 'timeout', attempts: 'four_to_five',
    });
    expect(client.eval).toHaveBeenCalledTimes(2);
    await expect(writeNotificationDeadLetterAggregate(client as never, {
      jobFamily: 'private-name', failureClass: 'timeout', attempts: 'four_to_five',
    } as never)).rejects.toThrow();
  });

  it('delegates aggregate persistence to the isolated writer', async () => {
    const writer = { record: vi.fn().mockResolvedValue(undefined) };
    const classification = {
      jobFamily: 'transaction', failureClass: 'unknown', attempts: 'one',
    } as const;
    await expect(recordNotificationDeadLetterAggregate(
      classification,
      writer as never,
    )).resolves.toBeUndefined();
    expect(writer.record).toHaveBeenCalledWith(classification);
  });

  it('reuses one isolated connection and resets it after failure', async () => {
    const classification = {
      jobFamily: 'transaction', failureClass: 'unknown', attempts: 'one',
    } as const;
    const success = {
      status: 'wait',
      connect: vi.fn(),
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    success.connect.mockImplementation(async () => { success.status = 'ready'; });
    const createSuccess = vi.fn(() => success as never);
    const reusable = new NotificationDeadLetterAggregateWriter(createSuccess);
    await reusable.record(classification);
    await reusable.record(classification);
    expect(success.connect).toHaveBeenCalledOnce();
    expect(success.eval).toHaveBeenCalledTimes(2);
    expect(createSuccess).toHaveBeenCalledOnce();
    expect(success.disconnect).not.toHaveBeenCalled();
    reusable.close();
    expect(success.disconnect).toHaveBeenCalledWith(false);

    const failure = {
      status: 'ready',
      eval: vi.fn().mockRejectedValue(new Error('private Redis poison')),
      disconnect: vi.fn(),
    };
    const recovered = {
      status: 'ready',
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const createRecovering = vi.fn()
      .mockReturnValueOnce(failure as never)
      .mockReturnValueOnce(recovered as never);
    const recovering = new NotificationDeadLetterAggregateWriter(createRecovering);
    await expect(recovering.record(classification)).rejects.toThrow('private Redis poison');
    expect(failure.disconnect).toHaveBeenCalledWith(false);
    await expect(recovering.record(classification)).resolves.toBeUndefined();
    expect(createRecovering).toHaveBeenCalledTimes(2);
    expect(recovered.eval).toHaveBeenCalledOnce();
    recovering.close();
  });

  it('bounds timed-out writes and replaces the disconnected client', async () => {
    const classification = {
      jobFamily: 'transaction', failureClass: 'unknown', attempts: 'one',
    } as const;
    vi.useFakeTimers();
    const timeout = {
      status: 'ready',
      eval: vi.fn(() => new Promise(() => undefined)),
      disconnect: vi.fn(),
    };
    const recovered = {
      status: 'ready',
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const createClient = vi.fn()
      .mockReturnValueOnce(timeout as never)
      .mockReturnValueOnce(recovered as never);
    const writer = new NotificationDeadLetterAggregateWriter(createClient);
    const pending = writer.record(classification);
    const timeoutExpectation = expect(pending).rejects.toThrow(
      'notification_dlq_aggregate_timeout',
    );
    await vi.advanceTimersByTimeAsync(101);
    await timeoutExpectation;
    expect(timeout.disconnect).toHaveBeenCalledWith(false);
    await expect(writer.record(classification)).resolves.toBeUndefined();
    expect(createClient).toHaveBeenCalledTimes(2);
    writer.close();
  });

  it('coalesces connection startup for concurrent aggregate writes', async () => {
    let releaseConnection!: () => void;
    const connectionGate = new Promise<void>((resolve) => {
      releaseConnection = resolve;
    });
    const client = {
      status: 'wait',
      connect: vi.fn(() => connectionGate.then(() => { client.status = 'ready'; })),
      eval: vi.fn().mockResolvedValue(1),
      disconnect: vi.fn(),
    };
    const writer = new NotificationDeadLetterAggregateWriter(() => client as never);
    const classification = {
      jobFamily: 'transaction', failureClass: 'unknown', attempts: 'one',
    } as const;

    const writes = [writer.record(classification), writer.record(classification)];
    expect(client.connect).toHaveBeenCalledOnce();
    releaseConnection();
    await expect(Promise.all(writes)).resolves.toEqual([undefined, undefined]);
    expect(client.eval).toHaveBeenCalledTimes(2);
    writer.close();
  });

  it('contains a connection failure that settles after shutdown', async () => {
    let rejectConnection!: (error: Error) => void;
    const connectionGate = new Promise<void>((_resolve, reject) => {
      rejectConnection = reject;
    });
    const client = {
      status: 'wait',
      connect: vi.fn(() => connectionGate),
      eval: vi.fn(),
      disconnect: vi.fn(),
    };
    const writer = new NotificationDeadLetterAggregateWriter(() => client as never);
    const pending = writer.record({
      jobFamily: 'transaction', failureClass: 'unknown', attempts: 'one',
    });
    const expectation = expect(pending).rejects.toThrow('late connection failure');

    writer.close();
    rejectConnection(new Error('late connection failure'));
    await expectation;
    expect(client.eval).not.toHaveBeenCalled();
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('allows the process-local writer to be shut down before Redis is available', async () => {
    vi.stubEnv('REDIS_URL', '');
    await expect(recordNotificationDeadLetterAggregate({
      jobFamily: 'transaction', failureClass: 'unknown', attempts: 'one',
    })).rejects.toThrow('notification_dlq_aggregate_unavailable');

    expect(() => shutdownNotificationDeadLetterAggregateWriter()).not.toThrow();
    expect(() => shutdownNotificationDeadLetterAggregateWriter()).not.toThrow();
  });

  it('reads only fixed hourly aggregate keys and drops poison dimensions', async () => {
    const poison = 'user-123|wallet-456|txid-789|chat-000';
    const client = fakeReaderClient({
      hashes: [{
        'transaction|authentication|four_to_five': '2',
        [poison]: '99',
        'transaction|authentication|four_to_five|extra': '5',
        'draft|timeout|two_to_three': '2not-a-count',
      }],
    });
    const reader = new NotificationDeadLetterAggregateReader(() => client as never);

    const snapshot = await reader.read();

    expect(notificationDeadLetterSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(snapshot).toEqual(expect.objectContaining({
      version: 1,
      observation: 'observed',
      coverage: 'degraded',
      retention: {
        window: 'seven_days',
        counts: 'best_effort_exhaustion_attempt',
        duplicateCallbacks: 'may_increment',
        retryClaimRemovalEffect: 'historical_event_retained_until_expiry',
      },
      records: [{
        jobFamily: 'transaction',
        failureClass: 'authentication',
        attempts: 'four_to_five',
        count: 2,
        saturated: false,
        lastSeenAge: 'lt_one_hour',
      }],
      truncated: true,
      droppedDimensionBucket: 'two_to_five',
    }));
    expect(client.keys).toHaveLength(168);
    expect(client.keys.every((key) => (
      /^sanctuary:diagnostics:notification-dlq:\{v1\}:hour:\d+$/.test(key)
    ))).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(poison);
    expect(client.disconnect).toHaveBeenCalledWith(false);
  });

  it('saturates counts and derives coarse last-seen age from fixed buckets', async () => {
    const client = fakeReaderClient({
      hashes: [
        { 'draft|timeout|six_plus': '900000' },
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
        {}, {}, {}, {}, {}, {}, {}, {}, {}, {},
        { 'draft|timeout|six_plus': '900000' },
      ],
    });
    const reader = new NotificationDeadLetterAggregateReader(() => client as never);

    await expect(reader.read()).resolves.toEqual(expect.objectContaining({
      records: [expect.objectContaining({
        count: 1_000_000,
        saturated: true,
        lastSeenAge: 'lt_one_hour',
      })],
    }));
  });

  it('derives every coarse age and sorts closed aggregate dimensions', async () => {
    const hashes: Array<Record<string, string>> = Array.from({ length: 168 }, () => ({}));
    hashes[2] = { 'transaction|network|one': '1' };
    hashes[8] = { 'draft|timeout|two_to_three': '1' };
    hashes[30] = { 'confirmation|provider_rejected|four_to_five': '1' };
    hashes[100] = { 'consolidation|other|six_plus': '1' };
    const client = fakeReaderClient({ hashes });
    const snapshot = await new NotificationDeadLetterAggregateReader(
      () => client as never,
    ).read();

    expect(snapshot.records.map(({ lastSeenAge }) => lastSeenAge).sort()).toEqual([
      'one_to_six_hours',
      'one_to_three_days',
      'six_to_twenty_four_hours',
      'three_to_seven_days',
    ].sort());
    expect(snapshot.records.map(({ jobFamily }) => jobFamily)).toEqual([
      'confirmation', 'consolidation', 'draft', 'transaction',
    ]);
  });

  it('fails closed for wait-state connection, invalid time, null replies, and command errors', async () => {
    const waitClient = fakeReaderClient();
    Object.assign(waitClient, { status: 'wait', connect: vi.fn().mockResolvedValue(undefined) });
    await new NotificationDeadLetterAggregateReader(() => waitClient as never).read();
    expect(waitClient.connect).toHaveBeenCalledOnce();

    const invalidTime = fakeReaderClient({ time: Promise.resolve(['not-time', '0']) });
    await expect(new NotificationDeadLetterAggregateReader(
      () => invalidTime as never,
    ).read()).resolves.toMatchObject({ observation: 'unavailable' });

    const nullReplies = fakeReaderClient();
    const pipeline = nullReplies.pipeline();
    pipeline.exec.mockResolvedValueOnce(null as never);
    nullReplies.pipeline.mockReturnValueOnce(pipeline);
    await expect(new NotificationDeadLetterAggregateReader(
      () => nullReplies as never,
    ).read()).resolves.toMatchObject({ observation: 'unavailable' });

    const commandError = fakeReaderClient({ pipelineError: new Error('private poison') });
    await expect(new NotificationDeadLetterAggregateReader(
      () => commandError as never,
    ).read()).resolves.toMatchObject({ observation: 'unavailable' });
  });

  it('buckets every amount of rejected aggregate dimensions', async () => {
    const readDroppedBucket = async (count: number) => {
      const invalid = Object.fromEntries(
        Array.from({ length: count }, (_, index) => [`private-${index}`, '1']),
      );
      const client = fakeReaderClient({ hashes: [invalid] });
      return new NotificationDeadLetterAggregateReader(() => client as never).read();
    };

    await expect(readDroppedBucket(1)).resolves.toMatchObject({
      droppedDimensionBucket: 'one', truncated: true,
    });
    await expect(readDroppedBucket(10)).resolves.toMatchObject({
      droppedDimensionBucket: 'six_to_twenty', truncated: true,
    });
    await expect(readDroppedBucket(21)).resolves.toMatchObject({
      droppedDimensionBucket: 'over_twenty', truncated: true,
    });
  });

  it('constructs an isolated lazy reader client without retry backlog', () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379');
    for (const client of [
      createNotificationDeadLetterReaderClient(),
      createNotificationDeadLetterWriterClient(),
    ]) {
      expect(client.status).toBe('wait');
      expect(client.options.enableOfflineQueue).toBe(false);
      expect(client.options.maxRetriesPerRequest).toBe(0);
      expect(client.options.retryStrategy?.(1)).toBeNull();
      expect(() => client.emit('error', new Error('contained connection error'))).not.toThrow();
      client.disconnect(false);
    }
  });

  it('refuses to create diagnostics clients without an explicit Redis URL', () => {
    vi.stubEnv('REDIS_URL', '');
    expect(() => createNotificationDeadLetterReaderClient()).toThrow(
      'notification_dlq_aggregate_unavailable',
    );
    expect(() => createNotificationDeadLetterWriterClient()).toThrow(
      'notification_dlq_aggregate_unavailable',
    );
  });

  it('returns fixed unavailable and timeout snapshots without error details', async () => {
    const unavailable = fakeReaderClient({
      time: Promise.reject(new Error('redis://user:secret@host private payload')),
    });
    await expect(new NotificationDeadLetterAggregateReader(
      () => unavailable as never,
    ).read()).resolves.toEqual(expect.objectContaining({
      observation: 'unavailable',
      coverage: 'unavailable',
      records: [],
    }));

    vi.useFakeTimers();
    const timeout = fakeReaderClient({ time: new Promise(() => undefined) });
    const pending = new NotificationDeadLetterAggregateReader(() => timeout as never).read();
    await vi.advanceTimersByTimeAsync(1_001);
    await expect(pending).resolves.toEqual(expect.objectContaining({
      observation: 'timeout',
      coverage: 'unavailable',
      records: [],
    }));
    expect(JSON.stringify(await pending)).not.toContain('secret');
  });
});
