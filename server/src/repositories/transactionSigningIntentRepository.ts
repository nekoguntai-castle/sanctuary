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

/** Error messages `create` and `restorePayjoinOriginal` throw to roll their transaction back. */
export const SIGNING_INTENT_SUPERSESSION_CONFLICT = 'SIGNING_INTENT_SUPERSESSION_CONFLICT';
export const SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND = 'SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND';
export const PAYJOIN_ORIGINAL_RESTORE_CONFLICT = 'PAYJOIN_ORIGINAL_RESTORE_CONFLICT';

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
      throw new Error(SIGNING_INTENT_SUPERSESSION_CONFLICT);
    }
    // C-D9: a draft-bound intent is never superseded. Callers check first. Draft
    // creation row-locks the same intent (lockDraftableIntent) in the
    // transaction that inserts the draft, so the update above waits for a
    // draft transaction that locked first, and this re-read (a fresh READ
    // COMMITTED snapshot) then sees its committed draft and rolls back. A
    // draft transaction that locks second finds supersededById set and aborts.
    const boundDraft = await tx.draftTransaction.findFirst({
      where: { walletId: data.walletId, signingIntentId: data.supersedesIntentId },
      select: { id: true },
    });
    if (boundDraft) throw new Error(SIGNING_INTENT_SUPERSESSION_DRAFT_BOUND);
  }
  return created;
});

export const findById = (id: string): Promise<TransactionSigningIntent | null> =>
  prisma.transactionSigningIntent.findUnique({ where: { id } });

/** The payjoin replacement whose supersession link points at an intent, if any. */
export const findPayjoinReplacementFor = (walletId: string, intentId: string) =>
  prisma.transactionSigningIntent.findFirst({
    where: { walletId, supersededById: intentId, source: 'payjoin' },
    select: { id: true },
  });

/** The transaction client lockDraftableIntent locks through (the draft insert's own). */
export type SigningIntentDraftLockDbClient = Pick<typeof prisma, 'transactionSigningIntent'>;

/** An intent nobody has claimed for broadcast or consumed yet. */
const BROADCAST_NOT_STARTED = { consumedAt: null, broadcastState: 'ready' } as const;

/**
 * Row-lock an intent a draft is about to bind, inside the transaction that
 * inserts the draft. Matches only a current (not superseded), non-payjoin
 * intent of the wallet whose broadcast has not started; the self-assignment of
 * supersededById is a no-op write that takes the row lock `create` takes when
 * it supersedes the intent and claimBroadcast takes when it claims it, so the
 * writers serialize (C-D9). A claim that committed first leaves the intent
 * non-`ready`, so no draft binds a broadcast in flight; a draft that committed
 * first is archived by the accepted broadcast's persistence, which looks drafts
 * up by intent. Returns false when nothing matched.
 */
export const lockDraftableIntent = async (
  intentId: string,
  walletId: string,
  client: SigningIntentDraftLockDbClient,
): Promise<boolean> => {
  const locked = await client.transactionSigningIntent.updateMany({
    where: {
      id: intentId,
      walletId,
      supersededById: null,
      source: { not: 'payjoin' },
      ...BROADCAST_NOT_STARTED,
    },
    data: { supersededById: null },
  });
  return locked.count === 1;
};

/** Whether a current intent's broadcast is claimed, uncertain, accepted or complete (why a draft lock failed). */
export const hasStartedBroadcast = async (
  intentId: string,
  walletId: string,
  client: SigningIntentDraftLockDbClient,
): Promise<boolean> => {
  const started = await client.transactionSigningIntent.findFirst({
    where: {
      id: intentId,
      walletId,
      supersededById: null,
      NOT: BROADCAST_NOT_STARTED,
    },
    select: { id: true },
  });
  return started !== null;
};

export type PayjoinOriginalRestoreResult =
  | 'restored'
  | 'not_superseded'
  | 'in_flight'
  | 'not_found'
  | 'not_payjoin';

/**
 * Make a signed original broadcastable again by parking its payjoin
 * replacement behind it (the replacement's supersededById points back at the
 * original). The replacement must still be an untouched `ready` row: a claimed,
 * unknown, accepted or consumed proposal is `in_flight`. claimBroadcast and the
 * park both condition on the replacement's `supersededById: null` and `ready`
 * state, so at most one of {proposal broadcast, original restoration} wins.
 */
export const restorePayjoinOriginal = async (
  originalId: string,
  walletId: string,
  digest: string,
): Promise<PayjoinOriginalRestoreResult> => prisma.$transaction(async tx => {
  const original = await tx.transactionSigningIntent.findFirst({
    where: { id: originalId, walletId, snapshotDigest: digest, consumedAt: null },
    select: { supersededById: true },
  });
  if (!original) return 'not_found';
  const replacementId = original.supersededById;
  if (!replacementId) return 'not_superseded';
  const replacement = await tx.transactionSigningIntent.findUnique({
    where: { id: replacementId },
    select: { source: true, walletId: true },
  });
  if (!replacement || replacement.source !== 'payjoin' || replacement.walletId !== walletId) return 'not_payjoin';
  const parked = await tx.transactionSigningIntent.updateMany({
    where: {
      id: replacementId,
      walletId,
      source: 'payjoin',
      supersededById: null,
      consumedAt: null,
      broadcastState: 'ready',
      broadcastTxid: null,
    },
    data: { supersededById: originalId },
  });
  if (parked.count !== 1) {
    // A concurrent release that already parked the replacement is not a conflict.
    const current = await tx.transactionSigningIntent.findUnique({
      where: { id: replacementId },
      select: { supersededById: true },
    });
    return current?.supersededById === originalId ? 'not_superseded' : 'in_flight';
  }
  const restored = await tx.transactionSigningIntent.updateMany({
    where: { id: originalId, supersededById: replacementId, consumedAt: null },
    data: { supersededById: null },
  });
  if (restored.count !== 1) throw new Error(PAYJOIN_ORIGINAL_RESTORE_CONFLICT);
  return 'restored';
});

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

/**
 * A no-external-output attempt (consolidation, CPFP child) persists
 * `policyReservations: []`: nothing is held, so nothing can be overwritten and
 * the attempt may be resumed like a legacy one.
 */
const holdsPolicyReservations = (metadata: Prisma.JsonValue | null | undefined): boolean =>
  typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
  && Array.isArray(metadata.policyReservations) && metadata.policyReservations.length > 0;

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

/**
 * Move an accepted intent whose persistence failed to the back of the
 * reconciliation order, so rows that keep failing cannot starve the batch.
 */
export const deferAcceptedReconciliation = (id: string, now: Date) =>
  prisma.transactionSigningIntent.updateMany({
    where: { id, broadcastState: 'accepted' },
    data: { broadcastLastAttemptAt: now },
  });

export const transactionSigningIntentRepository = {
  create,
  findById,
  findPayjoinReplacementFor,
  lockDraftableIntent,
  hasStartedBroadcast,
  restorePayjoinOriginal,
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
  deferAcceptedReconciliation,
};

export default transactionSigningIntentRepository;
