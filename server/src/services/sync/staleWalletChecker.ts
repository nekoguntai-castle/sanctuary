/**
 * Stale Wallet Checker
 *
 * Handles wallets with stuck sync states:
 * - resetStuckSyncs: Clears syncInProgress flags left over from a previous server session.
 */

import { walletRepository } from '../../repositories';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { getConfig } from '../../config';
import { withLock } from '../../infrastructure';
import { syncLifecyclePublisher } from './syncLifecyclePublisher';
import { syncIntentAdmission } from './syncIntentAdmission';
import { getSyncLockKey, getSyncLockTtlMs } from '../../jobs/syncJobContract';

const log = createLogger('SYNC:STALE');

interface StuckSyncCandidate {
  id: string;
  syncExecutionOwner?: string | null;
  syncStartedAt?: Date | null;
  syncStateVersion?: number;
}

/**
 * Decide whether this API process has authority to clear an active sync row.
 * Worker-owned rows additionally require an expired attempt clock. Every
 * remote candidate is cleared only while holding its distributed sync lock,
 * preventing both cross-process corruption and probe-then-clear races.
 */
export async function clearStuckSyncIfAuthorized(
  wallet: StuckSyncCandidate,
  activeSyncs: ReadonlySet<string>,
): Promise<boolean> {
  if (activeSyncs.has(wallet.id)) return false;
  if (
    !Number.isInteger(wallet.syncStateVersion)
    || wallet.syncExecutionOwner === undefined
    || wallet.syncStartedAt === undefined
  ) return false;

  if (wallet.syncExecutionOwner === 'worker') {
    const { maxSyncDurationMs } = getConfig().sync;
    const isExpired = wallet.syncStartedAt === null
      || wallet.syncStartedAt === undefined
      || wallet.syncStartedAt.getTime() < Date.now() - maxSyncDurationMs;
    if (!isExpired) return false;
  }

  try {
    const result = await withLock(
      getSyncLockKey({ walletId: wallet.id }),
      getSyncLockTtlMs(),
      () => syncIntentAdmission.reset(wallet.id, {
        syncStateVersion: wallet.syncStateVersion as number,
        syncExecutionOwner: wallet.syncExecutionOwner as string | null,
        syncStartedAt: wallet.syncStartedAt as Date | null,
      }),
    );
    if (!result.success || result.result === null) return false;
    await syncLifecyclePublisher.publish({
      walletId: wallet.id,
      transition: 'cleared',
      state: result.result,
    });
    return true;
  } catch (error) {
    log.warn(`[SYNC] Could not acquire stale-sync authority for wallet ${wallet.id}`, {
      error: getErrorMessage(error),
    });
    return false;
  }
}

/**
 * Reset any wallets that have syncInProgress stuck as true.
 * This happens if the server was restarted during a sync.
 */
export async function resetStuckSyncs(): Promise<void> {
  try {
    const count = await walletRepository.resetAllStuckSyncFlags();
    if (count > 0) {
      const result = { count };
      log.info(`[SYNC] Reset ${result.count} stuck sync flags from previous session`);
    }
  } catch (error) {
    log.error('[SYNC] Failed to reset stuck sync flags', { error: getErrorMessage(error) });
  }
}
