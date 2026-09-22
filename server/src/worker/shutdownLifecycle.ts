import { getErrorMessage } from '../utils/errors';
import { createLogger } from '../utils/logger';

export const WORKER_SHUTDOWN_TIMEOUT_MS = 30_000;
const log = createLogger('WORKER');

/** Start the worker-wide deadline without keeping an otherwise drained process alive. */
export function startWorkerShutdownDeadline(onTimeout: () => void): NodeJS.Timeout {
  const deadline = setTimeout(() => {
    log.error('Worker shutdown timed out, forcing exit', {
      timeoutMs: WORKER_SHUTDOWN_TIMEOUT_MS,
    });
    onTimeout();
  }, WORKER_SHUTDOWN_TIMEOUT_MS);
  deadline.unref();
  return deadline;
}

/**
 * Settle accepted checkpoint tails, log failures, then clear caller bookkeeping.
 * The caller must close admission before passing the final tail-map snapshot.
 */
export async function drainSubscriptionStatusTails(
  tails: Map<string, Promise<void>>,
): Promise<void> {
  const results = await Promise.allSettled([...tails.values()]);
  for (const result of results) {
    if (result.status === 'rejected') {
      log.error('Accepted subscription checkpoint failed during shutdown', {
        error: getErrorMessage(result.reason),
      });
    }
  }
  tails.clear();
}
