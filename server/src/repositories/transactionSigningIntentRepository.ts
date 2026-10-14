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

/**
 * Node-answered re-broadcast attempts after which an intent is `stalled`.
 *
 * `stalled` is derived, not stored: `transaction_signing_intents_broadcast_state_check`
 * (migration 20260810180000) admits only ready/claimed/unknown/accepted/complete and
 * the migration set is frozen, so a stalled intent is an `unknown` one whose
 * `broadcastAttemptCount` has reached this cap. Attempts that never got a node
 * answer give their increment back, so only node-answered attempts count.
 */
export const MAX_RECONCILE_ATTEMPTS = 60;

export interface BroadcastClaimInput {
  id: string;
  digest: string;
  txid: string;
  rawTx: string;
  metadata: Prisma.InputJsonValue;
  leaseToken: string;
  now: Date;
  leaseExpiresAt: Date;
  /** User broadcasts may resume a `stalled` intent; the reconciler must not (default false). */
  allowStalled?: boolean;
  /**
   * Skip the `ready` step: only an `unknown` or expired-`claimed` attempt may be
   * resumed. A retry that reuses reservations held by an earlier attempt must not
   * start a fresh broadcast if that attempt was released back to `ready`.
   */
  resumeOnly?: boolean;
  /**
   * Never resume an attempt whose metadata already holds policy reservations:
   * this claim would overwrite them with its own, leaving the earlier ones
   * counted forever. Such an attempt is reported `busy`; the caller's retry
   * reuses its reservations under `resumeOnly`.
   */
  keepHeldReservations?: boolean;
}

/** Which state a successful claim came from; only a first (`ready`) claim may be rolled back. */
export type BroadcastPriorState = 'ready' | 'resumed' | 'stalled';

export type BroadcastClaimResult =
  | { status: 'claimed'; record: TransactionSigningIntent; priorState: BroadcastPriorState }
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

const claimStateConditions = (
  input: BroadcastClaimInput,
): Array<[BroadcastPriorState, Prisma.TransactionSigningIntentWhereInput]> => {
  const sameArtifact = { broadcastTxid: input.txid, broadcastRawTx: input.rawTx };
  const steps: Array<[BroadcastPriorState, Prisma.TransactionSigningIntentWhereInput]> = [];
  if (!input.resumeOnly) steps.push(['ready', { broadcastState: 'ready' }]);
  steps.push(['resumed', {
    OR: [
      {
        broadcastState: 'claimed',
        ...sameArtifact,
        broadcastLeaseExpiresAt: { lte: input.now },
      },
      { broadcastState: 'unknown', ...sameArtifact, broadcastAttemptCount: { lt: MAX_RECONCILE_ATTEMPTS } },
    ],
  }]);
  if (input.allowStalled) {
    steps.push(['stalled', {
      broadcastState: 'unknown', ...sameArtifact, broadcastAttemptCount: { gte: MAX_RECONCILE_ATTEMPTS },
    }]);
  }
  return steps;
};

const holdsPolicyReservations = (metadata: Prisma.JsonValue | null | undefined): boolean =>
  typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
  && Array.isArray(metadata.policyReservations);

/**
 * Claim steps for a `keepHeldReservations` claim: an attempt holding
 * reservations may only be claimed from `ready`, and any other resume is a
 * compare-and-swap on the metadata just inspected, so reservations persisted
 * by a concurrent claim in between are never overwritten.
 */
const guardHeldReservations = async (
  tx: Pick<typeof prisma, 'transactionSigningIntent'>,
  input: BroadcastClaimInput,
  steps: Array<[BroadcastPriorState, Prisma.TransactionSigningIntentWhereInput]>,
): Promise<Array<[BroadcastPriorState, Prisma.TransactionSigningIntentWhereInput]>> => {
  if (!input.keepHeldReservations) return steps;
  const current = await tx.transactionSigningIntent.findUnique({
    where: { id: input.id },
    select: { broadcastMetadata: true },
  });
  const stored = current?.broadcastMetadata ?? null;
  if (holdsPolicyReservations(stored)) return steps.filter(([priorState]) => priorState === 'ready');
  const broadcastMetadata = stored === null
    ? { equals: Prisma.AnyNull }
    : { equals: stored as Prisma.InputJsonValue };
  return steps.map(([priorState, condition]) => (
    priorState === 'ready' ? [priorState, condition] : [priorState, { ...condition, broadcastMetadata }]
  ));
};

