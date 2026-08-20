/**
 * The sync retry ladder's durable attempt number.
 *
 * `executeSyncJob`'s `retryCount` is a call-stack parameter defaulting to 0, and
 * every external entry point (the manual Sync button, queue drain, the stale
 * sweep) calls it with that default. Only the in-heap retry timer passes a real
 * count. So an externally-triggered attempt restarted the ladder, wrote
 * "(retrying 1/3)" again, and the terminal `failed` write - which needs
 * `retryCount >= maxRetryAttempts` - was unreachable. A wallet observed in
 * production sat at "Retrying 1/3" for 14.5 hours against a deterministic
 * failure, never once reporting that it had given up.
 *
 * The attempt number is recovered from `lastSyncError`, which is the only place
 * it was ever persisted. Formatting and parsing live together here so the two
 * cannot drift apart.
 */

/** Matches the suffix written by `formatRetryError`. */
const RETRY_SUFFIX_PATTERN = /\s*\(retrying (\d+)\/(\d+)\)\s*$/;

/** Tag a failure message with the attempt it belongs to. */
export function formatRetryError(
  message: string,
  attempt: number,
  maxAttempts: number,
): string {
  return `${stripRetrySuffix(message)} (retrying ${attempt}/${maxAttempts})`;
}

/**
 * Remove any retry suffix, so repeated laps do not accumulate them.
 *
 * Without this a third attempt persists "... (retrying 1/3) (retrying 2/3)".
 */
export function stripRetrySuffix(message: string): string {
  return message.replace(RETRY_SUFFIX_PATTERN, '');
}

/**
 * Recover the attempt number a wallet had reached, or null when it had not
 * started a ladder. Only meaningful for a row whose status is 'retrying'.
 */
export function parseRetryAttempt(lastSyncError: string | null | undefined): number | null {
  if (!lastSyncError) return null;
  const match = RETRY_SUFFIX_PATTERN.exec(lastSyncError);
  if (!match) return null;
  const attempt = Number.parseInt(match[1], 10);
  return Number.isFinite(attempt) && attempt > 0 ? attempt : null;
}

/**
 * The attempt an externally-triggered sync should resume from.
 *
 * A wallet mid-ladder continues it; anything else starts at 0. Capped at
 * `maxAttempts` so a corrupted or hand-edited row cannot push the ladder past
 * its terminal write.
 */
export function resumeRetryCount(
  wallet: { lastSyncStatus?: string | null; lastSyncError?: string | null } | null | undefined,
  maxAttempts: number,
): number {
  if (!wallet || wallet.lastSyncStatus !== 'retrying') return 0;
  const attempt = parseRetryAttempt(wallet.lastSyncError);
  if (attempt === null) return 0;
  return Math.min(attempt, maxAttempts);
}
