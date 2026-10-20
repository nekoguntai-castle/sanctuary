import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import {
  MAX_RECONCILE_ATTEMPTS,
  transactionSigningIntentRepository,
} from '../../../repositories/transactionSigningIntentRepository';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import {
  broadcastAuthenticatedRawTransaction,
  getTransactionDetails,
  isNodeAnsweredBroadcastFailure,
} from '../blockchain';
import { isBitcoinNetwork } from '../networks';
import { persistTransaction } from '../transactions/persistTransaction';
import {
  DurableBroadcastMetadataSchema,
  type DurableBroadcastMetadata,
} from './broadcastLifecycle';
import { toPrismaInputJson } from './json';
import { SigningIntentSnapshotSchema } from './schema';

const log = createLogger('BITCOIN:SIGNING_INTENT_RECONCILIATION');
const LEASE_MS = 60_000;

const parseMetadata = (value: Prisma.JsonValue | null): DurableBroadcastMetadata | null => {
  const parsed = DurableBroadcastMetadataSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const reconcileAccepted = async (record: {
  id: string;
  walletId: string;
  broadcastTxid: string | null;
  broadcastRawTx: string | null;
  broadcastMetadata: Prisma.JsonValue | null;
}): Promise<boolean> => {
  const metadata = parseMetadata(record.broadcastMetadata);
  if (!record.broadcastTxid || !record.broadcastRawTx || !metadata) return false;
  await persistTransaction(record.walletId, record.broadcastTxid, record.broadcastRawTx, metadata);
  return transactionSigningIntentRepository.markBroadcastComplete(record.id, record.broadcastTxid);
};

/**
 * Keep a failed re-broadcast uncertain, or stop re-broadcasting (`stalled`) once
 * enough attempts got a node answer. Attempts that never reached a node give
 * their claim increment back, so an outage cannot advance the cap.
 */
const recordUncertainFailure = async (
  intentId: string,
  leaseToken: string,
  attemptCount: number,
  error: unknown,
): Promise<void> => {
  const message = getErrorMessage(error);
  const nodeAnswered = isNodeAnsweredBroadcastFailure(error);
  if (nodeAnswered && attemptCount >= MAX_RECONCILE_ATTEMPTS) {
    log.warn('Signing intent broadcast stalled after repeated node-answered attempts', {
      intentId,
      attempts: attemptCount,
      error: message,
    });
    await transactionSigningIntentRepository.markBroadcastStalled(intentId, leaseToken, message);
    return;
  }
  await transactionSigningIntentRepository.markBroadcastUnknown(intentId, leaseToken, message, {
    countAttempt: nodeAnswered,
  });
};

const reconcileUncertain = async (record: {
  id: string;
  walletId: string;
  network: string;
  snapshotDigest: string;
  snapshot: Prisma.JsonValue;
  broadcastTxid: string | null;
  broadcastRawTx: string | null;
  broadcastMetadata: Prisma.JsonValue | null;
}, now: Date): Promise<boolean> => {
  const metadata = parseMetadata(record.broadcastMetadata);
  if (!isBitcoinNetwork(record.network) || !record.broadcastTxid || !record.broadcastRawTx || !metadata) {
    return false;
  }
  const leaseToken = randomUUID();
  const claim = await transactionSigningIntentRepository.claimBroadcast({
    id: record.id,
    digest: record.snapshotDigest,
    txid: record.broadcastTxid,
    rawTx: record.broadcastRawTx,
    metadata: toPrismaInputJson(metadata),
    leaseToken,
    now,
    leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
    allowStalled: false,
  });
  if (claim.status !== 'claimed') return claim.status === 'complete';
  try {
    try {
      await getTransactionDetails(record.broadcastTxid, record.network);
      const accepted = await transactionSigningIntentRepository.markBroadcastAccepted(
        record.id,
        leaseToken,
      );
      return accepted ? reconcileAccepted(record) : false;
    } catch (lookupError) {
      // A lookup miss and a temporarily unavailable lookup are both safe to
      // follow with an idempotent submission of the exact same raw transaction.
      log.debug('Accepted transaction lookup missed; retrying the exact durable artifact', {
        intentId: record.id,
        txid: record.broadcastTxid,
        error: getErrorMessage(lookupError),
      });
    }
    const snapshot = SigningIntentSnapshotSchema.safeParse(record.snapshot);
    if (!snapshot.success) return false;
    await broadcastAuthenticatedRawTransaction({
      rawTx: record.broadcastRawTx,
      expectedTxid: record.broadcastTxid,
      network: record.network,
      replacement: typeof snapshot.data.transaction.replacementTxid === 'string',
      allowDefiniteRejection: false,
    });
  } catch (error) {
    // Once an earlier submission may have crossed the node boundary, even a
    // later preflight rejection (for example, "input already spent") is not
    // proof that the exact transaction was rejected. Never roll this state
    // back to ready; retain it for another lookup/reconciliation pass.
    await recordUncertainFailure(record.id, leaseToken, claim.record.broadcastAttemptCount, error);
    return false;
  }
  const accepted = await transactionSigningIntentRepository.markBroadcastAccepted(record.id, leaseToken);
  if (!accepted) return false;
  return reconcileAccepted(record);
};

/**
 * Lookup-only pass for a stalled intent (never re-broadcasts): if its txid is
 * now known to the node, move it to accepted and finish persistence.
 */
const lookupStalledIntent = async (record: {
  id: string;
  walletId: string;
  network: string;
  broadcastTxid: string | null;
  broadcastRawTx: string | null;
  broadcastMetadata: Prisma.JsonValue | null;
}, now: Date): Promise<boolean> => {
  if (!isBitcoinNetwork(record.network) || !record.broadcastTxid) return false;
  if (!await transactionSigningIntentRepository.claimStalledBroadcastLookup(record.id, now)) return false;
  try {
    await getTransactionDetails(record.broadcastTxid, record.network);
  } catch (lookupError) {
    log.debug('Stalled transaction lookup missed; leaving the intent stalled', {
      intentId: record.id,
      txid: record.broadcastTxid,
      error: getErrorMessage(lookupError),
    });
    return false;
  }
  const accepted = await transactionSigningIntentRepository.markStalledBroadcastAccepted(
    record.id,
    record.broadcastTxid,
    now,
  );
  return accepted ? reconcileAccepted(record) : false;
};

const lookupStalledIntentIsolated = async (
  record: Parameters<typeof lookupStalledIntent>[0],
  now: Date,
): Promise<void> => {
  try {
    await lookupStalledIntent(record, now);
  } catch (error) {
    log.error('Stalled signing intent lookup failed', {
      intentId: record.id,
      txid: record.broadcastTxid,
      error: getErrorMessage(error),
    });
    return;
  }
};

export const reconcileSigningIntentBroadcasts = async (
  now = new Date(),
  limit = 50,
): Promise<{ examined: number; completed: number }> => {
  const records = await transactionSigningIntentRepository.listBroadcastsForReconciliation(now, limit);
  let completed = 0;
  for (const record of records) {
    try {
      const done = record.broadcastState === 'accepted'
        ? await reconcileAccepted(record)
        : await reconcileUncertain(record, now);
      if (done) completed += 1;
    } catch (error) {
      log.error('Signing intent broadcast reconciliation failed', {
        intentId: record.id,
        txid: record.broadcastTxid,
        error: getErrorMessage(error),
      });
      // An accepted row that keeps failing goes to the back of the next batch
      // (a no-op for any other state); a failed deferral only skips that.
      await transactionSigningIntentRepository.deferAcceptedReconciliation(record.id, now)
        .catch((deferError: unknown) => log.warn('Could not defer failed signing intent reconciliation', {
          intentId: record.id,
          error: getErrorMessage(deferError),
        }));
    }
  }
  const stalled = await transactionSigningIntentRepository.listStalledBroadcastsForLookup(now, limit);
  for (const record of stalled) {
    await lookupStalledIntentIsolated(record, now);
  }
  return { examined: records.length, completed };
};
