import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  constructor: vi.fn(),
  getRedisClient: vi.fn(),
  isRedisConnected: vi.fn(),
  queue: {
    getJob: vi.fn(),
    close: vi.fn(),
    disconnect: vi.fn(),
  },
}));

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    constructor(...args: unknown[]) {
      mocks.constructor(...args);
      return mocks.queue;
    }
  },
}));

vi.mock('../../../../../src/infrastructure/redis', () => ({
  getRedisClient: mocks.getRedisClient,
  isRedisConnected: mocks.isRedisConnected,
}));

import { toBullMqJobId } from '../../../../../src/jobs/bullMqJobIds';
import { readIncidentJobEvidence } from '../../../../../src/services/supportPackage/incident/jobEvidence';
import type { IncidentSelectors } from '../../../../../src/services/supportPackage/incident/types';

const nowMs = Date.parse('2026-08-02T12:00:00.000Z');
const selectors: IncidentSelectors = {
  txid: 'b'.repeat(64),
  senderWalletId: 'sender-wallet-secret',
  receiverWalletId: 'receiver-wallet-secret',
  approximateIncidentAt: new Date(nowMs),
};

function job(overrides: Record<string, unknown> = {}) {
  const value = {
    name: 'transaction-notify',
    data: {
      walletId: selectors.senderWalletId,
      txid: selectors.txid,
      type: 'sent',
      amount: 'private-amount',
    },
    attemptsMade: 1,
    timestamp: nowMs - 30_000,
    processedOn: nowMs - 20_000,
    finishedOn: nowMs - 10_000,
    progress: 0,
    returnvalue: {
      version: 1,
      success: true,
      channelsNotified: 999,
      outcome: 'accepted',
      failureClass: 'none',
      channelOutcomes: [{
        channel: 'telegram',
        outcome: 'accepted',
        failureClass: 'none',
      }],
    },
    getState: vi.fn(async () => 'completed'),
    ...overrides,
  };
  Object.defineProperty(value, 'failedReason', {
    get() {
      throw new Error('failedReason must not be read');
    },
  });
  return value;
}

