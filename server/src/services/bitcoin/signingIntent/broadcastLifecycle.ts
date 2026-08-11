import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ConflictError, InvalidInputError } from '../../../errors/ApiError';
import { transactionSigningIntentRepository } from '../../../repositories/transactionSigningIntentRepository';
import type { ValidatedBroadcastArtifact } from './artifactValidation';
import { toPrismaInputJson } from './json';

const BROADCAST_LEASE_MS = 60_000;

const SafeSatsSchema = z.number().int().nonnegative().safe();
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
}).strict();

export type DurableBroadcastMetadata = z.infer<typeof DurableBroadcastMetadataSchema>;

export type BroadcastClaim =
  | { status: 'claimed'; leaseToken: string }
  | { status: 'accepted' }
  | { status: 'complete' };

export const claimSigningIntentBroadcast = async (
  artifact: ValidatedBroadcastArtifact,
  metadata: DurableBroadcastMetadata,
  now = new Date(),
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
  });
  if (result.status === 'claimed') return { status: 'claimed', leaseToken };
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

export const markSigningIntentBroadcastUnknown = (
  intentId: string,
  leaseToken: string,
  error: string,
) => transactionSigningIntentRepository.markBroadcastUnknown(intentId, leaseToken, error);

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