export const claimBroadcast = async (input: BroadcastClaimInput): Promise<BroadcastClaimResult> =>
  prisma.$transaction(async tx => {
    const data = {
      broadcastState: 'claimed',
      broadcastTxid: input.txid,
      broadcastRawTx: input.rawTx,
      broadcastMetadata: input.metadata,
      broadcastLeaseToken: input.leaseToken,
      broadcastLeaseExpiresAt: input.leaseExpiresAt,
      broadcastAttemptCount: { increment: 1 },
      broadcastLastAttemptAt: input.now,
      broadcastLastError: null,
    };
    for (const [priorState, condition] of await guardHeldReservations(tx, input, claimStateConditions(input))) {
      const updated = await tx.transactionSigningIntent.updateMany({
        where: {
          id: input.id,
          snapshotDigest: input.digest,
          supersededById: null,
          consumedAt: null,
          ...condition,
        },
        data,
      });
      if (updated.count === 1) {
        return {
          status: 'claimed',
          priorState,
          record: await tx.transactionSigningIntent.findUniqueOrThrow({ where: { id: input.id } }),
        };
      }
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
  extraWhere: Prisma.TransactionSigningIntentWhereInput = {},
): Promise<boolean> => {
  const result = await prisma.transactionSigningIntent.updateMany({
    where: { id, broadcastState: 'claimed', broadcastLeaseToken: leaseToken, ...extraWhere },
    data,
  });
  return result.count === 1;
};

export const markBroadcastUnknown = (
  id: string,
  leaseToken: string,
  error: string,
  options: { countAttempt?: boolean } = {},
): Promise<boolean> => transitionClaim(id, leaseToken, {
  broadcastState: 'unknown',
  broadcastLeaseToken: null,
  broadcastLeaseExpiresAt: null,
  broadcastLastError: error,
  // Give back the claim's increment when the node never answered, so an outage cannot advance the cap.
  ...(options.countAttempt === false ? { broadcastAttemptCount: { decrement: 1 } } : {}),
});

/**
 * Stop rebroadcasting: an `unknown` intent at the attempt cap (see
 * MAX_RECONCILE_ATTEMPTS). Raw transaction and txid are kept for lookups and a
 * user-initiated retry. The cap guard keeps "stalled" well defined: below it the
 * transition is refused and the lease simply expires.
 */
export const markBroadcastStalled = (
  id: string,
  leaseToken: string,
  error: string,
): Promise<boolean> => transitionClaim(id, leaseToken, {
  broadcastState: 'unknown',
  broadcastLeaseToken: null,
  broadcastLeaseExpiresAt: null,
  broadcastLastError: error,
}, { broadcastAttemptCount: { gte: MAX_RECONCILE_ATTEMPTS } });

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

const STALLED_LOOKUP_INTERVAL_MS = 60 * 60 * 1000;

const stalledLookupCutoff = (now: Date): Date => new Date(now.getTime() - STALLED_LOOKUP_INTERVAL_MS);

const stalledWhere = { broadcastState: 'unknown', broadcastAttemptCount: { gte: MAX_RECONCILE_ATTEMPTS } } as const;

/** Stalled intents whose last attempt/lookup is at least an hour old. */
export const listStalledBroadcastsForLookup = (now: Date, limit = 50) =>
  prisma.transactionSigningIntent.findMany({
    where: {
      ...stalledWhere,
      broadcastRawTx: { not: null },
      broadcastMetadata: { not: Prisma.DbNull },
      broadcastLastAttemptAt: { lte: stalledLookupCutoff(now) },
    },
    orderBy: [{ broadcastLastAttemptAt: 'asc' }, { id: 'asc' }],
    take: limit,
  });

/** Record a lookup on a stalled intent; false when another worker already did within the interval. */
export const claimStalledBroadcastLookup = async (id: string, now: Date): Promise<boolean> => {
  const result = await prisma.transactionSigningIntent.updateMany({
    where: { id, ...stalledWhere, broadcastLastAttemptAt: { lte: stalledLookupCutoff(now) } },
    data: { broadcastLastAttemptAt: now },
  });
  return result.count === 1;
};

/** Lease-free stalled -> accepted transition (same fields as markBroadcastAccepted). */
export const markStalledBroadcastAccepted = async (
  id: string,
  txid: string,
  now = new Date(),
): Promise<boolean> => {
  const result = await prisma.transactionSigningIntent.updateMany({
    where: { id, ...stalledWhere, broadcastTxid: txid },
    data: {
      broadcastState: 'accepted',
      broadcastLeaseToken: null,
      broadcastLeaseExpiresAt: null,
      broadcastAcceptedAt: now,
      consumedAt: now,
      broadcastLastError: null,
    },
  });
  return result.count === 1;
};

export const listBroadcastsForReconciliation = (now: Date, limit = 50) =>
  prisma.transactionSigningIntent.findMany({
    where: {
      broadcastRawTx: { not: null },
      broadcastMetadata: { not: Prisma.DbNull },
      OR: [
        { broadcastState: 'unknown', broadcastAttemptCount: { lt: MAX_RECONCILE_ATTEMPTS } },
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
  markBroadcastStalled,
  releaseRejectedBroadcast,
  markBroadcastAccepted,
  markBroadcastComplete,
  listBroadcastsForReconciliation,
  listStalledBroadcastsForLookup,
  claimStalledBroadcastLookup,
  markStalledBroadcastAccepted,
};

export default transactionSigningIntentRepository;
