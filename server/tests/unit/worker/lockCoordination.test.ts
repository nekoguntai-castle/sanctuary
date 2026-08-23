/**
 * Lock Coordination Tests
 *
 * Tests for the distributed lock refresh logic in the Electrum subscription manager.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockAcquireLock,
  mockExtendLock,
  mockReleaseLock,
} = vi.hoisted(() => ({
  mockAcquireLock: vi.fn(),
  mockExtendLock: vi.fn(),
  mockReleaseLock: vi.fn(),
}));

vi.mock('../../../src/infrastructure', () => ({
  acquireLock: mockAcquireLock,
  extendLock: mockExtendLock,
  releaseLock: mockReleaseLock,
}));

vi.mock('../../../src/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { startLockRefresh } from '../../../src/worker/electrumManager/lockCoordination';

describe('lockCoordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('no-ops lock refresh when getLock returns null', async () => {
    const getLock = vi.fn().mockReturnValue(null);
    const setLock = vi.fn();
    const onLockLost = vi.fn().mockResolvedValue(undefined);

    const timer = startLockRefresh(getLock, setLock, onLockLost);

    // Advance past the refresh interval (60 seconds)
    await vi.advanceTimersByTimeAsync(61_000);

    expect(getLock).toHaveBeenCalled();
    // extendLock should NOT have been called because lock was null
    expect(mockExtendLock).not.toHaveBeenCalled();
    expect(setLock).not.toHaveBeenCalled();
    expect(onLockLost).not.toHaveBeenCalled();

    clearInterval(timer);
  });

  it('serializes refreshes and rejects a late result after ownership is cleared', async () => {
    let resolveRefresh!: (lock: { key: string; token: string; expiresAt: number; isLocal: boolean }) => void;
    const refreshResult = new Promise<{ key: string; token: string; expiresAt: number; isLocal: boolean }>((resolve) => {
      resolveRefresh = resolve;
    });
    const originalLock = { key: 'subscription', token: 'old-token', expiresAt: 1, isLocal: false };
    let currentLock: typeof originalLock | null = originalLock;
    const getLock = vi.fn(() => currentLock);
    const setLock = vi.fn((lock: typeof originalLock | null) => {
      currentLock = lock;
    });
    const onLockLost = vi.fn().mockResolvedValue(undefined);
    mockExtendLock.mockReturnValue(refreshResult);

    const timer = startLockRefresh(getLock, setLock, onLockLost);
    vi.advanceTimersByTime(60_000);
    vi.advanceTimersByTime(60_000);

    expect(mockExtendLock).toHaveBeenCalledOnce();
    currentLock = null;
    resolveRefresh({ ...originalLock, expiresAt: 2 });
    await vi.runAllTicks();

    expect(currentLock).toBeNull();
    expect(setLock).not.toHaveBeenCalled();
    expect(onLockLost).not.toHaveBeenCalled();
    clearInterval(timer);
  });
});
