import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { syncIntentAdmission } from './syncIntentAdmission';

const log = createLogger('SYNC:INITIAL_INTENT');

export const INITIAL_SYNC_GENERATION = 1;

/**
 * Best-effort post-commit wake-up for the initial generation stored atomically
 * with a new wallet. Bounded recovery remains authoritative if activation or
 * Redis is unavailable at creation time.
 */
export async function wakeInitialWalletSync(walletId: string): Promise<void> {
  try {
    const enqueued = await syncIntentAdmission.wake(walletId, INITIAL_SYNC_GENERATION);
    if (!enqueued) {
      log.warn('Initial wallet sync wake-up deferred to recovery', { walletId });
    }
  } catch (error) {
    log.warn('Initial wallet sync wake-up failed; durable intent retained', {
      walletId,
      error: getErrorMessage(error),
    });
  }
}
