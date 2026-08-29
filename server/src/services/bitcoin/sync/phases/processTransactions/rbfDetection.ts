/**
 * RBF (Replace-By-Fee) Detection
 *
 * Implements detection per BIP-125: when a confirmed transaction shares an input
 * with a pending transaction, the pending tx has been replaced.
 * See: https://github.com/bitcoin/bips/blob/master/bip-0125.mediawiki
 */

import { transactionRepository } from '../../../../../repositories';
import { walletLog } from '../../../../../websocket/notifications';
import type { PrismaTxClient } from '../../../../../models/prisma';

/**
 * Detect and link RBF (Replace-By-Fee) replacements
 */
export async function detectRBFReplacements(
  walletId: string,
  createdTxRecords: Array<{ id: string; txid: string; type: string }>,
  confirmedTxids: ReadonlySet<string>,
  inputBearingTransactionIds: string[],
  tx?: PrismaTxClient,
  deferPostCommit?: (effect: () => void | Promise<void>) => void,
  assertActive: () => void = () => undefined,
): Promise<void> {
  const inputBearingIds = new Set(inputBearingTransactionIds);
  const confirmedTransactions = createdTxRecords.filter(
    transaction => confirmedTxids.has(transaction.txid)
      && inputBearingIds.has(transaction.id)
  );
  if (confirmedTransactions.length === 0) return;

  const replacementCount = await transactionRepository.reconcilePendingRbfForConfirmedTransactions(
    walletId,
    confirmedTransactions.map(transaction => ({
      id: transaction.id,
      txid: transaction.txid,
    })),
    tx,
    assertActive,
  );
  if (replacementCount === 0) return;

  const publish = () => walletLog(
    walletId,
    'info',
    'RBF',
    `Linked ${replacementCount} pending transaction(s) to confirmed replacement(s)`
  );
  if (deferPostCommit) deferPostCommit(publish);
  else publish();
}
