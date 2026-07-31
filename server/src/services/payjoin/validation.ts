export const MAX_PAYJOIN_MIN_FEE_RATE = 1_000_000;

// Keep the lexical OpenAPI contract exact with the runtime magnitude check.
export const PAYJOIN_MIN_FEE_RATE_PATTERN =
  '^(?:(?:0|[1-9]\\d{0,5})(?:\\.\\d+)?|1000000(?:\\.0+)?)$';

const minFeeRatePattern = new RegExp(PAYJOIN_MIN_FEE_RATE_PATTERN);

/**
 * Parse a BIP78 minimum fee rate in sat/vB.
 *
 * Omission uses the receiver default of 1 sat/vB. The generous upper bound
 * rejects non-finite/coercive input while remaining far above practical fees.
 */
export function parsePayjoinMinFeeRate(value: unknown): number | null {
  if (value === undefined) return 1;
  if (typeof value !== 'string' || !minFeeRatePattern.test(value)) return null;
  return Number(value);
}
