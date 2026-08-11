import { randomUUID } from 'node:crypto';
import { Prisma } from '../../../generated/prisma/client';
import { transactionSigningIntentRepository } from '../../../repositories/transactionSigningIntentRepository';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { broadcastAuthenticatedRawTransaction, getTransactionDetails } from '../blockchain';
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
    });
  } catch (error) {
    // Once an earlier submission may have crossed the node boundary, even a
    // later preflight rejection (for example, "input already spent") is not
    // proof that the exact transaction was rejected. Never roll this state
    // back to ready; retain it for another lookup/reconciliation pass.
    await transactionSigningIntentRepository.markBroadcastUnknown(
      record.id,
      leaseToken,
      getErrorMessage(error),
    );
    return false;
  }
  const accepted = await transactionSigningIntentRepository.markBroadcastAccepted(record.id, leaseToken);
  if (!accepted) return false;
  return reconcileAccepted(record);
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
    }
  }
  return { examined: records.length, completed };
};