describe('incident notification job evidence', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.getRedisClient.mockReturnValue({
      options: {
        host: 'redis.internal',
        port: 6380,
        username: 'worker',
        password: 'redis-secret',
        db: 4,
      },
    });
    mocks.isRedisConnected.mockReturnValue(true);
    mocks.queue.close.mockResolvedValue(undefined);
    mocks.queue.disconnect.mockResolvedValue(undefined);
  });

  it('uses exact stable job getters and emits only typed sender/receiver categories', async () => {
    const senderJob = job();
    const receiverJob = job({
      data: {
        walletId: selectors.receiverWalletId,
        txid: selectors.txid,
        type: 'received',
      },
      attemptsMade: 2,
      processedOn: nowMs - 10 * 60_000,
      finishedOn: nowMs - 2 * 60_000,
      progress: {
        version: 1,
        attemptOrdinal: 2,
        notification: {
          version: 1,
          outcome: 'rejected',
          failureClass: 'authentication',
          channels: [{
            channel: 'telegram',
            outcome: 'rejected',
            failureClass: 'authentication',
          }],
          rawProviderText: 'private-provider-text',
        },
      },
      returnvalue: null,
      getState: vi.fn(async () => 'failed'),
    });
    const senderId = toBullMqJobId(`txnotify:${selectors.senderWalletId}:${selectors.txid}`);
    const receiverId = toBullMqJobId(`txnotify:${selectors.receiverWalletId}:${selectors.txid}`);
    mocks.queue.getJob.mockImplementation(async (id: string) => (
      id === senderId ? senderJob : id === receiverId ? receiverJob : null
    ));

    const result = await readIncidentJobEvidence(selectors, { nowMs });

    expect(mocks.constructor).toHaveBeenCalledWith('notifications', {
      connection: {
        host: 'redis.internal',
        port: 6380,
        username: 'worker',
        password: 'redis-secret',
        db: 4,
      },
      prefix: 'sanctuary:worker',
      skipMetasUpdate: true,
      skipWaitingForReady: true,
    });
    expect(mocks.queue.getJob.mock.calls).toEqual([[senderId], [receiverId]]);
    expect(result[0]).toMatchObject({
      role: 'sender',
      expectedDirection: 'sent',
      present: 'observed_true',
      state: 'completed',
      attempts: 'one',
      enqueue: 'resolved',
      handler: 'started',
      terminal: 'completed',
      telegram: { outcome: 'accepted', failureClass: 'none' },
    });
    expect(result[1]).toMatchObject({
      role: 'receiver',
      expectedDirection: 'received',
      present: 'observed_true',
      state: 'failed',
      attempts: 'two_to_three',
      terminal: 'failed',
      telegram: { outcome: 'rejected', failureClass: 'authentication' },
    });
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      selectors.txid,
      selectors.senderWalletId,
      selectors.receiverWalletId,
      'private-amount',
      'private-provider-text',
      '999',
    ]) expect(serialized).not.toContain(forbidden);
    expect(mocks.queue.close).toHaveBeenCalledOnce();
    expect(mocks.queue.disconnect).not.toHaveBeenCalled();
  });

  it('keeps an absent retained job explicitly not observed', async () => {
    mocks.queue.getJob.mockResolvedValue(null);
    const result = await readIncidentJobEvidence(selectors, { nowMs });
    expect(result.map((entry) => entry)).toEqual([
      expect.objectContaining({
        role: 'sender',
        lookupStatus: 'observed',
        present: 'not_observed',
        enqueue: 'not_observed',
        terminal: 'not_observed',
        retention: expect.objectContaining({ record: 'not_retained' }),
      }),
      expect.objectContaining({
        role: 'receiver',
        lookupStatus: 'observed',
        present: 'not_observed',
        enqueue: 'not_observed',
        terminal: 'not_observed',
        retention: expect.objectContaining({ record: 'not_retained' }),
      }),
    ]);
  });

  it('does not use stale failed progress or untyped retained fields', async () => {
    mocks.queue.getJob.mockResolvedValue(job({
      attemptsMade: 3,
      progress: {
        version: 1,
        attemptOrdinal: 2,
        notification: {
          version: 1,
          outcome: 'accepted',
          failureClass: 'none',
          channels: [{ channel: 'telegram', outcome: 'accepted', failureClass: 'none' }],
        },
      },
      returnvalue: null,
      getState: vi.fn(async () => 'failed'),
    }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0].terminal).toBe('failed');
    expect(result[0].telegram).toEqual({
      outcome: 'not_observed',
      failureClass: 'not_observed',
    });
  });

  it('maps a true empty not-registered result without inventing a Telegram result', async () => {
    mocks.queue.getJob.mockResolvedValue(job({
      returnvalue: {
        version: 1,
        outcome: 'not_registered',
        failureClass: 'none',
        channelOutcomes: [],
      },
    }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0].telegram).toEqual({
      outcome: 'not_registered',
      failureClass: 'none',
    });
  });

  it('rejects identity mismatches and malformed or duplicate Telegram evidence', async () => {
    const mismatch = job({ name: 'draft-notify' });
    mocks.queue.getJob.mockResolvedValue(mismatch);
    const identity = await readIncidentJobEvidence(selectors, { nowMs });
    expect(identity[0].lookupStatus).toBe('unavailable');

    mocks.queue.getJob.mockResolvedValue(job({
      returnvalue: {
        version: 1,
        outcome: 'accepted',
        failureClass: 'none',
        channelOutcomes: [
          { channel: 'telegram', outcome: 'accepted', failureClass: 'none' },
          { channel: 'telegram', outcome: 'accepted', failureClass: 'none' },
        ],
      },
    }));
    const duplicate = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(duplicate[0].telegram.outcome).toBe('not_observed');
  });

  it.each([
    ['waiting', 0, 'none', 'not_started', 'not_terminal'],
    ['active', 0, 'none', 'started', 'not_terminal'],
    ['delayed', 4, 'four_to_five', 'started', 'not_terminal'],
    ['prioritized', 6, 'six_plus', 'started', 'not_terminal'],
    ['waiting-children', 0, 'none', 'not_started', 'not_terminal'],
    ['mystery', -1, 'unknown', 'not_observed', 'not_observed'],
  ])('categorizes retained %s jobs', async (rawState, attemptsMade, attempts, handler, terminal) => {
    mocks.queue.getJob.mockResolvedValue(job({
      attemptsMade,
      processedOn: undefined,
      finishedOn: undefined,
      getState: vi.fn(async () => rawState),
    }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0]).toMatchObject({ attempts, handler, terminal });
  });

  it.each([
    [nowMs - 2 * 60 * 60_000, 'one_to_twenty_four_hours'],
    [nowMs - 25 * 60 * 60_000, 'gte_twenty_four_hours'],
    [nowMs + 1, 'not_observed'],
    [-1, 'not_observed'],
  ])('categorizes retained timestamps without exporting them', async (timestamp, expected) => {
    mocks.queue.getJob.mockResolvedValue(job({ timestamp }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0].ages.created).toBe(expected);
  });

  it.each([
    null,
    { version: 2, outcome: 'accepted', failureClass: 'none', channelOutcomes: [] },
    { version: 1, outcome: 'invalid', failureClass: 'none', channelOutcomes: [] },
    { version: 1, outcome: 'accepted', failureClass: 'invalid', channelOutcomes: [] },
    { version: 1, outcome: 'accepted', failureClass: 'none', channelOutcomes: {} },
  ])('rejects malformed completed result %#', async (returnvalue) => {
    mocks.queue.getJob.mockResolvedValue(job({ returnvalue }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0].telegram.outcome).toBe('not_observed');
  });

  it.each([
    null,
    { version: 2, attemptOrdinal: 1, notification: {} },
    { version: 1, attemptOrdinal: 1.5, notification: {} },
  ])('rejects malformed failed progress %#', async (progress) => {
    mocks.queue.getJob.mockResolvedValue(job({
      progress,
      returnvalue: null,
      getState: vi.fn(async () => 'failed'),
    }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0].telegram.outcome).toBe('not_observed');
  });

  it.each([
    [null, { channel: 'push', outcome: 'accepted', failureClass: 'none' }],
    [{ channel: 'telegram', outcome: 'invalid', failureClass: 'none' }],
    [{ channel: 'telegram', outcome: 'accepted', failureClass: 'invalid' }],
  ])('rejects absent or malformed Telegram channel result %#', async (...channelOutcomes) => {
    mocks.queue.getJob.mockResolvedValue(job({
      returnvalue: {
        version: 1,
        outcome: 'accepted',
        failureClass: 'none',
        channelOutcomes,
      },
    }));
    const result = await readIncidentJobEvidence(
      { ...selectors, receiverWalletId: selectors.senderWalletId },
      { nowMs },
    );
    expect(result[0].telegram.outcome).toBe('not_observed');
  });

  it.each([
    { data: null },
    { data: 'invalid' },
    { data: { walletId: 'wrong', txid: selectors.txid, type: 'sent' } },
    { data: { walletId: selectors.senderWalletId, txid: 'wrong', type: 'sent' } },
    { data: { walletId: selectors.senderWalletId, txid: selectors.txid, type: 'received' } },
  ])('rejects mismatched retained job identity %#', async (override) => {
    mocks.queue.getJob.mockResolvedValue(job(override));
    const result = await readIncidentJobEvidence(selectors, { nowMs });
    expect(result[0].lookupStatus).toBe('unavailable');
  });

  it('reports Redis and Queue construction failures as unavailable', async () => {
    mocks.getRedisClient.mockReturnValueOnce(null);
    expect((await readIncidentJobEvidence(selectors, { nowMs }))[0].lookupStatus)
      .toBe('unavailable');

    mocks.constructor.mockImplementationOnce(() => {
      throw new Error('constructor failure');
    });
    expect((await readIncidentJobEvidence(selectors, { nowMs }))[0].lookupStatus)
      .toBe('unavailable');
  });

  it('contains getter failures and uses the current clock by default', async () => {
    mocks.queue.getJob.mockRejectedValueOnce(new Error('getter failure'));
    mocks.queue.getJob.mockResolvedValueOnce(job({
      data: {
        walletId: selectors.receiverWalletId,
        txid: selectors.txid,
        type: 'received',
      },
      getState: vi.fn(async () => { throw new Error('state failure'); }),
    }));
    const result = await readIncidentJobEvidence(selectors);
    expect(result.map((entry) => entry.lookupStatus)).toEqual(['unavailable', 'unavailable']);
  });

  it('reports unavailable Redis without constructing BullMQ or exporting identifiers', async () => {
    mocks.isRedisConnected.mockReturnValue(false);
    const result = await readIncidentJobEvidence(selectors, { nowMs });
    expect(result.map((entry) => entry.lookupStatus)).toEqual([
      'unavailable',
      'unavailable',
    ]);
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(selectors.txid);
  });

  it('reports bounded getter timeouts and force-disconnects when close fails', async () => {
    vi.useFakeTimers();
    mocks.queue.getJob.mockImplementation(() => new Promise(() => undefined));
    mocks.queue.close.mockRejectedValue(new Error('close failed'));
    mocks.queue.disconnect.mockRejectedValue(new Error('disconnect failed'));
    const pending = readIncidentJobEvidence(selectors, {
      nowMs,
      commandTimeoutMs: 10,
      cleanupTimeoutMs: 10,
    });
    await vi.advanceTimersByTimeAsync(11);
    const result = await pending;
    expect(result.map((entry) => entry.lookupStatus)).toEqual(['timeout', 'timeout']);
    expect(mocks.queue.disconnect).toHaveBeenCalledOnce();
  });

  it('validates configured timeouts before touching Redis', async () => {
    await expect(readIncidentJobEvidence(selectors, { commandTimeoutMs: 0 }))
      .rejects.toThrow('Incident queue timeout');
    await expect(readIncidentJobEvidence(selectors, { cleanupTimeoutMs: 5001 }))
      .rejects.toThrow('Incident queue timeout');
    expect(mocks.getRedisClient).not.toHaveBeenCalled();
  });
});
