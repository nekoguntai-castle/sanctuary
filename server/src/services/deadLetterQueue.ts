/**
 * Dead Letter Queue Service
 *
 * Tracks operations that failed after all retry attempts.
 * Provides visibility into persistent failures for debugging and manual intervention.
 *
 * Features:
 * - In-memory storage with bounded size (LRU eviction)
 * - Redis persistence when available
 * - Categorized by operation type (sync, push, notification, etc.)
 * - Auto-cleanup of old entries
 * - Manual retry support
 */

import { createLogger } from '../utils/logger';
import { getErrorMessage } from '../utils/errors';
import { getDistributedCache } from '../infrastructure';

const log = createLogger('DLQ');

// =============================================================================
// Types
// =============================================================================

export type DeadLetterCategory =
  | 'sync'
  | 'push'
  | 'telegram'
  | 'notification'
  | 'electrum'
  | 'transaction'
  | 'other';

export interface DeadLetterEntry {
  id: string;
  category: DeadLetterCategory;
  operation: string;
  payload: Record<string, unknown>;
  error: string;
  errorStack?: string;
  attempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface DeadLetterStats {
  total: number;
  byCategory: Record<DeadLetterCategory, number>;
  oldest?: Date;
  newest?: Date;
}

// =============================================================================
// Configuration
// =============================================================================

const MAX_ENTRIES = 1000;
const ENTRY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REDIS_KEY_PREFIX = 'dlq:';

// =============================================================================
// In-Memory Storage
// =============================================================================

class DeadLetterQueue {
  private entries: Map<string, DeadLetterEntry> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Start the cleanup interval
   */
  start(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);

    // Don't keep process alive just for cleanup
    this.cleanupInterval.unref();

    log.info('Dead letter queue started');
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    log.info('Dead letter queue stopped');
  }

