import { z } from 'zod';
import { PsbtSigningContextSchema } from './psbtSigningContext';

/**
 * Runtime shapes for the responses a user signs against.
 *
 * These are the highest-consequence bodies in the app. Everything in a created
 * transaction and everything in a draft is shown on a review screen and then
 * approved — so a coerced number here is not a cosmetic error, it is a signing
 * decision made against a figure nobody sent.
 *
 * Partial and `looseObject`, for the reason spelled out in `walletResponses`:
 * under zod's default, a partial schema deletes every field it does not
 * declare. Drafts carry twenty-odd fields and losing one silently would be far
 * worse than the corruption this guards against.
 *
 * Shape, not range — `.finite()` rejects the null/NaN/Infinity that arithmetic
 * turns into 0, while whether a figure is sensible stays with the code using it.
 */

const satoshis = z.number().finite();
const positiveSafeSatoshis = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const batchOutputs = z.array(z.looseObject({
  address: z.string().min(1),
  amount: positiveSafeSatoshis,
  sendMax: z.boolean().optional(),
})).min(1).refine(
  outputs => outputs.reduce((sum, output) => sum + BigInt(output.amount), 0n) <= BigInt(Number.MAX_SAFE_INTEGER),
  { message: 'batch output total must be a safe integer' },
);

/**
 * Not a range check: a PSBT is the thing being signed, and an empty string is
 * not a PSBT. Letting `""` through would put an unsignable payload in front of
 * a user who has been told it is their transaction.
 */
const psbt = z.string().min(1);
const signingIntent = {
  intentId: z.string().min(1),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/),
};

export const CreateTransactionResponseSchema = z.looseObject({
  psbtBase64: psbt,
  signingContext: PsbtSigningContextSchema,
  ...signingIntent,
  // Every figure on the review screen, in the order the screen shows them.
  fee: satoshis,
  totalInput: satoshis,
  totalOutput: satoshis,
  changeAmount: satoshis,
  // `reviewStepData` calls `.map` on this with no guard.
  utxos: z.array(z.looseObject({ txid: z.string(), vout: z.number().int() })),
});

export const CreateBatchTransactionResponseSchema = z.looseObject({
  psbtBase64: psbt,
  signingContext: PsbtSigningContextSchema,
  ...signingIntent,
  fee: satoshis,
  totalInput: satoshis,
  totalOutput: satoshis,
  changeAmount: satoshis,
  effectiveAmount: positiveSafeSatoshis.optional(),
  utxos: z.array(z.looseObject({ txid: z.string(), vout: z.number().int() })),
  outputs: batchOutputs,
});

/**
 * `DraftAmountSummary` calls `draft.fee.toLocaleString()` — the identical crash
 * shape to the null that took the dashboard down in #736, on the signing queue.
 */
export const DraftTransactionSchema = z.looseObject({
  id: z.string(),
  walletId: z.string(),
  psbtBase64: psbt,
  signingContext: PsbtSigningContextSchema.nullable().optional(),
  signingIntentId: z.string().min(1).nullable().optional(),
  signingIntentDigest: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  amount: satoshis,
  feeRate: satoshis,
  fee: satoshis,
  totalInput: satoshis,
  totalOutput: satoshis,
  changeAmount: satoshis,
  status: z.enum(['unsigned', 'partial', 'signed']),
  // Read by `.length` to count signatures against the quorum; a missing array
  // would throw, and a wrong one would misreport how far along a draft is.
  signedDeviceIds: z.array(z.string()),
});

export const DraftTransactionsResponseSchema = z.array(DraftTransactionSchema);

export type ValidatedDraftTransaction = z.infer<typeof DraftTransactionSchema>;
