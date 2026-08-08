/**
 * Fee-rate values arrive from `/bitcoin/fees` through `apiClient.get<FeeEstimates>`,
 * which is an unchecked type assertion — the fields are `number` by declaration
 * only. They are also plainly absent whenever that request fails, since the whole
 * estimate object is then `null`.
 *
 * Both cases used to be swallowed by `?? 1` / `|| 1`, which turns "we do not know
 * the fee rate" into "one satoshi per vbyte" — the minimum relay fee, and about the
 * worst guess available. A transaction sent at that rate can sit unconfirmed
 * indefinitely with the user's funds locked in it.
 *
 * There is no safe number to substitute for a rate we were never given, so this
 * returns null and leaves the caller to say so.
 */
export function usableFeeRate(rate: number | undefined | null): number | null {
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
    return null;
  }
  return rate;
}
