/**
 * Non-regression tests for the 2026-08-20 lock tombstone.
 *
 * Three wallets on a production install were repeatedly passed over with
 * `Skipping job - lock held: sync:sync-wallet` while no sync was running. The
 * cause was `releaseLock` returning `false` WITHOUT attempting the delete
 * whenever `isRedisConnected()` was momentarily false, and returning the same
 * `false` when the Lua eval rejected. The key then survived to its 31-minute
 * TTL as a tombstone, and the caller had already discarded the token, so
 * nothing could ever clean it up.
 *
 * `false` also meant "someone else owns it" — a terminal, safe outcome — so the
 * two were indistinguishable to every caller.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { mockSet, mockEval, mockExists, mockGetRedisClient, mockIsRedisConnected, mockError } =
  vi.hoisted(() => ({
    mockSet: vi.fn(),
    mockEval: vi.fn(),
    mockExists: vi.fn(),
    mockGetRedisClient: vi.fn(),
    mockIsRedisConnected: vi.fn(),
    mockError: vi.fn(),
  }));

vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: mockError,
  }),
}));

import {
  initializeDistributedLock,
  releaseLock,
  shutdownDistributedLock,
  reclaimUnconfirmedLocks,
  pendingUnconfirmedLockCount,
  type DistributedLock,
} from '../../../src/infrastructure/distributedLock';

const remoteLock = (key: string): DistributedLock => ({
  key,
  token: `token-for-${key}`,
  expiresAt: Date.now() + 60_000,
  isLocal: false,
});

describe('releaseLock outcomes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
    mockIsRedisConnected.mockReturnValue(true);
  });

  afterEach(() => {
    shutdownDistributedLock();
  });

  it('reports deleted when the compare-and-delete removes the key', async () => {
    mockEval.mockResolvedValueOnce(1);
    await expect(releaseLock(remoteLock('a'))).resolves.toBe('deleted');
    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('reports not-owned when the token does not match, and does not retry', async () => {
    mockEval.mockResolvedValueOnce(0);
    await expect(releaseLock(remoteLock('b'))).resolves.toBe('not-owned');
    // Terminal: someone else owns it, so retrying would be wrong.
    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('still ATTEMPTS the delete when the connection flag reads disconnected', async () => {
    // The regression: the flag short-circuited before the eval, so the key was
    // never even asked about. ioredis buffers commands across a reconnect.
    mockIsRedisConnected.mockReturnValue(false);
    mockEval.mockResolvedValueOnce(1);

    await expect(releaseLock(remoteLock('c'))).resolves.toBe('deleted');
    expect(mockEval).toHaveBeenCalledTimes(1);
  });

  it('reports unconfirmed and keeps the token when the eval rejects', async () => {
    mockEval.mockRejectedValueOnce(new Error('READONLY'));

    await expect(releaseLock(remoteLock('d'))).resolves.toBe('unconfirmed');
    expect(pendingUnconfirmedLockCount()).toBe(1);
    // Loud: an unreleased lock blocks every future sync for that wallet.
    expect(mockError).toHaveBeenCalled();
  });

  it('reclaims an unconfirmed lock once Redis recovers', async () => {
    mockEval.mockRejectedValueOnce(new Error('connection lost'));
    await releaseLock(remoteLock('e'));
    expect(pendingUnconfirmedLockCount()).toBe(1);

    mockEval.mockResolvedValueOnce(1);
    await reclaimUnconfirmedLocks();

    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('keeps retrying while reclaim keeps failing', async () => {
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('f'));

    mockEval.mockRejectedValueOnce(new Error('still down'));
    await reclaimUnconfirmedLocks();
    expect(pendingUnconfirmedLockCount()).toBe(1);

    mockEval.mockResolvedValueOnce(1);
    await reclaimUnconfirmedLocks();
    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('stops tracking a lock whose TTL has already expired', async () => {
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock({ ...remoteLock('g'), expiresAt: Date.now() - 1 });
    // Redis has already removed it; retrying forever would leak the map.
    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('reports unconfirmed when the client is entirely absent', async () => {
    mockGetRedisClient.mockReturnValue(null);
    await expect(releaseLock(remoteLock('h'))).resolves.toBe('unconfirmed');
  });
});

describe('reclaim sweep lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
    mockIsRedisConnected.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    shutdownDistributedLock();
  });

  it('runs the sweep on its own timer and contains a rejecting sweep', async () => {
    vi.useFakeTimers();
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('timer-a'));
    expect(pendingUnconfirmedLockCount()).toBe(1);

    mockEval.mockResolvedValue(1);
    await vi.advanceTimersByTimeAsync(6_000);

    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('drops an entry whose TTL lapses while it was awaiting reclaim', async () => {
    mockEval.mockRejectedValueOnce(new Error('down'));
    const lock = { ...remoteLock('timer-b'), expiresAt: Date.now() + 40 };
    await releaseLock(lock);
    expect(pendingUnconfirmedLockCount()).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 60));
    await reclaimUnconfirmedLocks();

    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('stops reclaiming when the client disappears mid-sweep', async () => {
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('timer-c'));

    mockGetRedisClient.mockReturnValue(null);
    await reclaimUnconfirmedLocks();

    // Retained, not dropped: the token is still the only way to clear the key.
    expect(pendingUnconfirmedLockCount()).toBe(1);
  });

  it('is a no-op when nothing is outstanding', async () => {
    await expect(reclaimUnconfirmedLocks()).resolves.toBeUndefined();
  });
});

describe('reclaim timer arming', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
    mockIsRedisConnected.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    shutdownDistributedLock();
  });

  it('arms the sweep only once across several unconfirmed releases', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('arm-a'));
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('arm-b'));

    expect(pendingUnconfirmedLockCount()).toBe(2);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it('logs but does not throw when the timer-driven sweep rejects', async () => {
    vi.useFakeTimers();
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('arm-c'));

    // getRedisClient itself throwing is the one way the sweep can reject.
    mockGetRedisClient.mockImplementation(() => { throw new Error('client gone'); });
    await vi.advanceTimersByTimeAsync(6_000);

    // Contained by the sweep's own catch; the token is still held for retry.
    expect(pendingUnconfirmedLockCount()).toBe(1);
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
  });

  it('disarms the sweep once the last token is confirmed', async () => {
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('arm-d'));
    expect(pendingUnconfirmedLockCount()).toBe(1);

    mockEval.mockResolvedValueOnce(1);
    await releaseLock({ ...remoteLock('arm-d') });

    expect(pendingUnconfirmedLockCount()).toBe(0);
  });
});

describe('reclaim sweep hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
    mockIsRedisConnected.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    shutdownDistributedLock();
  });

  it('does not overlap sweeps when one outlives its own interval', async () => {
    vi.useFakeTimers();
    // Three pending keys, each hanging until its 2s per-call ceiling, makes one
    // sweep take ~6s - longer than the 5s interval. Without the in-flight guard
    // the next tick would start a second sweep over the same map.
    for (const key of ['slow-a', 'slow-b', 'slow-c']) {
      mockEval.mockRejectedValueOnce(new Error('down'));
      await releaseLock(remoteLock(key));
    }
    expect(pendingUnconfirmedLockCount()).toBe(3);

    let started = 0;
    mockEval.mockImplementation(() => {
      started += 1;
      return new Promise(() => undefined);
    });

    // t=5s tick 1 starts; keys time out at 7s, 9s, 11s. At t=10s tick 2 fires
    // while sweep 1 is still on its third key.
    await vi.advanceTimersByTimeAsync(10_500);

    expect(started).toBe(3);
    mockEval.mockReset();
  });

  it('prunes an expired entry even while the client is absent', async () => {
    // `return` here would abandon later entries for as long as the client is
    // null, growing the map every time a release fails.
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock({ ...remoteLock('live'), expiresAt: Date.now() + 60_000 });
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock({ ...remoteLock('expiring'), expiresAt: Date.now() + 30 });
    expect(pendingUnconfirmedLockCount()).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 50));
    mockGetRedisClient.mockReturnValue(null);
    await reclaimUnconfirmedLocks();

    expect(pendingUnconfirmedLockCount()).toBe(1);
  });

  it('bounds one reclaim attempt so a stalled key cannot stall the sweep', async () => {
    vi.useFakeTimers();
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('stalled'));

    mockEval.mockImplementation(() => new Promise(() => undefined));
    const sweep = reclaimUnconfirmedLocks();
    await vi.advanceTimersByTimeAsync(2_500);
    await expect(sweep).resolves.toBeUndefined();

    expect(pendingUnconfirmedLockCount()).toBe(1);
    mockEval.mockReset();
  });

  it('does not re-arm or repopulate after shutdown', async () => {
    shutdownDistributedLock();
    // A release still in flight when shutdown ran must not resurrect the map.
    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('after-shutdown'));

    expect(pendingUnconfirmedLockCount()).toBe(0);
  });

  it('restores reclaim when the subsystem is initialised again', async () => {
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });

    mockEval.mockRejectedValueOnce(new Error('down'));
    await releaseLock(remoteLock('after-reinit'));

    expect(pendingUnconfirmedLockCount()).toBe(1);
  });
});

describe('release call is bounded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
    mockIsRedisConnected.mockReturnValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
    shutdownDistributedLock();
  });

  it('reports unconfirmed rather than parking the caller in the offline queue', async () => {
    // Dropping the isRedisConnected() gate is deliberate, but a disconnected
    // client must not stall a caller that is usually inside a job's finally.
    vi.useFakeTimers();
    mockEval.mockImplementation(() => new Promise(() => undefined));

    const pending = releaseLock(remoteLock('offline-queue'));
    await vi.advanceTimersByTimeAsync(2_500);

    await expect(pending).resolves.toBe('unconfirmed');
    expect(pendingUnconfirmedLockCount()).toBe(1);
    mockEval.mockReset();
  });
});
