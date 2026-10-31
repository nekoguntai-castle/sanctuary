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
  blockHeight: number | null;
  blockTime: Date | null;
  createdAt: Date;
};

export const CLASSIFICATION_REPAIR_CANDIDATE_LIMIT = 100;
export const IO_REPAIR_CANDIDATE_LIMIT = 100;
/** Bitcoin block timestamps may be up to two hours off the wall clock. */
export const HELD_RECEIVE_CONFIRMATION_TOLERANCE_MS = 2 * 60 * 60 * 1000;

/**
 * A repaired incomplete 'received' row is announced only if a sync that would
 * otherwise have announced it withheld that announcement when it stored the
 * row. Only rows a sync classifier wrote (address count > 0) can have been
 * held: broadcast-created internal receives and legacy rows keep the default
 * 0 and were already announced.
 *
 * Whether the storing sync would have announced the row is not stored, so it
 * is approximated from the row itself. A baseline sync (first sync after an
 * import, or after a full resync) announces only unconfirmed transactions, and
 * the history it stores was confirmed long before the row was created. A
 * normal sync stores a transaction while it is unconfirmed (no block height
 * or block time) or within one sync interval of its confirmation. So a row is
 * treated as held when it is unconfirmed, or its block time is no earlier than
 * its creation minus the block-timestamp tolerance. A confirmed row without a
 * block time (its block-header timestamp could not be fetched) is treated as
 * history: failing silent is the safe side. A wallet that went unsynced for
 * longer than the tolerance stores its missed history silently as well.
 */
const isHeldIncompleteReceive = (transaction: ExistingTransaction): boolean =>
  transaction.type === 'received'
  && !transaction.classificationInputsComplete
  && transaction.classificationAddressCount > 0
  && (transaction.blockTime === null
    ? transaction.blockHeight === null
    : transaction.blockTime.getTime()
      >= transaction.createdAt.getTime() - HELD_RECEIVE_CONFIRMATION_TOLERANCE_MS);

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
      blockHeight: true,
      blockTime: true,
      createdAt: true,
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
  ctx.incompleteReceiveTxids = new Set(existingTxs
    .filter(isHeldIncompleteReceive)
    .map(transaction => transaction.txid));
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
