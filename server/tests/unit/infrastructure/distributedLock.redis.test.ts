import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    await expect(releaseLock(lock)).resolves.toBe(true);

    mockEval.mockResolvedValueOnce(0);
    await expect(releaseLock(lock)).resolves.toBe(false);

    mockEval.mockRejectedValueOnce(new Error('eval failed'));
    await expect(releaseLock(lock)).resolves.toBe(false);
  });

  it.each([
    ['missing client', null, true],
    ['disconnected', { set: mockSet, eval: mockEval, exists: mockExists }, false],
  ])('fails closed when releasing with a %s', async (_label, client, connected) => {
    mockGetRedisClient.mockReturnValue(client);
    mockIsRedisConnected.mockReturnValue(connected);

    await expect(releaseLock({
      key: 'redis:unavailable-release',
      token: 'token',
      expiresAt: Date.now() + 3000,
      isLocal: false,
    })).resolves.toBe(false);
    expect(mockEval).not.toHaveBeenCalled();
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
