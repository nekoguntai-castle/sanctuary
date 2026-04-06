/**
 * Distributed Lock Infrastructure
 *
 * Provides Redis-based distributed locking for coordinating operations
 * across multiple server instances. Essential for preventing race conditions
 * in multi-instance deployments.
 *
 * ## Features
 *
 * - Automatic fallback to in-memory locks when Redis unavailable
 * - TTL-based automatic lock expiration (prevents deadlocks)
 * - Lock extension for long-running operations
 * - Fencing tokens for detecting stale locks
 *
 * ## Usage
 *
 * ```typescript
 * import { acquireLock, releaseLock, withLock } from './infrastructure/distributedLock';
 *
 * // Simple lock/unlock
 * const lock = await acquireLock('sync:wallet:123', 60000);
 * if (lock) {
 *   try {
 *     // Do work
 *   } finally {
 *     await releaseLock(lock);
 *   }
 * }
 *
 * // Or use the helper
 * const result = await withLock('sync:wallet:123', 60000, async () => {
 *   // Do work
 *   return result;
 * });
 * ```
 */

import { getRedisClient, isRedisConnected } from './redis';
import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import crypto from 'crypto';

const log = createLogger('INFRA:DIST_LOCK');

// =============================================================================
// Types
// =============================================================================

export interface DistributedLock {
  key: string;
  token: string;
  expiresAt: number;
  isLocal: boolean;
}

export interface LockOptions {
  /** Time-to-live in milliseconds. Lock auto-expires after this time. */
  ttlMs: number;
  /** How long to wait for lock acquisition (0 = no wait, return immediately) */
  waitTimeMs?: number;
  /** Retry interval when waiting for lock */
  retryIntervalMs?: number;
}

// =============================================================================
// In-Memory Fallback
// =============================================================================

const localLocks = new Map<string, { token: string; expiresAt: number }>();

/**
 * Clean up expired local locks
 */
function cleanupLocalLocks(): void {
  const now = Date.now();
  for (const [key, lock] of localLocks.entries()) {
    if (lock.expiresAt <= now) {
      localLocks.delete(key);
    }
  }
}

// Run cleanup periodically
let cleanupInterval: NodeJS.Timeout | null = null;

function ensureCleanupRunning(): void {
  if (!cleanupInterval) {
    cleanupInterval = setInterval(cleanupLocalLocks, 30000);
    cleanupInterval.unref(); // Don't prevent process exit
  }
}

// =============================================================================
// Lock Operations
// =============================================================================

/**
 * Generate a unique token for lock ownership
 */
function generateToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Acquire a distributed lock
 *
 * @param key - Unique key for the lock (e.g., 'sync:wallet:123')
 * @param options - Lock options or just TTL in milliseconds
 * @returns Lock object if acquired, null if lock is held by another process
 */
export async function acquireLock(
  key: string,
  options: LockOptions | number
): Promise<DistributedLock | null> {
  const opts: LockOptions = typeof options === 'number'
    ? { ttlMs: options, waitTimeMs: 0, retryIntervalMs: 100 }
    : { waitTimeMs: 0, retryIntervalMs: 100, ...options };

  const token = generateToken();
  const startTime = Date.now();

  // Try to acquire with optional wait
  while (true) {
    const lock = await tryAcquireLock(key, token, opts.ttlMs);
    if (lock) {
      return lock;
    }

    // Check if we should keep waiting
    const elapsed = Date.now() - startTime;
    const waitTime = opts.waitTimeMs ?? 0;
    if (waitTime === 0 || elapsed >= waitTime) {
      return null; // Give up
    }

    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, opts.retryIntervalMs));
  }
}

/**
 * Try to acquire lock once (no waiting)
 */
async function tryAcquireLock(
  key: string,
  token: string,
  ttlMs: number
): Promise<DistributedLock | null> {
  const redis = getRedisClient();
  const expiresAt = Date.now() + ttlMs;

  if (redis && isRedisConnected()) {
    try {
      // SET key token NX PX ttlMs
      // NX = only set if not exists
      // PX = expire in milliseconds
      const result = await redis.set(
        `lock:${key}`,
        token,
        'PX',
        ttlMs,
        'NX'
      );

      if (result === 'OK') {
        log.debug(`Acquired Redis lock: ${key}`);
        return { key, token, expiresAt, isLocal: false };
      }

      return null; // Lock held by another
    } catch (error) {
      log.warn(`Redis lock acquisition failed, falling back to local`, { key, error: getErrorMessage(error) });
      // Fall through to local lock
    }
  }

  // Local fallback
  ensureCleanupRunning();
  cleanupLocalLocks(); // Clean expired locks first

  const existing = localLocks.get(key);
  if (existing && existing.expiresAt > Date.now()) {
    return null; // Lock held locally
  }

  localLocks.set(key, { token, expiresAt });
  log.debug(`Acquired local lock: ${key}`);
  return { key, token, expiresAt, isLocal: true };
}

