import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  getConfig: () => ({ redis: { url: 'redis://telemetry-test' } }),
}));
import {
  NotificationTelemetryWriter,
  getNotificationTelemetryLocalHealth,
  initializeNotificationTelemetry,
  recordNotificationTelemetry,
  shutdownNotificationTelemetry,
  type NotificationTelemetryInput,
} from '../../../../src/services/notifications/telemetry';

function makeTelemetryInput(
  overrides: Partial<NotificationTelemetryInput> = {}
): NotificationTelemetryInput {
  return {
    family: 'transaction',
    stage: 'enqueue_resolved',
    path: 'queued',
    channel: 'none',
    outcome: 'none',
    failureClass: 'none',
    ...overrides,
  } satisfies NotificationTelemetryInput;
}

const event = makeTelemetryInput();

describe('notification telemetry writer', () => {
  const evalMock = vi.fn();
  const connectMock = vi.fn();
  const quitMock = vi.fn();
  const disconnectMock = vi.fn();
  const onMock = vi.fn();
  const client = {
    status: 'ready',
    eval: evalMock,
    connect: connectMock,
    quit: quitMock,
    disconnect: disconnectMock,
    on: onMock,
  } as unknown as Redis;

  beforeEach(() => {
    vi.clearAllMocks();
    evalMock.mockResolvedValue(1);
    connectMock.mockResolvedValue(undefined);
    quitMock.mockResolvedValue('OK');
    redisConstructor.mockReturnValue(client);
  });

  afterEach(async () => {
    await shutdownNotificationTelemetry();
  });

  it('writes only closed dimensions through the bounded atomic script', async () => {
    const writer = new NotificationTelemetryWriter('api', () => client);

    writer.record(event);
    await vi.waitFor(() => expect(evalMock).toHaveBeenCalledTimes(1));

    const args = evalMock.mock.calls[0] ?? [];
    expect(args[1]).toBe(0);
    expect(args.slice(2, 5)).toEqual([
      'sanctuary:diagnostics:notification:v1',
      'transaction|enqueue_resolved|api|queued|none|none|none',
      'api',
    ]);
    expect(JSON.stringify(args)).not.toMatch(/wallet|txid|user/i);
    await writer.close();
  });

  it('drops invalid dimensions before constructing a client', () => {
    const factory = vi.fn(() => client);
    const writer = new NotificationTelemetryWriter('api', factory);

    Reflect.apply(writer.record, writer, [{ ...event, channel: 'wallet-poison' }]);

    expect(factory).not.toHaveBeenCalled();
    expect(writer.getLocalHealth().dropped).toBe(1);
  });

  it('drops unsupported stage dimension combinations', () => {
    const factory = vi.fn(() => client);
    const writer = new NotificationTelemetryWriter('api', factory);

    writer.record({ ...event, stage: 'terminal_completed', outcome: 'accepted' });
    writer.record({ ...event, stage: 'transport_attempted', outcome: 'accepted' });

    expect(factory).not.toHaveBeenCalled();
    expect(writer.getLocalHealth().dropped).toBe(2);
  });

  it.each([
    [{ ...event, stage: 'handler_started' }, 'worker', true],
    [{ ...event, stage: 'handler_started' }, 'api', false],
    [{ ...event, stage: 'inline_fallback_attempted', path: 'inline' }, 'api', true],
    [{ ...event, stage: 'inline_fallback_attempted' }, 'api', false],
    [{ ...event, stage: 'enqueue_failed' }, 'api', true],
    [{ ...event, stage: 'attempt_failed', outcome: 'rejected' }, 'worker', true],
    [{ ...event, stage: 'terminal_failure', outcome: 'rejected' }, 'api', false],
    [{ ...event, stage: 'terminal_completed', outcome: 'accepted', channel: 'telegram' }, 'worker', false],
    [{ ...event, stage: 'inline_terminal_outcome', path: 'inline', outcome: 'accepted' }, 'api', true],
    [{ ...event, stage: 'inline_terminal_outcome', outcome: 'accepted' }, 'api', false],
    [{ ...event, stage: 'transport_attempted', channel: 'telegram', outcome: 'accepted' }, 'worker', true],
    [{ ...event, stage: 'transport_accepted', channel: 'none', outcome: 'accepted' }, 'worker', false],
  ] as const)('validates stage-specific dimensions for %#', async (input, source, accepted) => {
    const factory = vi.fn(() => client);
    const writer = new NotificationTelemetryWriter(source, factory);

    writer.record(input);

    if (accepted) {
      await vi.waitFor(() => expect(evalMock).toHaveBeenCalled());
      expect(factory).toHaveBeenCalledOnce();
    } else {
      expect(factory).not.toHaveBeenCalled();
    }
    await writer.close();
  });

  it('connects a lazy client before writing', async () => {
    const lazyClient = { ...client, status: 'wait' } as unknown as Redis;
    const writer = new NotificationTelemetryWriter('api', () => lazyClient);

    writer.record(event);

    await vi.waitFor(() => expect(evalMock).toHaveBeenCalledOnce());
    expect(connectMock).toHaveBeenCalledOnce();
    await writer.close();
  });

  it('coalesces concurrent writes behind one lazy connection', async () => {
    let finishConnect!: () => void;
    connectMock.mockReturnValue(new Promise<void>((resolve) => { finishConnect = resolve; }));
    const lazyClient = { ...client, status: 'wait' } as unknown as Redis;
    const writer = new NotificationTelemetryWriter('api', () => lazyClient);

    writer.record(event);
    writer.record(event);

    expect(connectMock).toHaveBeenCalledOnce();
    expect(evalMock).not.toHaveBeenCalled();
    finishConnect();
    await vi.waitFor(() => expect(evalMock).toHaveBeenCalledTimes(2));
    expect(writer.getLocalHealth()).toEqual({ circuit: 'closed', dropped: 0 });
    await writer.close();
  });

  it('fails closed when an injected client is already connecting without an owned promise', async () => {
    const connectingClient = { ...client, status: 'connecting' } as unknown as Redis;
    const writer = new NotificationTelemetryWriter('api', () => connectingClient);

    writer.record(event);

    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalledWith(false));
    expect(connectMock).not.toHaveBeenCalled();
    expect(evalMock).not.toHaveBeenCalled();
    expect(writer.getLocalHealth()).toEqual({ circuit: 'open', dropped: 1 });
  });

  it('does not write after closing during a lazy connection', async () => {
    let finishConnect!: () => void;
    connectMock.mockReturnValue(new Promise<void>((resolve) => { finishConnect = resolve; }));
    const lazyClient = { ...client, status: 'wait' } as unknown as Redis;
    const writer = new NotificationTelemetryWriter('api', () => lazyClient);

    writer.record(event);
    await writer.close();
    finishConnect();

    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalledWith(false));
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('opens a local circuit and disconnects after a write failure', async () => {
    evalMock.mockRejectedValue(new Error('redis unavailable'));
    const writer = new NotificationTelemetryWriter('api', () => client);

    writer.record(event);
    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalledWith(false));

    expect(writer.getLocalHealth()).toEqual({ circuit: 'open', dropped: 1 });
    expect(writer.getShareableLocalHealth()).toEqual({
      observation: 'observed',
      circuit: 'open',
      droppedEvents: 'one',
    });
    writer.record(event);
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('force-disconnects when graceful close fails', async () => {
    quitMock.mockRejectedValue(new Error('quit failed'));
    const writer = new NotificationTelemetryWriter('api', () => client);
    writer.record(event);
    await vi.waitFor(() => expect(evalMock).toHaveBeenCalled());

    await writer.close();

    expect(disconnectMock).toHaveBeenCalledWith(false);
  });

  it('closes gracefully and treats closing an unused writer as a no-op', async () => {
    const unused = new NotificationTelemetryWriter('api', () => client);
    await unused.close();
    expect(quitMock).not.toHaveBeenCalled();

    const writer = new NotificationTelemetryWriter('api', () => client);
    writer.record(event);
    await vi.waitFor(() => expect(evalMock).toHaveBeenCalled());
    await writer.close();

    expect(quitMock).toHaveBeenCalledOnce();
    expect(disconnectMock).not.toHaveBeenCalled();
  });

  it('times out a stalled write, opens the circuit, and recovers after cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    evalMock.mockImplementationOnce(() => new Promise(() => undefined)).mockResolvedValueOnce(1);
    const writer = new NotificationTelemetryWriter('api', () => client);

    writer.record(event);
    await vi.advanceTimersByTimeAsync(101);
    expect(writer.getLocalHealth()).toEqual({ circuit: 'open', dropped: 1 });

    vi.advanceTimersByTime(30_000);
    writer.record(event);
    await vi.runAllTimersAsync();
    expect(writer.getLocalHealth()).toEqual({ circuit: 'closed', dropped: 1 });
    vi.useRealTimers();
  });

  it('buckets local drop counts without exposing exact values', () => {
    const writer = new NotificationTelemetryWriter('api', () => client);
    expect(writer.getShareableLocalHealth()).toMatchObject({ droppedEvents: 'zero' });
    for (let index = 0; index < 21; index += 1) {
      Reflect.apply(writer.record, writer, [{ ...event, channel: 'invalid' }]);
      const expected = index === 0 ? 'one'
        : index < 5 ? 'two_to_five'
          : index < 20 ? 'six_to_twenty' : 'over_twenty';
      expect(writer.getShareableLocalHealth()).toMatchObject({ droppedEvents: expected });
    }
  });

  it('contains a lazy connection failure', async () => {
    const lazyClient = { ...client, status: 'wait' } as unknown as Redis;
    connectMock.mockRejectedValue(new Error('connect failed'));
    const writer = new NotificationTelemetryWriter('api', () => lazyClient);

    writer.record(event);

    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalledWith(false));
    expect(evalMock).not.toHaveBeenCalled();
  });

  it('contains a late write failure after the writer has already closed', async () => {
    let rejectWrite!: (error: Error) => void;
    evalMock.mockReturnValue(new Promise((_resolve, reject) => { rejectWrite = reject; }));
    const writer = new NotificationTelemetryWriter('api', () => client);

    writer.record(event);
    await writer.close();
    rejectWrite(new Error('late failure'));

    await vi.waitFor(() => expect(disconnectMock).toHaveBeenCalledWith(false));
    expect(writer.getLocalHealth()).toEqual({ circuit: 'open', dropped: 1 });
  });

  it('exposes only bucketed singleton writer health', () => {
    initializeNotificationTelemetry('api');
    initializeNotificationTelemetry('worker');

    expect(getNotificationTelemetryLocalHealth()).toEqual({
      observation: 'observed',
      circuit: 'closed',
      droppedEvents: 'zero',
    });
    expect(getNotificationTelemetryLocalHealth()).not.toHaveProperty('dropped');
  });

  it('uses the isolated default Redis client through the singleton lifecycle', async () => {
    expect(getNotificationTelemetryLocalHealth()).toEqual({ observation: 'unavailable' });
    recordNotificationTelemetry(event);
    expect(evalMock).not.toHaveBeenCalled();

    initializeNotificationTelemetry('api');
    recordNotificationTelemetry(event);
    await vi.waitFor(() => expect(evalMock).toHaveBeenCalledOnce());
    await shutdownNotificationTelemetry();
    await shutdownNotificationTelemetry();

    expect(redisConstructor).toHaveBeenCalledWith('redis://telemetry-test', expect.objectContaining({
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 0,
    }));
    expect(onMock).toHaveBeenCalledWith('error', expect.any(Function));
    const redisOptions = redisConstructor.mock.calls[0]?.[1] as { retryStrategy: () => null };
    expect(redisOptions.retryStrategy()).toBeNull();
    const errorListener = onMock.mock.calls[0]?.[1] as () => undefined;
    expect(errorListener()).toBeUndefined();
    expect(quitMock).toHaveBeenCalledOnce();
  });
});
