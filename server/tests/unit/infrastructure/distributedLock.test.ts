import { vi } from 'vitest';
/**
 * Distributed Lock Tests
 *
 * Tests the distributed locking infrastructure for coordinating
 * operations across multiple server instances.
 */

import {
  acquireLock,
  releaseLock,
  extendLock,
  withLock,
  isLocked,
  initializeDistributedLock,
  shutdownDistributedLock,
  type DistributedLock,
} from '../../../src/infrastructure/distributedLock';

// Mock Redis module
vi.mock('../../../src/infrastructure/redis', () => ({
  getRedisClient: vi.fn(() => null),
  isRedisConnected: vi.fn(() => false),
}));

describe('DistributedLock', () => {
  beforeEach(() => {
    // Clean up any locks from previous tests
    shutdownDistributedLock();
    initializeDistributedLock('local');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    shutdownDistributedLock();
  });

  describe('acquireLock', () => {
    it('should acquire a lock successfully', async () => {
      const lock = await acquireLock('test:key:1', 5000);

      expect(lock).not.toBeNull();
      expect(lock!.key).toBe('test:key:1');
      expect(lock!.token).toBeDefined();
      expect(lock!.isLocal).toBe(true);
      expect(lock!.expiresAt).toBeGreaterThan(Date.now());
    });

    it('should fail to acquire an already-held lock', async () => {
      const lock1 = await acquireLock('test:key:2', 5000);
      expect(lock1).not.toBeNull();

      const lock2 = await acquireLock('test:key:2', 5000);
      expect(lock2).toBeNull();
    });

    it('should treat undefined waitTimeMs as immediate timeout', async () => {
      const lock1 = await acquireLock('test:key:undefined-wait', 5000);
      expect(lock1).not.toBeNull();

      const lock2 = await acquireLock('test:key:undefined-wait', {
        ttlMs: 5000,
        waitTimeMs: undefined as unknown as number,
        retryIntervalMs: 20,
      });

      expect(lock2).toBeNull();
    });

    it('should allow acquiring different keys', async () => {
      const lock1 = await acquireLock('test:key:a', 5000);
      const lock2 = await acquireLock('test:key:b', 5000);

      expect(lock1).not.toBeNull();
      expect(lock2).not.toBeNull();
      expect(lock1!.key).toBe('test:key:a');
      expect(lock2!.key).toBe('test:key:b');
    });

    it('should wait and acquire lock when wait time provided', async () => {
      const lock1 = await acquireLock('test:key:wait', 100);
      expect(lock1).not.toBeNull();

      // Start waiting for lock
      const waitPromise = acquireLock('test:key:wait', {
        ttlMs: 5000,
        waitTimeMs: 500,
        retryIntervalMs: 50,
      });

      // Advance time and release the first lock
      vi.advanceTimersByTime(50);
      await releaseLock(lock1!);

      // Advance time for retry to acquire
      vi.advanceTimersByTime(100);

      const lock2 = await waitPromise;
      expect(lock2).not.toBeNull();
    });

    it('should timeout when waiting for lock', async () => {
      const lock1 = await acquireLock('test:key:timeout', 5000);
      expect(lock1).not.toBeNull();

      const lockPromise = acquireLock('test:key:timeout', {
        ttlMs: 5000,
        waitTimeMs: 100,
        retryIntervalMs: 20,
      });

      // Advance time past the wait timeout
      await vi.advanceTimersByTimeAsync(150);

      const lock2 = await lockPromise;
      expect(lock2).toBeNull();
    });

    it('should auto-expire locks after TTL', async () => {
      const lock = await acquireLock('test:key:expire', 50);
      expect(lock).not.toBeNull();

      // Advance time past TTL expiry
      vi.advanceTimersByTime(100);

      // Should be able to acquire now
      const lock2 = await acquireLock('test:key:expire', 5000);
      expect(lock2).not.toBeNull();
    });
  });

  describe('releaseLock', () => {
    it('should release a held lock', async () => {
      const lock = await acquireLock('test:release:1', 5000);
      expect(lock).not.toBeNull();

      const released = await releaseLock(lock!);
      expect(released).toBe(true);

      // Should be able to acquire again
      const lock2 = await acquireLock('test:release:1', 5000);
      expect(lock2).not.toBeNull();
    });

    it('should reject release with wrong token', async () => {
      const lock = await acquireLock('test:release:2', 5000);
      expect(lock).not.toBeNull();

      // Try to release with modified token
      const fakeLock: DistributedLock = {
        ...lock!,
        token: 'wrong-token',
      };

      const released = await releaseLock(fakeLock);
      expect(released).toBe(false);

      // Original lock should still be held
      const lock2 = await acquireLock('test:release:2', 5000);
      expect(lock2).toBeNull();
    });

    it('should return false for already-released lock', async () => {
      const lock = await acquireLock('test:release:3', 5000);
      expect(lock).not.toBeNull();

      await releaseLock(lock!);
      const released2 = await releaseLock(lock!);
      expect(released2).toBe(false);
    });
  });

  describe('extendLock', () => {
    it('should extend a held lock', async () => {
      const lock = await acquireLock('test:extend:1', 100);
      expect(lock).not.toBeNull();

      const originalExpiry = lock!.expiresAt;

      const extended = await extendLock(lock!, 5000);
      expect(extended).not.toBeNull();
      expect(extended!.expiresAt).toBeGreaterThan(originalExpiry);
    });

    it('should fail to extend with wrong token', async () => {
      const lock = await acquireLock('test:extend:2', 5000);
      expect(lock).not.toBeNull();

      const fakeLock: DistributedLock = {
        ...lock!,
        token: 'wrong-token',
      };

      const extended = await extendLock(fakeLock, 5000);
      expect(extended).toBeNull();
    });

    it('should fail to extend released lock', async () => {
      const lock = await acquireLock('test:extend:3', 5000);
      expect(lock).not.toBeNull();

      await releaseLock(lock!);

      const extended = await extendLock(lock!, 5000);
      expect(extended).toBeNull();
    });
  });

  describe('withLock', () => {
    it('should execute function when lock acquired', async () => {
      const result = await withLock('test:with:1', 5000, async () => {
        return 'success';
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toBe('success');
      }
    });

    it('should return locked when lock unavailable', async () => {
      const lock = await acquireLock('test:with:2', 5000);
      expect(lock).not.toBeNull();

      const result = await withLock('test:with:2', 5000, async () => {
        return 'success';
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.reason).toBe('locked');
      }
    });

    it('should release lock after function completes', async () => {
      await withLock('test:with:3', 5000, async () => {
        return 'done';
      });

      // Lock should be released
      const lock = await acquireLock('test:with:3', 5000);
      expect(lock).not.toBeNull();
    });

    it('should release lock even if function throws', async () => {
      try {
        await withLock('test:with:4', 5000, async () => {
          throw new Error('test error');
        });
      } catch {
        // Expected
      }

      // Lock should still be released
      const lock = await acquireLock('test:with:4', 5000);
      expect(lock).not.toBeNull();
    });
  });

  describe('isLocked', () => {
    it('should return true for held lock', async () => {
      const lock = await acquireLock('test:check:1', 5000);
      expect(lock).not.toBeNull();

      const locked = await isLocked('test:check:1');
      expect(locked).toBe(true);
    });

    it('should return false for released lock', async () => {
      const lock = await acquireLock('test:check:2', 5000);
      expect(lock).not.toBeNull();

      await releaseLock(lock!);

      const locked = await isLocked('test:check:2');
      expect(locked).toBe(false);
    });

    it('should return false for never-locked key', async () => {
      const locked = await isLocked('test:check:never');
      expect(locked).toBe(false);
    });

    it('should return false for expired lock', async () => {
      const lock = await acquireLock('test:check:expired', 50);
      expect(lock).not.toBeNull();

      // Advance time past expiry
      vi.advanceTimersByTime(100);

      const locked = await isLocked('test:check:expired');
      expect(locked).toBe(false);
    });
  });

  describe('shutdownDistributedLock', () => {
    it('should clear all local locks', async () => {
      await acquireLock('test:shutdown:1', 5000);
      await acquireLock('test:shutdown:2', 5000);
      await acquireLock('test:shutdown:3', 5000);

      shutdownDistributedLock();
      initializeDistributedLock('local');

      // All locks should be cleared
      const locked1 = await isLocked('test:shutdown:1');
      const locked2 = await isLocked('test:shutdown:2');
      const locked3 = await isLocked('test:shutdown:3');

      expect(locked1).toBe(false);
      expect(locked2).toBe(false);
      expect(locked3).toBe(false);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent lock attempts correctly', async () => {
      const results = await Promise.all([
        acquireLock('test:concurrent:1', 5000),
        acquireLock('test:concurrent:1', 5000),
        acquireLock('test:concurrent:1', 5000),
      ]);

      const successes = results.filter(r => r !== null);
      const failures = results.filter(r => r === null);

      // Only one should succeed
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);
    });

    it('should handle concurrent withLock correctly', async () => {
      let executionCount = 0;

      const resultsPromise = Promise.all([
        withLock('test:concurrent:2', 5000, async () => {
          executionCount++;
          // Use a resolved promise instead of setTimeout
          await Promise.resolve();
          return 'a';
        }),
        withLock('test:concurrent:2', 5000, async () => {
          executionCount++;
          return 'b';
        }),
        withLock('test:concurrent:2', 5000, async () => {
          executionCount++;
          return 'c';
        }),
      ]);

      // Advance timers to ensure all operations complete
      vi.advanceTimersByTime(100);
      const results = await resultsPromise;

      const successes = results.filter(r => r.success);
      const failures = results.filter(r => !r.success);

      // Only one should execute
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(2);
      expect(executionCount).toBe(1);
    });
  });
});
