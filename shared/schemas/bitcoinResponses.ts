import { z } from 'zod';

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
