/**
 * Distributed Lock Infrastructure
 *
 * Provides Redis-based distributed locking for coordinating operations
 * across multiple server instances. Essential for preventing race conditions
 * in multi-instance deployments.
 *
 * ## Features
 *
 * - Explicit Redis-required or single-process local authority
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
import {
  initializeDistributedLock as initializeLockAuthority,
  LockAuthorityUnavailableError,
  requireLockAuthorityMode,
  resetLockAuthority,
} from './lockAuthority';
import type { LockAuthorityMode } from './lockAuthority';

export {
  LockAuthorityUnavailableError,
  type LockAuthorityMode,
} from './lockAuthority';

/**
 * Initialise the lock subsystem.
 *
 * Wraps the authority's own initialiser so the unconfirmed-release reclaim,
 * which `shutdownDistributedLock()` disables, comes back with it. Without this
 * a shutdown/init cycle would leave every later unconfirmed release untracked.
 */
export function initializeDistributedLock(mode: LockAuthorityMode): void {
  reclaimEnabled = true;
  reclaimSweepInFlight = false;
  initializeLockAuthority(mode);
}

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

function requireRedisAuthority(operation: string) {
  const redis = getRedisClient();
  if (!redis || !isRedisConnected()) {
    throw new LockAuthorityUnavailableError(operation);
  }
  return redis;
}

// =============================================================================
// Explicit Single-Process Local Authority
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
 * What a release attempt established.
 *
 * `deleted` and `not-owned` are both terminal — the caller may drop the token.
 * `unconfirmed` means the key may still exist and we still own it; the token is
 * retained here and retried, because an abandoned token becomes a tombstone
 * that blocks the resource until its TTL.
 */
export type LockReleaseOutcome = 'deleted' | 'not-owned' | 'unconfirmed';

/** Compare-and-delete: only remove the key when we still hold the token. */
const RELEASE_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/** How often to retry releases whose outcome was never confirmed. */
const RECLAIM_INTERVAL_MS = 5_000;

/**
 * Per-call ceiling for a compare-and-delete, used by both the direct release and
 * the reclaim sweep. Without the `isRedisConnected()` gate the eval is issued
 * against a possibly-disconnected client, and ioredis' offline queue would
 * otherwise stall the releasing caller for the whole reconnect window.
 */
const LOCK_CALL_TIMEOUT_MS = 2_000;

interface PendingRelease {
  token: string;
  expiresAt: number;
}

const unconfirmedReleases = new Map<string, PendingRelease>();
let reclaimTimer: NodeJS.Timeout | null = null;
/** Guards against a sweep that outlives its own interval overlapping the next. */
let reclaimSweepInFlight = false;
/**
 * Cleared by shutdown. Without it a `releaseLock` still in flight when
 * `shutdownDistributedLock()` runs would re-arm the timer and repopulate the
 * map that shutdown had just emptied.
 */
let reclaimEnabled = true;

function stopReclaimTimer(): void {
  if (!reclaimTimer) return;
  clearInterval(reclaimTimer);
  reclaimTimer = null;
}

function startReclaimTimer(): void {
  if (reclaimTimer || !reclaimEnabled) return;
  reclaimTimer = setInterval(() => {
    // A degraded Redis makes each sweep slower than the interval; overlapping
    // sweeps would iterate the same map concurrently and double-evict.
    if (reclaimSweepInFlight) return;
    reclaimSweepInFlight = true;
    void reclaimUnconfirmedLocks()
      .catch((error) => {
        log.debug('Lock reclaim sweep failed', { error: getErrorMessage(error) });
      })
      .finally(() => {
        reclaimSweepInFlight = false;
      });
  }, RECLAIM_INTERVAL_MS);
  // Never hold the process open for a retry sweep.
  reclaimTimer.unref?.();
}

