import type { Job } from 'bullmq';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeadLetterQueue,
  createMemoryDeadLetterQueue,
  recordElectrumFailure,
  recordPushFailure,
  recordSyncFailure,
  recordTransactionFailure,
} from '../../../src/services/deadLetterQueue';
import { MemoryDeadLetterStore } from '../../../src/services/memoryDeadLetterStore';

function exhaustedJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    name: 'sync-wallet',
    data: { walletId: 'wallet-1', reason: 'manual' },
    attemptsMade: 3,
    timestamp: Date.now(),
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 500,
      removeOnFail: 250,
    },
    ...overrides,
  } as Job;
}

describe('DeadLetterQueue', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds, updates, lists, filters, and summarizes diagnostic entries', async () => {
    const queue = createMemoryDeadLetterQueue();
    const syncId = await queue.add(
      'sync',
      'wallet_sync',
      { walletId: 'wallet-1' },
      new Error('sync failed'),
      2,
    );
    const pushId = await queue.add(
      'push',
      'push_notification',
      { userId: 'user-1' },
      'push failed',
      1,
    );

    await queue.update(syncId, new Error('sync failed again'), 3);
    await queue.update('missing', 'ignored', 1);

    await expect(queue.get(syncId)).resolves.toEqual(expect.objectContaining({
      id: syncId,
      category: 'sync',
      attempts: 3,
      error: 'sync failed again',
      errorStack: expect.stringContaining('sync failed again'),
    }));
    await queue.update(syncId, 'string failure', 4);
    await expect(queue.get(syncId)).resolves.toEqual(expect.objectContaining({
      attempts: 4,
      error: 'string failure',
      errorStack: undefined,
    }));
    await expect(queue.getByCategory('sync')).resolves.toHaveLength(1);
    await expect(queue.getAll(1)).resolves.toHaveLength(1);
    await expect(queue.getStats()).resolves.toEqual(expect.objectContaining({
      total: 2,
      byCategory: expect.objectContaining({ sync: 1, push: 1 }),
      oldest: expect.any(Date),
      newest: expect.any(Date),
    }));
    await expect(queue.getSnapshot({ category: 'sync', limit: 1 })).resolves.toEqual({
      entries: [expect.objectContaining({ id: syncId })],
      stats: expect.objectContaining({
        total: 2,
        byCategory: expect.objectContaining({ sync: 1, push: 1 }),
      }),
    });
    await expect(queue.getSnapshot({ limit: -1 })).resolves.toEqual({
      entries: [],
      stats: expect.objectContaining({ total: 2 }),
    });
    await expect(queue.getSnapshot()).resolves.toEqual({
      entries: expect.arrayContaining([
        expect.objectContaining({ id: syncId }),
        expect.objectContaining({ id: pushId }),
      ]),
      stats: expect.objectContaining({ total: 2 }),
    });
    await expect(queue.remove(pushId)).resolves.toBe(true);
    await expect(queue.remove(pushId)).resolves.toBe(false);
  });

  it('atomically upserts duplicate exhausted events under one stable identity', async () => {
    const queue = createMemoryDeadLetterQueue();
    const job = exhaustedJob();
    const firstFailedAt = new Date(Date.now() - 1_000);
    const duplicateFailedAt = new Date();
    const firstId = await queue.addExhaustedJob(
      'sync',
      'sync',
      job,
      new Error('first failure'),
      firstFailedAt,
    );
    const first = await queue.get(firstId);
    const secondId = await queue.addExhaustedJob(
      'sync',
      'sync',
      job,
      new Error('duplicate event'),
      duplicateFailedAt,
    );

    expect(secondId).toBe(firstId);
    await expect(queue.get(firstId)).resolves.toEqual(expect.objectContaining({
      id: firstId,
      operation: 'sync:sync-wallet',
      error: 'first failure',
      attempts: 3,
      firstFailedAt: first!.firstFailedAt,
      lastFailedAt: firstFailedAt,
      job: expect.objectContaining({
        version: 1,
        queue: 'sync',
        name: 'sync-wallet',
        jobId: 'job-1',
        exhaustedAttempt: 3,
        options: expect.objectContaining({ attempts: 3 }),
      }),
    }));
  });

  it('persists notification aggregate classification beside the operational DLQ record', async () => {
    const aggregateRecorder = vi.fn().mockResolvedValue(undefined);
    const store = new MemoryDeadLetterStore();
    const queue = new DeadLetterQueue(() => store, aggregateRecorder);
    const poison = 'wallet-secret txid-secret provider-secret';
    const job = exhaustedJob({
      name: 'transaction-notify',
      data: { walletId: poison, txid: poison },
      attemptsMade: 5,
      progress: {
        version: 1,
        attemptOrdinal: 5,
        notification: { failureClass: 'authentication' },
      },
    });

    const id = await queue.addExhaustedJob(
      'notification',
      'notifications',
      job,
      poison,
    );

    expect(aggregateRecorder).toHaveBeenCalledWith({
      jobFamily: 'transaction',
      failureClass: 'authentication',
      attempts: 'four_to_five',
    });
    expect(JSON.stringify(aggregateRecorder.mock.calls)).not.toContain(poison);
  });

  it('returns canonical DLQ success when aggregate persistence is unavailable', async () => {
    const aggregateRecorder = vi.fn().mockRejectedValue(
      new Error('redis://user:secret@host payload poison'),
    );
    const store = new MemoryDeadLetterStore();
    const queue = new DeadLetterQueue(() => store, aggregateRecorder);

    const id = await queue.addExhaustedJob(
      'notification',
      'notifications',
      exhaustedJob({ name: 'transaction-notify' }),
      'operational failure',
    );

    await expect(queue.get(id)).resolves.toEqual(expect.objectContaining({ id }));
    expect(aggregateRecorder).toHaveBeenCalledTimes(1);
  });

  it('derives a stable fallback identity for exhausted jobs without a BullMQ ID', async () => {
    const queue = createMemoryDeadLetterQueue();
    const job = exhaustedJob({ id: undefined, timestamp: 12345 });

    const id = await queue.addExhaustedJob('sync', 'sync', job, 'failed');

    await expect(queue.get(id)).resolves.toEqual(expect.objectContaining({
      job: expect.objectContaining({
        jobId: 'sync-wallet:12345',
      }),
    }));
  });

  it('claims with a lease and requires the exact token to release or acknowledge', async () => {
    const queue = createMemoryDeadLetterQueue();
    const id = await queue.addExhaustedJob(
      'sync',
      'sync',
      exhaustedJob(),
      'failed',
    );
    const claimed = await queue.claimForRetry(id, 1_000);
    expect(claimed.status).toBe('claimed');
    if (claimed.status !== 'claimed') throw new Error('claim failed');

    await expect(queue.claimForRetry(id, 1_000)).resolves.toEqual({
      status: 'busy',
    });
    await expect(queue.releaseRetry(id, 'wrong-token')).resolves.toBe(false);
    await expect(
      queue.releaseRetry(id, claimed.claim.token),
    ).resolves.toBe(true);

    const reclaimed = await queue.claimForRetry(id, 1_000);
    if (reclaimed.status !== 'claimed') throw new Error('reclaim failed');
    await expect(
      queue.acknowledgeRetry(id, reclaimed.claim.token),
    ).resolves.toBe(true);
    await expect(queue.get(id)).resolves.toBeNull();

    await queue.addExhaustedJob('sync', 'sync', exhaustedJob(), 'late event');
    await expect(queue.get(id)).resolves.toBeNull();
  });

  it('recovers an expired claim and rejects invalid lease durations', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T00:00:00.000Z'));
    const queue = createMemoryDeadLetterQueue();
    const id = await queue.addExhaustedJob(
      'sync',
      'sync',
      exhaustedJob(),
      'failed',
    );
    await expect(queue.claimForRetry(id, 1_000)).resolves.toEqual(
      expect.objectContaining({ status: 'claimed' }),
    );
    vi.advanceTimersByTime(1_001);
    await expect(queue.claimForRetry(id, 1_000)).resolves.toEqual(
      expect.objectContaining({ status: 'claimed' }),
    );
    await expect(queue.claimForRetry(id, 0)).rejects.toThrow(
      'positive integer',
    );
  });

  it('expires entries, clears categories, and bounds retained entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
    const queue = createMemoryDeadLetterQueue();
    const expiredId = await queue.add('other', 'old', {}, 'old', 1);
    vi.advanceTimersByTime(8 * 24 * 60 * 60 * 1_000);
    await expect(queue.get(expiredId)).resolves.toBeNull();

    for (let index = 0; index < 1_001; index += 1) {
      vi.advanceTimersByTime(1);
      await queue.add('notification', `operation-${index}`, {}, 'failed', 1);
    }
    await expect(queue.getAll()).resolves.toHaveLength(1_000);
    await expect(queue.clearCategory('notification')).resolves.toBe(1_000);
    await expect(queue.getAll()).resolves.toEqual([]);
  });

  it('rejects oversized entries and supports startup cleanup compatibility', async () => {
    const queue = createMemoryDeadLetterQueue();
    await expect(queue.start()).resolves.toBeUndefined();
    queue.stop();
    await expect(queue.loadFromRedis()).resolves.toBeUndefined();
    await expect(
      queue.add(
        'other',
        'oversized',
        { value: 'x'.repeat(300_000) },
        'failed',
        1,
      ),
    ).rejects.toThrow('maximum serialized size');
  });

  it('records convenience failure categories without exposing full push tokens', async () => {
    const syncId = await recordSyncFailure('wallet-1', 'sync down', 2);
    const pushId = await recordPushFailure(
      'user-1',
      '123456789012345678901234',
      'push down',
      3,
    );
    const electrumId = await recordElectrumFailure('host', 50_001, 'down', 4);
    const transactionId = await recordTransactionFailure(
      'wallet-1',
      'a'.repeat(64),
      'down',
      5,
    );

    expect(syncId).toMatch(/^diagnostic-/);
    expect(pushId).toMatch(/^diagnostic-/);
    expect(electrumId).toMatch(/^diagnostic-/);
    expect(transactionId).toMatch(/^diagnostic-/);
  });
});
