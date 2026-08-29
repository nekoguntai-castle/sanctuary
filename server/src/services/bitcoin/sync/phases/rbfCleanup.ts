/**
 * RBF Cleanup Phase
 *
 * Marks pending transactions as replaced if a confirmed transaction
 * shares the same inputs. This catches RBF replacements from external
 * software or prior syncs.
 */

import { transactionRepository } from '../../../../repositories';
import { ADDRESS_SYNC_IO_UPSERT_MAX_ROWS } from '../../../../constants/addressSyncPersistence';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';
import { runWalletSyncMutation } from '../mutationBoundary';

type CleanupTarget = 'active' | 'unlinked';

async function reconcileRbfTarget(ctx: SyncContext, target: CleanupTarget): Promise<void> {
  for (;;) {
    const replacements = await transactionRepository.findWalletRbfReplacements(
      ctx.walletId,
      target,
      undefined,
      () => ctx.attemptRuntime?.signal.throwIfAborted(),
    );
    for (const replacement of replacements) {
      await runWalletSyncMutation(ctx, 'rbf_cleanup', async (tx, deferPostCommit) => {
        const changed = await transactionRepository.reconcileWalletRbfReplacement(
          ctx.walletId,
          replacement.id,
          replacement.replacementTxid,
          target,
          tx,
        );
        if (!changed) return;
        deferPostCommit(() => walletLog(
          ctx.walletId,
          'info',
          'RBF',
          target === 'active'
            ? `Cleanup: Marked ${replacement.txid.slice(0, 8)}... as replaced by ${replacement.replacementTxid.slice(0, 8)}...`
            : `Retroactive link: ${replacement.txid.slice(0, 8)}... replaced by ${replacement.replacementTxid.slice(0, 8)}...`
        ));
      });
    }
    if (replacements.length < ADDRESS_SYNC_IO_UPSERT_MAX_ROWS) return;
  }
}

/**
 * Execute RBF cleanup phase
 *
 * This phase runs at the start of sync to:
 * 1. Find pending transactions with stored inputs
 * 2. Check if any confirmed transaction uses the same inputs
 * 3. Mark the pending tx as "replaced" and link to the replacement
 * 4. Also repair orphaned replaced transactions (missing replacedByTxid)
 */
export async function rbfCleanupPhase(ctx: SyncContext): Promise<SyncContext> {
  await reconcileRbfTarget(ctx, 'active');
  await reconcileRbfTarget(ctx, 'unlinked');
  return ctx;
}