/** Reject if one compare-and-delete outlives its ceiling; the token stays held. */
function withLockCallTimeout<T>(operation: Promise<T>, key: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Lock operation for ${key} exceeded ${LOCK_CALL_TIMEOUT_MS}ms`)),
      LOCK_CALL_TIMEOUT_MS,
    );
    timer.unref?.();
    operation.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function forgetUnconfirmedRelease(key: string): void {
  if (unconfirmedReleases.delete(key) && unconfirmedReleases.size === 0) {
    stopReclaimTimer();
  }
}

/**
 * Retain a token whose release could not be confirmed, and say so loudly.
 *
 * At `warn` this was invisible in the incident that motivated the change: the
 * only surviving symptom was a wallet being skipped every five minutes for
 * `lock held`, with nothing explaining why the lock existed.
 */
function trackUnconfirmedRelease(lock: DistributedLock, reason: string): void {
  if (!reclaimEnabled) {
    // Shutting down: nothing will sweep, so do not repopulate the map.
    log.warn('Lock release unconfirmed during shutdown; leaving it to its TTL', {
      key: lock.key,
      reason,
    });
    return;
  }
  if (lock.expiresAt <= Date.now()) {
    // Redis has already expired it; there is nothing left to reclaim.
    forgetUnconfirmedRelease(lock.key);
    return;
  }
  unconfirmedReleases.set(lock.key, { token: lock.token, expiresAt: lock.expiresAt });
  startReclaimTimer();
  log.error('Lock release unconfirmed - the key may block this resource until its TTL', {
    key: lock.key,
    expiresInMs: lock.expiresAt - Date.now(),
    reason,
  });
}

/**
 * Try to acquire lock once (no waiting)
 */
async function tryAcquireLock(
  key: string,
  token: string,
  ttlMs: number
): Promise<DistributedLock | null> {
  const expiresAt = Date.now() + ttlMs;
  const mode = requireLockAuthorityMode();

  if (mode === 'redis-required') {
    const redis = requireRedisAuthority('acquire');
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
      log.warn('Redis lock acquisition failed', {
        key,
        error: getErrorMessage(error),
      });
      throw new LockAuthorityUnavailableError('acquire', error);
    }
  }

  // Explicit single-process local authority.
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
 * Release a distributed lock.
 *
 * Only releases if the token matches, so one holder cannot delete another's
 * lock.
 *
 * @param lock - Lock object from acquireLock
 * @returns `deleted` when the key was removed; `not-owned` when the key is gone
 *          or a later holder owns it (both terminal - the token may be
 *          dropped); `unconfirmed` when the outcome could not be established,
 *          in which case the token is retained here and retried, because an
 *          abandoned token becomes a tombstone that blocks the resource until
 *          its TTL.
 */
export async function releaseLock(lock: DistributedLock): Promise<LockReleaseOutcome> {
  if (!lock.isLocal) {
    const redis = getRedisClient();
    if (!redis) {
      // No client at all is not the same as a client that is briefly offline.
      trackUnconfirmedRelease(lock, 'redis client unavailable');
      return 'unconfirmed';
    }
    try {
      // Deliberately NOT gated on isRedisConnected(). That flag short-circuited
      // the delete during a momentary disconnect, so the key was never even
      // asked about and survived to its TTL as a tombstone that blocked every
      // later sync for the wallet. ioredis buffers the command across a
      // reconnect, so attempting it is strictly better than skipping it.
      // Bounded: a disconnected client would otherwise park this await in
      // ioredis' offline queue for the whole reconnect window, blocking a
      // caller that is usually inside a job's finally block.
      const result = await withLockCallTimeout(
        redis.eval(RELEASE_SCRIPT, 1, `lock:${lock.key}`, lock.token),
        lock.key,
      );

      if (result === 1) {
        log.debug(`Released Redis lock: ${lock.key}`);
        forgetUnconfirmedRelease(lock.key);
        return 'deleted';
      }

      // Terminal and safe: the key is gone, or a later holder owns it. Retrying
      // would risk deleting a lock that is legitimately someone else's.
      log.debug(`Lock already released or stolen: ${lock.key}`);
      forgetUnconfirmedRelease(lock.key);
      return 'not-owned';
    } catch (error) {
      trackUnconfirmedRelease(lock, getErrorMessage(error));
      return 'unconfirmed';
    }
  }

  // Local locks are never inferred from Redis connection state.
  const existing = localLocks.get(lock.key);
  if (existing && existing.token === lock.token) {
    localLocks.delete(lock.key);
    log.debug(`Released local lock: ${lock.key}`);
    return 'deleted';
  }

  return 'not-owned';
}

/**
 * Retry every release whose outcome was never confirmed.
 *
 * Called on a timer while any token is outstanding. A lock whose TTL has passed
 * is dropped rather than retried: Redis has already removed it, and holding the
 * token would leak the map for the life of the process.
 */
export async function reclaimUnconfirmedLocks(): Promise<void> {
  if (unconfirmedReleases.size === 0) return;
  const redis = getRedisClient();

  for (const [key, pending] of [...unconfirmedReleases]) {
    if (pending.expiresAt <= Date.now()) {
      unconfirmedReleases.delete(key);
      log.warn('Abandoning unconfirmed lock release; its TTL has passed', { key });
      continue;
    }
    // `continue`, not `return`: an absent client must not stop the loop pruning
    // entries later in iteration order whose TTL has already lapsed, or they
    // would accumulate for as long as the client stays null.
    if (!redis) continue;
    try {
      // Bound each call. ioredis' own retry/backoff is the only limit
      // otherwise, so one degraded key could stretch a sweep indefinitely and
      // starve the rest of the map.
      await withLockCallTimeout(redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, pending.token), key);
      unconfirmedReleases.delete(key);
      log.info('Reclaimed a lock whose release was previously unconfirmed', { key });
    } catch (error) {
      log.warn('Lock reclaim still failing; will retry', {
        key,
        error: getErrorMessage(error),
      });
    }
  }
  if (unconfirmedReleases.size === 0) stopReclaimTimer();
}

/** Outstanding unconfirmed releases; each one can wedge a wallet until its TTL. */
export function pendingUnconfirmedLockCount(): number {
  return unconfirmedReleases.size;
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
  const newExpiresAt = Date.now() + ttlMs;

  if (!lock.isLocal) {
    const redis = getRedisClient();
    if (!redis || !isRedisConnected()) {
      log.warn('Redis lock extension failed: authority unavailable', { key: lock.key });
      return null;
    }
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

  // Local locks are never inferred from Redis connection state.
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
  const mode = requireLockAuthorityMode();
  if (mode === 'redis-required') {
    const redis = requireRedisAuthority('check');
    try {
      const result = await redis.exists(`lock:${key}`);
      return result === 1;
    } catch (error) {
      log.warn('Redis lock check failed', { key, error: getErrorMessage(error) });
      throw new LockAuthorityUnavailableError('check', error);
    }
  }

  // Explicit single-process local authority.
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
  reclaimEnabled = false;
  reclaimSweepInFlight = false;
  stopReclaimTimer();
  unconfirmedReleases.clear();
  localLocks.clear();
  resetLockAuthority();
}
