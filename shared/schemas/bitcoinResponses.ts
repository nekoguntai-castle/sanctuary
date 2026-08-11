import { z } from 'zod';
import { PsbtSigningContextSchema } from './psbtSigningContext';

/**
 * Runtime shapes for the Bitcoin endpoints' *responses*.
 *
 * The rest of `shared/schemas` validates inbound requests, where `.strict()` is
 * right: an unknown key in a request is a caller mistake worth rejecting.
 * Responses are the opposite. The server is free to add fields, and a client
 * that rejected them would break the moment it lagged a deploy — so these strip
 * unknown keys rather than refuse them.
 *
 * What they do enforce is that the fields we read are the type we claim.
 * `apiClient.get<FeeEstimates>` is an unchecked assertion, and a null that
 * slipped through it crashed the dashboard (#736) and silently substituted the
 * minimum relay fee in the send flow (#738).
 */

/**
 * `.finite()` is the point of this schema, not decoration: `z.number()` alone
 * admits Infinity, and NaN/null/"12" are exactly what reached the formatters.
 *
 * Deliberately no range check. Validation here is about shape — whether the
 * server said something we can read — while whether a rate is *usable* (> 0)
 * stays with `usableFeeRate` at the point of use. Policing ranges here would
 * turn an odd-but-readable response into a blanked card.
 */
const feeRate = z.number().finite();

export const FeeEstimatesSchema = z.object({
  fastest: feeRate,
  halfHour: feeRate,
  hour: feeRate,
  economy: feeRate,
  minimum: feeRate.optional(),
});

export type FeeEstimatesResponse = z.infer<typeof FeeEstimatesSchema>;

const satoshis = z.number().finite();
const signingEvidence = {
  signingContext: PsbtSigningContextSchema,
  intentId: z.string().min(1),
  intentDigest: z.string().regex(/^[0-9a-f]{64}$/),
};
const signingIntent = {
  psbtBase64: z.string().min(1),
  ...signingEvidence,
};

/** Response from the dedicated hardware-wallet PSBT creation endpoint. */
export const HardwarePsbtCreateResponseSchema = z.looseObject({
  psbt: z.string().min(1),
  ...signingEvidence,
  fee: satoshis,
});

/**
 * A successful Payjoin replacement is atomic signing evidence. None of the
 * PSBT, intent, or account-binding fields may arrive independently.
 */
export const PayjoinAttemptResponseSchema = z.discriminatedUnion('success', [
  z.looseObject({
    success: z.literal(true),
    isPayjoin: z.literal(true),
    proposalPsbt: z.string().min(1),
    ...signingEvidence,
  }),
  z.looseObject({
    success: z.literal(false),
    isPayjoin: z.literal(false),
    error: z.string().optional(),
  }),
]);

export type HardwarePsbtCreateResponse = z.infer<typeof HardwarePsbtCreateResponseSchema>;
export type PayjoinAttemptResponse = z.infer<typeof PayjoinAttemptResponseSchema>;

/**
 * Fee-bump replacement, built from an existing transaction.
 *
 * `transactionActionsData` reads `result.outputs[0].address` directly and then
 * reduces over both arrays, so an empty list is a TypeError rather than an
 * empty render. Requiring at least one of each is not a range check: a
 * transaction with no inputs, or none out, is not a transaction — and this
 * result is fed straight into a draft that gets persisted and signed.
 */
export const RBFTransactionResponseSchema = z.looseObject({
  ...signingIntent,
  fee: satoshis,
  feeRate: satoshis,
  feeDelta: satoshis,
  inputs: z.array(z.looseObject({ txid: z.string(), vout: z.number().int(), value: satoshis })).min(1),
  outputs: z.array(z.looseObject({ address: z.string(), value: satoshis })).min(1),
});

export const CPFPTransactionResponseSchema = z.looseObject({
  ...signingIntent,
  childFee: satoshis,
  childFeeRate: satoshis,
  parentFeeRate: satoshis,
  effectiveFeeRate: satoshis,
});

export const BatchTransactionResponseSchema = z.looseObject({
  ...signingIntent,
  fee: satoshis,
  totalInput: satoshis,
  totalOutput: satoshis,
  changeAmount: satoshis,
  savedFees: satoshis,
  recipientCount: z.number().int().positive(),
});
