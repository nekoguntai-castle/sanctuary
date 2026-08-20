/**
 * Non-regression tests for the 2026-08-20 frozen retry ladder.
 *
 * `Nekoworks-MS1` sat at `lastSyncStatus = retrying`,
 * `lastSyncError = '... (retrying 1/3)'` for 14.5 hours against a deterministic
 * evidence-gate failure. It never advanced to 2/3 and never reached the
 * terminal `failed` write, because the attempt number lived only on the call
 * stack and every external trigger reset it to 0.
 */
import { describe, expect, it } from 'vitest';
import {
  formatRetryError,
  parseRetryAttempt,
  resumeRetryCount,
  stripRetrySuffix,
} from '../../../../src/services/sync/retryLadder';

describe('retry ladder attempt persistence', () => {
  it('round-trips the attempt number through the persisted message', () => {
    const formatted = formatRetryError('Sync pipeline failed', 2, 3);
    expect(formatted).toBe('Sync pipeline failed (retrying 2/3)');
    expect(parseRetryAttempt(formatted)).toBe(2);
  });

  it('does not accumulate suffixes across laps', () => {
    const first = formatRetryError('boom', 1, 3);
    const second = formatRetryError(first, 2, 3);
    expect(second).toBe('boom (retrying 2/3)');
    expect(second.match(/retrying/g)).toHaveLength(1);
  });

  it('returns null for a message with no ladder', () => {
    expect(parseRetryAttempt('Sync pipeline failed')).toBeNull();
    expect(parseRetryAttempt(null)).toBeNull();
    expect(parseRetryAttempt(undefined)).toBeNull();
    expect(parseRetryAttempt('')).toBeNull();
  });

  it('resumes an in-progress ladder for an externally triggered sync', () => {
    // The bug: this returned 0, so the wallet wrote "(retrying 1/3)" forever.
    expect(resumeRetryCount(
      { lastSyncStatus: 'retrying', lastSyncError: 'boom (retrying 2/3)' },
      3,
    )).toBe(2);
  });

  it('starts a fresh ladder for any non-retrying status', () => {
    expect(resumeRetryCount({ lastSyncStatus: 'failed', lastSyncError: 'boom (retrying 2/3)' }, 3)).toBe(0);
    expect(resumeRetryCount({ lastSyncStatus: 'success', lastSyncError: null }, 3)).toBe(0);
    expect(resumeRetryCount(null, 3)).toBe(0);
    expect(resumeRetryCount(undefined, 3)).toBe(0);
  });

  it('caps a corrupted attempt number at the configured maximum', () => {
    expect(resumeRetryCount(
      { lastSyncStatus: 'retrying', lastSyncError: 'boom (retrying 99/3)' },
      3,
    )).toBe(3);
  });

  it('ignores a zero or malformed attempt number', () => {
    expect(parseRetryAttempt('boom (retrying 0/3)')).toBeNull();
    expect(parseRetryAttempt('boom (retrying x/3)')).toBeNull();
  });

  it('strips a suffix without disturbing a message that has none', () => {
    expect(stripRetrySuffix('plain message')).toBe('plain message');
    expect(stripRetrySuffix('boom (retrying 1/3)')).toBe('boom');
  });

  it('reaches the terminal attempt so the failed write becomes possible', () => {
    // The ladder must be able to arrive at maxAttempts; that is the condition
    // guarding the terminal `failed` write in walletSync.ts.
    let attempt = resumeRetryCount(
      { lastSyncStatus: 'retrying', lastSyncError: formatRetryError('boom', 3, 3) },
      3,
    );
    expect(attempt).toBe(3);
    expect(attempt >= 3).toBe(true);
  });
});

describe('resumeRetryCount edge cases', () => {
  it('treats a retrying row whose message lost its suffix as a fresh ladder', () => {
    // A hand-edited or truncated lastSyncError must not resume at NaN.
    expect(resumeRetryCount(
      { lastSyncStatus: 'retrying', lastSyncError: 'no suffix here' },
      3,
    )).toBe(0);
  });

  it('does not exceed maxAttempts when the ladder is already at the cap', () => {
    expect(resumeRetryCount(
      { lastSyncStatus: 'retrying', lastSyncError: 'boom (retrying 3/3)' },
      3,
    )).toBe(3);
  });

  it('handles a retrying row with a null error', () => {
    expect(resumeRetryCount({ lastSyncStatus: 'retrying', lastSyncError: null }, 3)).toBe(0);
  });
});
