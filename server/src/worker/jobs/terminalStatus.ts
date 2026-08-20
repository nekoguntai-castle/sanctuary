/**
 * Durable recording of a sync's terminal status.
 *
 * The failure-status write runs over the very connection pool whose collapse
 * often caused the failure — `Connection terminated unexpectedly` is a dropped
 * Postgres connection, and it arrives through the sync pipeline and through the
 * write that would record it alike. A single best-effort attempt whose
 * rejection is logged and swallowed leaves the row carrying its previous
 * `success`, which is how a wallet showed a green "Synced" badge over a failure
 * logged six minutes earlier.
 *
 * Retry here is short and bounded. The goal is to outlive a pool blip, not to
 * guarantee delivery: the job's own error path must still run, so this never
 * throws and never blocks for long.
 */
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';

const log = createLogger('JOB:SYNC_STATUS');

/** Backoff between attempts; its length plus one is the attempt count. */
const RETRY_BACKOFF_MS = [250, 1_000, 3_000] as const;

type WalletStatusUpdate = Record<string, unknown>;

interface StatusWriter {
  update: (walletId: string, data: WalletStatusUpdate) => Promise<unknown>;
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
});

/**
 * Write a wallet's terminal sync status, retrying a transient pool failure.
 *
 * @returns true when the row was written; false when every attempt failed.
 *          Never throws — the caller is already handling a sync failure and
 *          must not have it replaced by a bookkeeping error.
 */
export async function persistTerminalSyncStatus(
  walletId: string,
  data: WalletStatusUpdate,
  writer: StatusWriter,
): Promise<boolean> {
  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      await writer.update(walletId, data);
      if (attempt > 0) {
        log.info(`Recorded terminal sync status for wallet ${walletId} after ${attempt} retries`);
      }
      return true;
    } catch (error) {
      const isLastAttempt = attempt === RETRY_BACKOFF_MS.length;
      if (isLastAttempt) {
        // The row now disagrees with reality: it keeps whatever status it had,
        // which for a previously-healthy wallet is a green badge over a failure.
        log.error(`Could not record terminal sync status for wallet ${walletId}; the row is now stale`, {
          error: getErrorMessage(error),
          attempts: attempt + 1,
          intended: data,
        });
        return false;
      }
      log.warn(`Terminal sync status write failed for wallet ${walletId}; retrying`, {
        error: getErrorMessage(error),
        attempt: attempt + 1,
      });
      await delay(RETRY_BACKOFF_MS[attempt]);
    }
  }
  /* v8 ignore next -- unreachable: the loop returns on every path */
  return false;
}
