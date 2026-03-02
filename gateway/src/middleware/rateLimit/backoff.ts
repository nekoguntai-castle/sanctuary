/**
 * Exponential Backoff Tracker
 *
 * Tracks rate limit violations per client and calculates exponential
 * backoff retry-after times.
 *
 * When rate limited, the retry-after time doubles with each subsequent violation:
 * - 1st violation: 60 seconds
 * - 2nd violation: 120 seconds
 * - 3rd violation: 240 seconds
 * - ... up to max of 3600 seconds (1 hour)
 *
 * Backoff state resets after successful request or window expiry.
 */

import { config } from '../../config';

/**
 * Exponential backoff tracker for rate-limited clients
 * Maps client key to { violations: number, lastViolation: timestamp }
 */
export const backoffTracker = new Map<string, { violations: number; lastViolation: number }>();

/**
 * Calculate exponential backoff retry-after time
 * Exported for testing purposes
 */
export function calculateBackoff(key: string): number {
  const { baseRetryAfter, maxRetryAfter, multiplier } = config.rateLimit.backoff;
  const tracker = backoffTracker.get(key);

  if (!tracker) {
    // First violation
    backoffTracker.set(key, { violations: 1, lastViolation: Date.now() });
    return baseRetryAfter;
  }

  // Check if previous violation has expired (reset after window + retry period)
  const windowMs = config.rateLimit.windowMs;
  if (Date.now() - tracker.lastViolation > windowMs + tracker.violations * baseRetryAfter * 1000) {
    // Reset backoff
    backoffTracker.set(key, { violations: 1, lastViolation: Date.now() });
    return baseRetryAfter;
  }

  // Increment violations and calculate backoff
  tracker.violations++;
  tracker.lastViolation = Date.now();

  const retryAfter = Math.min(
    baseRetryAfter * Math.pow(multiplier, tracker.violations - 1),
    maxRetryAfter
  );

  return Math.ceil(retryAfter);
}

/**
 * Reset backoff for a client (call on successful request after rate limit)
 */
export function resetBackoff(key: string): void {
  backoffTracker.delete(key);
}

/**
 * Clean up old backoff entries (call periodically)
 */
export function cleanupBackoffTracker(): void {
  const maxAge = config.rateLimit.windowMs * 2; // Clean entries older than 2x window
  const now = Date.now();

  for (const [key, tracker] of backoffTracker.entries()) {
    if (now - tracker.lastViolation > maxAge) {
      backoffTracker.delete(key);
    }
  }
}
