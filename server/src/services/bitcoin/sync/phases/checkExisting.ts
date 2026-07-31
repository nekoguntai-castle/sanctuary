/**
 * Check Existing Phase
 *
 * Checks which transactions already exist in the database to avoid
 * re-processing them. Populates existingTxMap, existingTxidSet, and newTxids.
 */

import { transactionRepository } from '../../../../repositories';
import { CURRENT_TRANSACTION_CLASSIFICATION_VERSION } from '../../../../constants/transactionClassification';
import { createLogger } from '../../../../utils/logger';
import { walletLog } from '../../../../websocket/notifications';
import type { SyncContext } from '../types';

type ExistingTransaction = {
  txid: string;
  type: string;
  classificationInputsComplete: boolean;
  classificationVersion: number;
  classificationAddressCount: number;
  classificationLastAttemptAt: Date | null;
  ioComplete: boolean;
  ioLastAttemptAt: Date | null;
};

export const CLASSIFICATION_REPAIR_CANDIDATE_LIMIT = 100;
export const IO_REPAIR_CANDIDATE_LIMIT = 100;

const needsClassificationRecheck = (
  transaction: ExistingTransaction,
  ownershipRepairTxids: ReadonlySet<string>
): boolean =>
  transaction.classificationVersion < CURRENT_TRANSACTION_CLASSIFICATION_VERSION
  || !transaction.classificationInputsComplete
  || ownershipRepairTxids.has(transaction.txid);

const compareAttemptTimes = (
  leftAttemptAt: Date | null,
  rightAttemptAt: Date | null,
  leftTxid: string,
  rightTxid: string
): number => {
  const leftAttempt = leftAttemptAt?.getTime();
  const rightAttempt = rightAttemptAt?.getTime();
  if (leftAttempt === undefined && rightAttempt !== undefined) return -1;
  if (leftAttempt !== undefined && rightAttempt === undefined) return 1;
  return (leftAttempt ?? 0) - (rightAttempt ?? 0)
    || leftTxid.localeCompare(rightTxid);
};

const getClassificationRepairTxids = (
  existingTxs: ExistingTransaction[],
  ownershipRepairTxids: ReadonlySet<string>
): Set<string> => new Set(
  existingTxs
    .filter(transaction => needsClassificationRecheck(transaction, ownershipRepairTxids))
    .sort((left, right) => compareAttemptTimes(
      left.classificationLastAttemptAt,
      right.classificationLastAttemptAt,
      left.txid,
      right.txid
    ))
    .slice(0, CLASSIFICATION_REPAIR_CANDIDATE_LIMIT)
    .map(transaction => transaction.txid)
);

const getIoRepairTxids = (existingTxs: ExistingTransaction[]): Set<string> => new Set(
  existingTxs
    .filter(transaction => !transaction.ioComplete)
    .sort((left, right) => compareAttemptTimes(
      left.ioLastAttemptAt,
      right.ioLastAttemptAt,
      left.txid,
      right.txid
    ))
    .slice(0, IO_REPAIR_CANDIDATE_LIMIT)
    .map(transaction => transaction.txid)
);

const log = createLogger('BITCOIN:SVC_SYNC_CHECK');

/**
 * Execute check existing phase
 *
 * Queries the database for existing transactions to identify
 * which txids are new and need to be fetched and processed.
 */
export async function checkExistingPhase(ctx: SyncContext): Promise<SyncContext> {
  const { walletId, allTxids } = ctx;

  walletLog(walletId, 'debug', 'SYNC', `Checking ${allTxids.size} transactions against database...`);

  // Batch check which transactions already exist
  const existingTxs = await transactionRepository.findByWalletIdAndTxids(
    walletId,
    Array.from(allTxids),
    {
      txid: true,
      type: true,
      classificationInputsComplete: true,
      classificationVersion: true,
      classificationAddressCount: true,
      classificationLastAttemptAt: true,
      ioComplete: true,
      ioLastAttemptAt: true,
    }
  );
  const ownershipRepairTargets = await transactionRepository.findOwnershipRepairTargets(
    walletId,
    Array.from(allTxids)
  );
  const ownershipRepairTxids = new Set(
    ownershipRepairTargets.map(target => target.txid)
  );

  // Build lookup maps
  ctx.existingTxMap = new Map(existingTxs.map(tx => [`${tx.txid}:${tx.type}`, true]));
  ctx.existingTxidSet = new Set(existingTxs.map(tx => tx.txid));

  // Historical and partially resolved rows remain repairable until a raw-tx
  // classification proves every non-coinbase input had address evidence.
  ctx.classificationRepairTxids = getClassificationRepairTxids(
    existingTxs,
    ownershipRepairTxids
  );
  ctx.ioRepairTxids = getIoRepairTxids(existingTxs);
  ctx.newTxids = Array.from(allTxids).filter(
    txid => !ctx.existingTxidSet.has(txid)
      || ctx.classificationRepairTxids.has(txid)
      || ctx.ioRepairTxids.has(txid)
  );

  log.debug(
    `[SYNC] Found ${ctx.newTxids.length} transaction candidates to process (${ctx.existingTxidSet.size} already exist)`
  );

  if (ctx.newTxids.length > 0) {
    walletLog(walletId, 'info', 'BLOCKCHAIN', `Fetching ${ctx.newTxids.length} transaction candidates`, {
      existing: ctx.existingTxidSet.size,
    });
  }

  return ctx;
}
