import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConflictError, InvalidInputError } from '../../../errors/ApiError';
import {
  transactionSigningIntentRepository,
  type BroadcastPriorState,
} from '../../../repositories/transactionSigningIntentRepository';
import type { ValidatedBroadcastArtifact } from './artifactValidation';
import { toPrismaInputJson } from './json';

const BROADCAST_LEASE_MS = 60_000;

const SafeSatsSchema = z.number().int().nonnegative().safe();
const DecimalSatsSchema = z.string().regex(/^(0|[1-9]\d*)$/);

/** Sanity bound only: 3 usage windows per policy x 1024 policies, far above any real (unbounded) policy set. */
const MAX_POLICY_RESERVATIONS = 3072;
const OutpointSchema = z.object({
  txid: z.string().regex(/^[0-9a-f]{64}$/),
  vout: z.number().int().nonnegative().max(0xffffffff),
}).strict();

export const DurableBroadcastMetadataSchema = z.object({
  recipient: z.string().min(1),
  amount: SafeSatsSchema,
  fee: SafeSatsSchema,
  label: z.string().optional(),
  memo: z.string().optional(),
  // Structural RBF replacement linkage (rbf-memo-prefix-spoofs-transaction-replacement).
  // Must round-trip through the durable claim record: broadcastReconciliation.ts
  // re-persists an accepted broadcast from this exact metadata after a crash
  // between network acceptance and persistence, so if this field were missing
  // here the reconciliation path would silently drop the RBF link.
  replacesTxid: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  utxos: z.array(OutpointSchema).min(1),
  draftId: z.string().min(1).optional(),
  inputs: z.array(OutpointSchema.extend({
    address: z.string().min(1),
    amount: SafeSatsSchema,
    derivationPath: z.string().min(1).optional(),
  }).strict()).optional(),
  outputs: z.array(z.object({
    address: z.string().min(1),
    amount: SafeSatsSchema,
    outputType: z.enum(['recipient', 'change', 'decoy', 'consolidation', 'unknown']),
    isOurs: z.boolean(),
    scriptPubKey: z.string().regex(/^(?:[0-9a-f]{2})+$/).optional(),
  }).strict()).optional(),
  // Policy usage reserved for this intent's broadcast. Usage windows are
  // aggregate rows, so the intent is the only place a reservation can be tied
  // to its transaction: a retry of an unknown-outcome attempt reuses these
  // instead of reserving again (broadcast-retry--policy-usage-double-reserved).
  policyReservations: z.array(z.object({
    windowId: z.string().min(1),
    amount: DecimalSatsSchema,
  }).strict()).max(MAX_POLICY_RESERVATIONS).optional(),
}).strict();

export type DurableBroadcastMetadata = z.infer<typeof DurableBroadcastMetadataSchema>;

export type BroadcastClaim =
  | { status: 'claimed'; leaseToken: string; priorState: BroadcastPriorState }
  | { status: 'accepted' }
  | { status: 'complete' };

export interface BroadcastClaimOptions {
  /** Resume only an `unknown` or expired-`claimed` intent; never take a fresh `ready` claim. */
  resumeOnly?: boolean;
}

export const claimSigningIntentBroadcast = async (
  artifact: ValidatedBroadcastArtifact,
  metadata: DurableBroadcastMetadata,
  now = new Date(),
  options: BroadcastClaimOptions = {},
): Promise<BroadcastClaim> => {
  const parsedMetadata = DurableBroadcastMetadataSchema.safeParse(metadata);
  if (!parsedMetadata.success) {
    throw new InvalidInputError('Broadcast metadata is malformed', 'metadata', {
      reason: 'metadata_mismatch',
    });
  }
  const leaseToken = randomUUID();
  const result = await transactionSigningIntentRepository.claimBroadcast({
    id: artifact.intent.intentId,
    digest: artifact.intent.intentDigest,
    txid: artifact.txid,
    rawTx: artifact.rawTx,
    metadata: toPrismaInputJson(parsedMetadata.data),
    leaseToken,
    now,
    leaseExpiresAt: new Date(now.getTime() + BROADCAST_LEASE_MS),
    allowStalled: true,
    resumeOnly: options.resumeOnly === true,
    keepHeldReservations: options.resumeOnly !== true,
  });
  if (result.status === 'claimed') return { status: 'claimed', leaseToken, priorState: result.priorState };
  if (result.status === 'accepted') return { status: 'accepted' };
  if (result.status === 'complete') return { status: 'complete' };
  if (result.status === 'busy') {
    throw new ConflictError('Signing intent broadcast is already in progress', undefined, {
      reason: 'duplicate_submission',
    });
  }
  throw new InvalidInputError('Signing intent does not match the broadcast artifact', 'intentId', {
    reason: 'metadata_mismatch',
  });
};

/** A policy usage reservation as the broadcast route holds it. */
export interface HeldPolicyReservation {
  windowId: string;
  amount: bigint;
}

/**
 * The policy usage still held by an earlier attempt to broadcast `txid` from
 * this intent, or null when nothing reusable is held: the intent must be
 * `unknown`, or `claimed` with an expired lease (a live claim belongs to an
 * in-flight attempt), its broadcast txid must match, and its metadata must
 * carry reservations (intents claimed before they were persisted fall back
 * to a fresh reservation — over-counting, the safe direction).
 */
export const findHeldPolicyReservations = async (
  intentId: string,
  txid: string,
  now = new Date(),
): Promise<HeldPolicyReservation[] | null> => {
  const record = await transactionSigningIntentRepository.findById(intentId);
  if (!record || record.broadcastTxid !== txid) return null;
  const leaseExpired = record.broadcastLeaseExpiresAt !== null
    && record.broadcastLeaseExpiresAt.getTime() <= now.getTime();
  if (record.broadcastState !== 'unknown' && !(record.broadcastState === 'claimed' && leaseExpired)) return null;
  const parsed = DurableBroadcastMetadataSchema.safeParse(record.broadcastMetadata);
  if (!parsed.success || !parsed.data.policyReservations) return null;
  return parsed.data.policyReservations.map(({ windowId, amount }) => ({ windowId, amount: BigInt(amount) }));
};

export const markSigningIntentBroadcastUnknown = (
  intentId: string,
  leaseToken: string,
  error: string,
  options?: { countAttempt?: boolean },
) => transactionSigningIntentRepository.markBroadcastUnknown(intentId, leaseToken, error, options);

export const markSigningIntentBroadcastStalled = (
  intentId: string,
  leaseToken: string,
  error: string,
) => transactionSigningIntentRepository.markBroadcastStalled(intentId, leaseToken, error);

export const releaseRejectedSigningIntentBroadcast = (
  intentId: string,
  leaseToken: string,
  error: string,
) => transactionSigningIntentRepository.releaseRejectedBroadcast(intentId, leaseToken, error);

export const markSigningIntentBroadcastAccepted = (
  intentId: string,
  leaseToken: string,
) => transactionSigningIntentRepository.markBroadcastAccepted(intentId, leaseToken);

export const markSigningIntentBroadcastComplete = (intentId: string, txid: string) =>
  transactionSigningIntentRepository.markBroadcastComplete(intentId, txid);