/**
 * Release a distributed lock
 *
 * Only releases if the token matches (prevents releasing someone else's lock)
 *
 * @param lock - Lock object from acquireLock
 * @returns true if released, false if lock was already released or held by another
 */
export async function releaseLock(lock: DistributedLock): Promise<boolean> {
  const redis = getRedisClient();

  if (!lock.isLocal && redis && isRedisConnected()) {
    try {
      // Lua script to atomically check and delete
      // Only delete if the token matches (we own the lock)
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;

      const result = await redis.eval(script, 1, `lock:${lock.key}`, lock.token);

      if (result === 1) {
        log.debug(`Released Redis lock: ${lock.key}`);
        return true;
      }

      log.debug(`Lock already released or stolen: ${lock.key}`);
      return false;
    } catch (error) {
      log.warn(`Redis lock release failed`, { key: lock.key, error: getErrorMessage(error) });
      return false;
    }
  }

  // Local fallback
  const existing = localLocks.get(lock.key);
  if (existing && existing.token === lock.token) {
    localLocks.delete(lock.key);
    log.debug(`Released local lock: ${lock.key}`);
    return true;
  }

  return false;
}

/**
 * Extend lock TTL (for long-running operations)
 *
 * @param lock - Lock object from acquireLock
 * @param ttlMs - New TTL in milliseconds
 * @returns Updated lock object if extended, null if lock was lost
 */
export async function extendLock(
  lock: DistributedLock,
  ttlMs: number
): Promise<DistributedLock | null> {
  const redis = getRedisClient();
  const newExpiresAt = Date.now() + ttlMs;

  if (!lock.isLocal && redis && isRedisConnected()) {
    try {
      // Lua script to atomically check ownership and extend
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await redis.eval(
        script,
        1,
        `lock:${lock.key}`,
        lock.token,
        ttlMs.toString()
      );

      if (result === 1) {
        log.debug(`Extended Redis lock: ${lock.key} by ${ttlMs}ms`);
        return { ...lock, expiresAt: newExpiresAt };
      }

      log.warn(`Failed to extend lock (lost ownership): ${lock.key}`);
      return null;
    } catch (error) {
      log.warn(`Redis lock extension failed`, { key: lock.key, error: getErrorMessage(error) });
      return null;
    }
  }

  // Local fallback
  const existing = localLocks.get(lock.key);
  if (existing && existing.token === lock.token) {
    existing.expiresAt = newExpiresAt;
    log.debug(`Extended local lock: ${lock.key} by ${ttlMs}ms`);
    return { ...lock, expiresAt: newExpiresAt };
  }

  return null;
}

/**
 * Execute a function while holding a lock
 *
 * Automatically acquires and releases the lock.
 *
 * @param key - Lock key
 * @param ttlMs - Lock TTL
 * @param fn - Function to execute while holding the lock
 * @returns Function result, or null if lock couldn't be acquired
 */
export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<{ success: true; result: T } | { success: false; reason: 'locked' }> {
  const lock = await acquireLock(key, ttlMs);

  if (!lock) {
    return { success: false, reason: 'locked' };
  }

  try {
    const result = await fn();
    return { success: true, result };
  } finally {
    await releaseLock(lock);
  }
}

/**
 * Check if a lock is currently held
 *
 * Note: This is a point-in-time check. The lock status may change immediately after.
 */
export async function isLocked(key: string): Promise<boolean> {
  const redis = getRedisClient();

  if (redis && isRedisConnected()) {
    try {
      const result = await redis.exists(`lock:${key}`);
      return result === 1;
    } catch (error) {
      log.warn(`Redis lock check failed, checking local`, { key, error: getErrorMessage(error) });
    }
  }

  // Local fallback
  cleanupLocalLocks();
  const existing = localLocks.get(key);
  return !!(existing && existing.expiresAt > Date.now());
}

/**
 * Shutdown distributed lock infrastructure
 */
export function shutdownDistributedLock(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
  localLocks.clear();
}
