/**
 * Fix Consolidations Phase
 *
 * Corrects transactions that were initially classified as "sent" but should
 * actually be "consolidations" (all outputs go to wallet addresses that were
 * derived after the initial classification).
 */

import { walletLog } from '../../../../websocket/notifications';
import { getConfig } from '../../../../config';
import {
  persistMisclassifiedConsolidations,
  prepareMisclassifiedConsolidations,
  recalculateWalletBalances,
} from '../../utils/balanceCalculation';
import type { SyncContext } from '../types';
import { runWalletSyncMutation } from '../mutationBoundary';

/**
 * Execute fix consolidations phase
 *
 * After all addresses are synced, checks for "sent" transactions that should
 * actually be consolidations (all outputs go to wallet addresses that were
 * derived after the initial classification).
 */
export async function fixConsolidationsPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId } = ctx;

  walletLog(walletId, 'debug', 'SYNC', 'Checking for misclassified consolidations...');

  const plan = await prepareMisclassifiedConsolidations(walletId);
  const batchSize = getConfig().sync.transactionBatchSize;
  let correctedCount = 0;
  for (let offset = 0; offset < plan.candidates.length; offset += batchSize) {
    const candidates = plan.candidates.slice(offset, offset + batchSize);
    correctedCount += await runWalletSyncMutation(
      ctx,
      'consolidation_repair',
      (tx, deferPostCommit) => persistMisclassifiedConsolidations(
        { ...plan, candidates },
        tx,
        deferPostCommit,
      ),
    );
  }
  if (correctedCount > 0) {
    await runWalletSyncMutation(ctx, 'balance_recalculation', async (tx, deferPostCommit) => {
      await recalculateWalletBalances(walletId, tx, deferPostCommit);
      deferPostCommit(() => {
      ctx.stats.correctedConsolidations = correctedCount;
      walletLog(
        walletId,
        'info',
        'SYNC',
        `Corrected ${correctedCount} misclassified consolidations, recalculating balances...`
      );
      });
    });
  }

  return ctx;
}
