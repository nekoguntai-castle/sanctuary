import { Prisma } from '../generated/prisma/client';
import type { TransactionSigningIntent } from '../generated/prisma/client';
import prisma from '../models/prisma';

export interface CreateTransactionSigningIntentRecord {
  walletId: string;
  createdByUserId: string;
  network: string;
  source: string;
  snapshotVersion: number;
  snapshot: Prisma.InputJsonValue;
  signingContext?: Prisma.InputJsonValue;
  snapshotDigest: string;
  unsignedPsbtBase64: string;
  unsignedPsbtSha256: string;
  expiresAt: Date;
  supersedesIntentId?: string;
}

export interface BroadcastClaimInput {
  id: string;
  digest: string;
  txid: string;
  rawTx: string;
  metadata: Prisma.InputJsonValue;
  leaseToken: string;
  now: Date;
  leaseExpiresAt: Date;
}

export type BroadcastClaimResult =
  | { status: 'claimed'; record: TransactionSigningIntent }
  | { status: 'accepted' | 'complete' | 'busy' | 'conflict' };

export const create = async (
  data: CreateTransactionSigningIntentRecord,
): Promise<TransactionSigningIntent> => prisma.$transaction(async tx => {
  const created = await tx.transactionSigningIntent.create({
    data: {
      walletId: data.walletId,
      createdByUserId: data.createdByUserId,
      network: data.network,
      source: data.source,
      snapshotVersion: data.snapshotVersion,
      snapshot: data.snapshot,
      signingContext: data.signingContext ?? Prisma.DbNull,
      snapshotDigest: data.snapshotDigest,
      unsignedPsbtBase64: data.unsignedPsbtBase64,
      unsignedPsbtSha256: data.unsignedPsbtSha256,
      expiresAt: data.expiresAt,
    },
  });

  if (data.supersedesIntentId) {
    const update = await tx.transactionSigningIntent.updateMany({
      where: {
        id: data.supersedesIntentId,
        walletId: data.walletId,
        supersededById: null,
        consumedAt: null,
        broadcastState: 'ready',
      },
      data: { supersededById: created.id },
    });
    if (update.count !== 1) {
      throw new Error('SIGNING_INTENT_SUPERSESSION_CONFLICT');
    }
  }
  return created;
});

export const findById = (id: string): Promise<TransactionSigningIntent | null> =>
  prisma.transactionSigningIntent.findUnique({ where: { id } });

export const claimBroadcast = async (input: BroadcastClaimInput): Promise<BroadcastClaimResult> =>
  prisma.$transaction(async tx => {
    const updated = await tx.transactionSigningIntent.updateMany({
      where: {
        id: input.id,
        snapshotDigest: input.digest,
        supersededById: null,
        consumedAt: null,
        OR: [
          { broadcastState: 'ready' },
          {
            broadcastState: 'claimed',
            broadcastTxid: input.txid,
            broadcastRawTx: input.rawTx,
            broadcastLeaseExpiresAt: { lte: input.now },
          },
          {
            broadcastState: 'unknown',
            broadcastTxid: input.txid,
            broadcastRawTx: input.rawTx,
          },
        ],
      },
      data: {
        broadcastState: 'claimed',
        broadcastTxid: input.txid,
        broadcastRawTx: input.rawTx,
        broadcastMetadata: input.metadata,
        broadcastLeaseToken: input.leaseToken,
        broadcastLeaseExpiresAt: input.leaseExpiresAt,
        broadcastAttemptCount: { increment: 1 },
        broadcastLastAttemptAt: input.now,
        broadcastLastError: null,
      },
    });
    if (updated.count === 1) {
      return {
        status: 'claimed',
        record: await tx.transactionSigningIntent.findUniqueOrThrow({ where: { id: input.id } }),
      };
    }
    const current = await tx.transactionSigningIntent.findUnique({ where: { id: input.id } });
    if (!current
      || current.snapshotDigest !== input.digest
      || current.broadcastTxid !== input.txid
      || (current.broadcastRawTx !== null && current.broadcastRawTx !== input.rawTx)) {
      return { status: 'conflict' };
    }
    if (current.broadcastState === 'complete') return { status: 'complete' };
    if (current.broadcastState === 'accepted' || current.consumedAt) return { status: 'accepted' };
    return { status: 'busy' };
  });

const transitionClaim = async (
  id: string,
  leaseToken: string,
  data: Prisma.TransactionSigningIntentUpdateManyMutationInput,
): Promise<boolean> => {
  const result = await prisma.transactionSigningIntent.updateMany({
    where: { id, broadcastState: 'claimed', broadcastLeaseToken: leaseToken },
    data,
  });
  return result.count === 1;
};

export const markBroadcastUnknown = (
  id: string,
  leaseToken: string,
  error: string,
): Promise<boolean> => transitionClaim(id, leaseToken, {
  broadcastState: 'unknown',
  broadcastLeaseToken: null,
  broadcastLeaseExpiresAt: null,
  broadcastLastError: error,
});

export const releaseRejectedBroadcast = (
  id: string,
  leaseToken: string,
  error: string,
): Promise<boolean> => transitionClaim(id, leaseToken, {
  broadcastState: 'ready',
  broadcastTxid: null,
  broadcastRawTx: null,
  broadcastMetadata: Prisma.DbNull,
  broadcastLeaseToken: null,
  broadcastLeaseExpiresAt: null,
  broadcastLastError: error,
});

export const markBroadcastAccepted = (
  id: string,
  leaseToken: string,
  now = new Date(),
): Promise<boolean> => transitionClaim(id, leaseToken, {
  broadcastState: 'accepted',
  broadcastLeaseToken: null,
  broadcastLeaseExpiresAt: null,
  broadcastAcceptedAt: now,
  consumedAt: now,
  broadcastLastError: null,
});

export const markBroadcastComplete = async (id: string, txid: string): Promise<boolean> => {
  const result = await prisma.transactionSigningIntent.updateMany({
    where: { id, broadcastTxid: txid, broadcastState: 'accepted' },
    data: { broadcastState: 'complete', broadcastCompletedAt: new Date() },
  });
  return result.count === 1;
};

export const listBroadcastsForReconciliation = (now: Date, limit = 50) =>
  prisma.transactionSigningIntent.findMany({
    where: {
      broadcastRawTx: { not: null },
      broadcastMetadata: { not: Prisma.DbNull },
      OR: [
        { broadcastState: 'unknown' },
        { broadcastState: 'accepted' },
        { broadcastState: 'claimed', broadcastLeaseExpiresAt: { lte: now } },
      ],
    },
    orderBy: [{ broadcastLastAttemptAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });

export const transactionSigningIntentRepository = {
  create,
  findById,
  claimBroadcast,
  markBroadcastUnknown,
  releaseRejectedBroadcast,
  markBroadcastAccepted,
  markBroadcastComplete,
  listBroadcastsForReconciliation,
};

export default transactionSigningIntentRepository;
