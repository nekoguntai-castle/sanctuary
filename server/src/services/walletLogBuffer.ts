/**
 * Wallet Log Buffer Service
 *
 * Stores wallet sync logs in memory with bounded storage.
 * Uses a ring buffer pattern per wallet to prevent unbounded growth.
 * Inactive wallets have their logs cleaned up after 30 minutes.
 */

import { WalletLogEntry } from '../websocket/notifications';
import { createLogger } from '../utils/logger';
import {
  WALLET_LOG_MAX_ENTRIES,
  WALLET_LOG_INACTIVE_CLEANUP_MS,
  WALLET_LOG_CLEANUP_INTERVAL_MS,
} from '../constants';

const log = createLogger('WALLET_LOG:SVC');

class WalletLogBuffer {
  private buffers: Map<string, WalletLogEntry[]> = new Map();
  private lastActivity: Map<string, number> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startCleanupInterval();
  }

  /**
   * Add a log entry for a wallet
   * If the buffer is full, the oldest entry is discarded
   */
  add(walletId: string, entry: WalletLogEntry): void {
    let buffer = this.buffers.get(walletId);

    if (!buffer) {
      buffer = [];
      this.buffers.set(walletId, buffer);
    }

    // Ring buffer: if full, remove oldest entry
    if (buffer.length >= WALLET_LOG_MAX_ENTRIES) {
      buffer.shift();
    }

    buffer.push(entry);
    this.lastActivity.set(walletId, Date.now());
  }

  /**
   * Get all log entries for a wallet
   * Returns a copy of the array to prevent external modification
   */
  get(walletId: string): WalletLogEntry[] {
    const buffer = this.buffers.get(walletId);
    return buffer ? [...buffer] : [];
  }

  /**
   * Clear log entries for a wallet
   */
  clear(walletId: string): void {
    this.buffers.delete(walletId);
    this.lastActivity.delete(walletId);
  }

  /**
   * Get the number of entries stored for a wallet
   */
  getCount(walletId: string): number {
    return this.buffers.get(walletId)?.length ?? 0;
  }

  /**
   * Get all buffers (copies) keyed by wallet ID
   */
  getAll(): Map<string, WalletLogEntry[]> {
    const result = new Map<string, WalletLogEntry[]>();
    for (const [walletId, buffer] of this.buffers) {
      result.set(walletId, [...buffer]);
    }
    return result;
  }

  /**
   * Get statistics about the buffer
   */
  getStats(): { walletCount: number; totalEntries: number } {
    let totalEntries = 0;
    for (const buffer of this.buffers.values()) {
      totalEntries += buffer.length;
    }
    return {
      walletCount: this.buffers.size,
      totalEntries,
    };
  }

  /**
   * Start the cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, WALLET_LOG_CLEANUP_INTERVAL_MS);

    // Don't prevent process from exiting
    this.cleanupInterval.unref();
  }

  /**
   * Stop the cleanup interval (for graceful shutdown)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up inactive wallet buffers
   * Removes logs for wallets with no activity in the last 30 minutes
   */
  private cleanup(): void {
    const now = Date.now();
    const cutoff = now - WALLET_LOG_INACTIVE_CLEANUP_MS;
    let cleanedCount = 0;

    for (const [walletId, lastActive] of this.lastActivity.entries()) {
      if (lastActive < cutoff) {
        this.buffers.delete(walletId);
        this.lastActivity.delete(walletId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      log.debug(`Cleaned up log buffers for ${cleanedCount} inactive wallet(s)`);
    }
  }
}

// Singleton instance
export const walletLogBuffer = new WalletLogBuffer();
