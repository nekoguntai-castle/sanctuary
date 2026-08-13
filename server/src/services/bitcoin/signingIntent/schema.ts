import { z } from 'zod';
import { BITCOIN_NETWORKS } from '@sanctuary/shared/constants/bitcoin';
import {
  LEGACY_SIGNING_INTENT_SNAPSHOT_VERSION,
  SIGNING_INTENT_MAX_FEE_RATE,
  SIGNING_INTENT_MIN_FEE_RATE,
  SIGNING_INTENT_SNAPSHOT_VERSION,
} from './types';

const SatsSchema = z.string().regex(/^(0|[1-9]\d*)$/);
const ScriptSchema = z.string().regex(/^(?:[0-9a-f]{2})*$/);

const TransactionSnapshotSchema = z.object({
  version: z.number().int(),
  locktime: z.number().int().min(0).max(0xffffffff),
  replacementTxid: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  inputs: z.array(z.object({
    txid: z.string().regex(/^[0-9a-f]{64}$/),
    vout: z.number().int().min(0).max(0xffffffff),
    sequence: z.number().int().min(0).max(0xffffffff),
    prevout: z.object({
      amountSats: SatsSchema,
      scriptPubKeyHex: ScriptSchema,
      role: z.enum(['wallet', 'payjoin_peer']),
    }).strict(),
  }).strict()).min(1),
  outputs: z.array(z.object({
    amountSats: SatsSchema,
    scriptPubKeyHex: ScriptSchema,
  }).strict()).min(1),
}).strict();

export const SigningIntentFeePolicySchema = z.object({
  version: z.literal(1),
  expectedFeeSats: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  requestedFeeRateSatsPerVbyte: z.number().finite()
    .min(SIGNING_INTENT_MIN_FEE_RATE)
    .max(SIGNING_INTENT_MAX_FEE_RATE),
  roundingMode: z.literal('ceil'),
  roundingToleranceSats: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).strict();

const SigningIntentSnapshotV1Schema = z.object({
  version: z.literal(LEGACY_SIGNING_INTENT_SNAPSHOT_VERSION),
  walletId: z.string().min(1),
  network: z.enum(BITCOIN_NETWORKS),
  transaction: TransactionSnapshotSchema,
}).strict();

const SigningIntentSnapshotV2Schema = z.object({
  version: z.literal(SIGNING_INTENT_SNAPSHOT_VERSION),
  walletId: z.string().min(1),
  network: z.enum(BITCOIN_NETWORKS),
  feePolicy: SigningIntentFeePolicySchema,
  transaction: TransactionSnapshotSchema,
}).strict();

export const SigningIntentSnapshotSchema = z.discriminatedUnion('version', [
  SigningIntentSnapshotV1Schema,
  SigningIntentSnapshotV2Schema,
]);
