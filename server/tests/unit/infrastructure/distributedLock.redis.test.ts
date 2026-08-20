import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSet, mockEval, mockExists, mockGetRedisClient, mockIsRedisConnected } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockEval: vi.fn(),
  mockExists: vi.fn(),
  mockGetRedisClient: vi.fn(),
  mockIsRedisConnected: vi.fn(),
}));

vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: mockGetRedisClient,
  isRedisConnected: mockIsRedisConnected,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import {
  acquireLock,
  extendLock,
  initializeDistributedLock,
  isLocked,
  LockAuthorityUnavailableError,
  releaseLock,
  shutdownDistributedLock,
  type DistributedLock,
} from '../../../src/infrastructure/distributedLock';

describe('distributedLock Redis behavior', () => {
  // An unconfirmed release retains its token in a module-level map and arms a
  // 5s reclaim interval. Without this teardown a later test in this file could
  // observe a stray `eval` from that sweep.
  afterEach(() => {
    shutdownDistributedLock();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    shutdownDistributedLock();
    initializeDistributedLock('redis-required');

    mockGetRedisClient.mockReturnValue({
      set: mockSet,
      eval: mockEval,
      exists: mockExists,
    });
    mockIsRedisConnected.mockReturnValue(true);
  });

  it('acquires a Redis lock when SET NX PX succeeds', async () => {
    mockSet.mockResolvedValueOnce('OK');

    const lock = await acquireLock('redis:acquire', 3000);

    expect(lock).not.toBeNull();
    expect(lock?.isLocal).toBe(false);
    expect(lock?.key).toBe('redis:acquire');
    expect(mockSet).toHaveBeenCalledWith(
      'lock:redis:acquire',
      expect.any(String),
      'PX',
      3000,
      'NX'
    );
  });

  it('returns null when Redis lock already exists', async () => {
    mockSet.mockResolvedValueOnce(null);

    await expect(acquireLock('redis:busy', 3000)).resolves.toBeNull();
  });

  it('fails closed when Redis acquisition throws', async () => {
    mockSet.mockRejectedValueOnce(new Error('redis set failed'));

    await expect(acquireLock('failed:key', {
      ttlMs: 3000,
      waitTimeMs: 60_000,
      retryIntervalMs: 1000,
    })).rejects.toBeInstanceOf(LockAuthorityUnavailableError);
    expect(mockSet).toHaveBeenCalledTimes(1);
    mockSet.mockResolvedValueOnce('OK');
    await expect(acquireLock('failed:key', 3000)).resolves.toMatchObject({
      key: 'failed:key',
      isLocal: false,
    });
  });

  it.each([
    ['missing client', null, true],
    ['disconnected', { set: mockSet, eval: mockEval, exists: mockExists }, false],
  ])('fails closed with a %s', async (_label, client, connected) => {
    mockGetRedisClient.mockReturnValue(client);
    mockIsRedisConnected.mockReturnValue(connected);

    await expect(acquireLock('unavailable:key', 3000)).rejects.toBeInstanceOf(
      LockAuthorityUnavailableError,
    );
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('releases Redis locks based on eval result and handles eval errors', async () => {
    const lock: DistributedLock = {
      key: 'redis:release',
      token: 'token-1',
      expiresAt: Date.now() + 3000,
      isLocal: false,
    };

    mockEval.mockResolvedValueOnce(1);
    await expect(releaseLock(lock)).resolves.toBe('deleted');

    mockEval.mockResolvedValueOnce(0);
    await expect(releaseLock(lock)).resolves.toBe('not-owned');

    // An eval that rejects establishes nothing, so it is no longer reported
    // the same way as a confirmed non-ownership. See distributedLockRelease.test.ts.
    mockEval.mockRejectedValueOnce(new Error('eval failed'));
    await expect(releaseLock(lock)).resolves.toBe('unconfirmed');
  });

  it('cannot attempt a release with no client at all', async () => {
    mockGetRedisClient.mockReturnValue(null);

    await expect(releaseLock({
      key: 'redis:unavailable-release',
      token: 'token',
      expiresAt: Date.now() + 3000,
      isLocal: false,
    })).resolves.toBe('unconfirmed');
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('still attempts the delete when the connection flag reads disconnected', async () => {
    // This inverts a previously-asserted short-circuit. Skipping the delete on a
    // momentary disconnect is what left tombstoned `lock:sync:wallet:*` keys
    // blocking wallet syncs for a full TTL on a production install (2026-08-20).
    mockGetRedisClient.mockReturnValue({ set: mockSet, eval: mockEval, exists: mockExists });
    mockIsRedisConnected.mockReturnValue(false);
    mockEval.mockResolvedValueOnce(1);

    await expect(releaseLock({
      key: 'redis:disconnected-release',
      token: 'token',
      expiresAt: Date.now() + 3000,
      isLocal: false,
    })).resolves.toBe('deleted');
    expect(mockEval).toHaveBeenCalledTimes(1);
  });

  it('extends Redis lock TTL based on eval result and handles errors', async () => {
    const lock: DistributedLock = {
      key: 'redis:extend',
      token: 'token-2',
      expiresAt: Date.now() + 1000,
      isLocal: false,
    };

    mockEval.mockResolvedValueOnce(1);
    const extended = await extendLock(lock, 9000);
    expect(extended).not.toBeNull();
    expect(extended?.expiresAt).toBeGreaterThan(lock.expiresAt);

    mockEval.mockResolvedValueOnce(0);
    await expect(extendLock(lock, 9000)).resolves.toBeNull();

    mockEval.mockRejectedValueOnce(new Error('extend failed'));
    await expect(extendLock(lock, 9000)).resolves.toBeNull();
  });

  it.each([
    ['missing client', null, true],
    ['disconnected', { set: mockSet, eval: mockEval, exists: mockExists }, false],
  ])('fails closed when extending with a %s', async (_label, client, connected) => {
    mockGetRedisClient.mockReturnValue(client);
    mockIsRedisConnected.mockReturnValue(connected);

    await expect(extendLock({
      key: 'redis:unavailable-extend',
      token: 'token',
      expiresAt: Date.now() + 3000,
      isLocal: false,
    }, 9000)).resolves.toBeNull();
    expect(mockEval).not.toHaveBeenCalled();
  });

  it('checks lock status with Redis exists and returns false for missing keys', async () => {
    mockExists.mockResolvedValueOnce(1);
    await expect(isLocked('redis:exists')).resolves.toBe(true);

    mockExists.mockResolvedValueOnce(0);
    await expect(isLocked('redis:missing')).resolves.toBe(false);
  });

  it('fails closed when Redis exists check fails', async () => {
    mockExists.mockRejectedValueOnce(new Error('exists failed'));

    await expect(isLocked('redis:failed-check')).rejects.toBeInstanceOf(
      LockAuthorityUnavailableError,
    );
  });

  it.each([
    ['missing client', null, true],
    ['disconnected', { set: mockSet, eval: mockEval, exists: mockExists }, false],
  ])('fails closed when checking with a %s', async (_label, client, connected) => {
    mockGetRedisClient.mockReturnValue(client);
    mockIsRedisConnected.mockReturnValue(connected);

    await expect(isLocked('redis:unavailable-check')).rejects.toBeInstanceOf(
      LockAuthorityUnavailableError,
    );
    expect(mockExists).not.toHaveBeenCalled();
  });

  it('requires explicit initialization', async () => {
    shutdownDistributedLock();

    await expect(acquireLock('uninitialized:key', 3000)).rejects.toBeInstanceOf(
      LockAuthorityUnavailableError,
    );
    await expect(isLocked('uninitialized:key')).rejects.toBeInstanceOf(
      LockAuthorityUnavailableError,
    );
  });

  it('rejects authority mode changes during one lifecycle', () => {
    expect(() => initializeDistributedLock('local')).toThrow(
      'already initialized as redis-required',
    );
  });

  it('allows idempotent initialization with the selected mode', () => {
    expect(() => initializeDistributedLock('redis-required')).not.toThrow();
  });
});