  /**
   * Add a failed operation to the dead letter queue
   */
  async add(
    category: DeadLetterCategory,
    operation: string,
    payload: Record<string, unknown>,
    error: Error | string,
    attempts: number,
    metadata?: Record<string, unknown>
  ): Promise<string> {
    const id = `${category}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const now = new Date();

    const entry: DeadLetterEntry = {
      id,
      category,
      operation,
      payload,
      error: getErrorMessage(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      attempts,
      firstFailedAt: now,
      lastFailedAt: now,
      metadata,
    };

    // Enforce size limit with LRU eviction
    if (this.entries.size >= MAX_ENTRIES) {
      const oldestId = this.entries.keys().next().value;
      if (oldestId) {
        this.entries.delete(oldestId);
      }
    }

    this.entries.set(id, entry);

    // Try to persist to Redis
    await this.persistToRedis(entry);

    log.warn('Dead letter entry added', {
      id,
      category,
      operation,
      attempts,
      error: entry.error.substring(0, 100),
    });

    return id;
  }

  /**
   * Update an existing entry (for operations with same key)
   */
  async update(
    existingId: string,
    error: Error | string,
    attempts: number
  ): Promise<void> {
    const entry = this.entries.get(existingId);
    if (!entry) return;

    entry.error = getErrorMessage(error);
    entry.errorStack = error instanceof Error ? error.stack : undefined;
    entry.attempts = attempts;
    entry.lastFailedAt = new Date();

    await this.persistToRedis(entry);
  }

  /**
   * Get a specific entry by ID
   */
  get(id: string): DeadLetterEntry | undefined {
    return this.entries.get(id);
  }

  /**
   * Get all entries for a category
   */
  getByCategory(category: DeadLetterCategory): DeadLetterEntry[] {
    return Array.from(this.entries.values()).filter(
      (entry) => entry.category === category
    );
  }

  /**
   * Get all entries, optionally limited
   */
  getAll(limit?: number): DeadLetterEntry[] {
    const entries = Array.from(this.entries.values()).sort(
      (a, b) => b.lastFailedAt.getTime() - a.lastFailedAt.getTime()
    );
    return limit ? entries.slice(0, limit) : entries;
  }

  /**
   * Remove an entry and return it for retry.
   * The caller is responsible for re-dispatching the operation.
   */
  async dequeueForRetry(id: string): Promise<DeadLetterEntry | null> {
    const entry = this.entries.get(id);
    if (!entry) return null;
    this.entries.delete(id);
    await this.removeFromRedis(id);
    return entry;
  }

  /**
   * Remove an entry (e.g., after successful manual retry)
   */
  async remove(id: string): Promise<boolean> {
    const existed = this.entries.delete(id);
    if (existed) {
      await this.removeFromRedis(id);
    }
    return existed;
  }

  /**
   * Clear all entries for a category
   */
  async clearCategory(category: DeadLetterCategory): Promise<number> {
    let count = 0;
    for (const [id, entry] of this.entries) {
      if (entry.category === category) {
        this.entries.delete(id);
        await this.removeFromRedis(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get statistics about the dead letter queue
   */
  getStats(): DeadLetterStats {
    const entries = Array.from(this.entries.values());
    const byCategory: Record<DeadLetterCategory, number> = {
      sync: 0,
      push: 0,
      telegram: 0,
      notification: 0,
      electrum: 0,
      transaction: 0,
      other: 0,
    };

    let oldest: Date | undefined;
    let newest: Date | undefined;

    for (const entry of entries) {
      byCategory[entry.category]++;
      if (!oldest || entry.firstFailedAt < oldest) {
        oldest = entry.firstFailedAt;
      }
      if (!newest || entry.lastFailedAt > newest) {
        newest = entry.lastFailedAt;
      }
    }

    return {
      total: entries.length,
      byCategory,
      oldest,
      newest,
    };
  }

  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    let removed = 0;

    for (const [id, entry] of this.entries) {
      if (entry.lastFailedAt.getTime() < cutoff) {
        this.entries.delete(id);
        removed++;
      }
    }

    if (removed > 0) {
      log.info(`Dead letter queue cleanup: removed ${removed} old entries`);
    }
  }

  /**
   * Persist entry to Redis (if available)
   */
  private async persistToRedis(entry: DeadLetterEntry): Promise<void> {
    try {
      const cache = getDistributedCache();
      if (cache) {
        await cache.set(
          `${REDIS_KEY_PREFIX}${entry.id}`,
          JSON.stringify(entry),
          ENTRY_TTL_MS / 1000
        );
      }
    } catch (error) {
      log.debug('Redis DLQ persist failed (non-critical)', { error: getErrorMessage(error) });
    }
  }

  /**
   * Remove entry from Redis
   */
  private async removeFromRedis(id: string): Promise<void> {
    try {
      const cache = getDistributedCache();
      if (cache) {
        await cache.delete(`${REDIS_KEY_PREFIX}${id}`);
      }
    } catch (error) {
      log.debug('Redis DLQ delete failed (non-critical)', { error: getErrorMessage(error) });
    }
  }

  /**
   * Load entries from Redis on startup
   */
  async loadFromRedis(): Promise<void> {
    try {
      const cache = getDistributedCache();
      if (!cache) return;

      // Note: This requires Redis SCAN which isn't available via cache interface
      // For full implementation, we'd need direct Redis access
      // For now, the in-memory store is primary and Redis is backup
      log.debug('Redis DLQ restoration skipped - using in-memory primary');
    } catch (error) {
      log.debug('Redis DLQ load failed (non-critical)', { error: getErrorMessage(error) });
    }
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

export const deadLetterQueue = new DeadLetterQueue();

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Record a sync failure in the dead letter queue
 */
export async function recordSyncFailure(
  walletId: string,
  error: Error | string,
  attempts: number,
  additionalInfo?: Record<string, unknown>
): Promise<string> {
  return deadLetterQueue.add(
    'sync',
    'wallet_sync',
    { walletId, ...additionalInfo },
    error,
    attempts,
    { walletId }
  );
}

/**
 * Record a push notification failure
 */
export async function recordPushFailure(
  userId: string,
  token: string,
  error: Error | string,
  attempts: number,
  payload?: Record<string, unknown>
): Promise<string> {
  return deadLetterQueue.add(
    'push',
    'push_notification',
    { userId, token: token.substring(0, 20) + '...', payload },
    error,
    attempts,
    { userId }
  );
}

/**
 * Record an Electrum connection failure
 */
export async function recordElectrumFailure(
  host: string,
  port: number,
  error: Error | string,
  attempts: number
): Promise<string> {
  return deadLetterQueue.add(
    'electrum',
    'connection',
    { host, port },
    error,
    attempts
  );
}

/**
 * Record a transaction broadcast failure
 */
export async function recordTransactionFailure(
  walletId: string,
  txid: string,
  error: Error | string,
  attempts: number
): Promise<string> {
  return deadLetterQueue.add(
    'transaction',
    'broadcast',
    { walletId, txid },
    error,
    attempts,
    { walletId, txid }
  );
}

export default deadLetterQueue;
