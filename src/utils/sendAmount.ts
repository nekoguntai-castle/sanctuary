const SATOSHIS_PER_BTC = 100_000_000n;
const MAX_SAFE_SATOSHIS = BigInt(Number.MAX_SAFE_INTEGER);
const BTC_AMOUNT_PATTERN = /^(?:\d+(?:\.\d{0,8})?|\.\d{1,8})$/;
const SATOSHI_AMOUNT_PATTERN = /^\d+$/;

/** Convert a positive BTC decimal with at most eight places to exact safe-integer satoshis. */
export function btcAmountToSatoshiString(value: string): string | null {
  const trimmed = value.trim();
  if (!BTC_AMOUNT_PATTERN.test(trimmed)) return null;

  const [wholePart, fractionPart = ''] = trimmed.split('.');
  const whole = BigInt(wholePart || '0');
  const fraction = BigInt(fractionPart.padEnd(8, '0'));
  const satoshis = whole * SATOSHIS_PER_BTC + fraction;
  if (satoshis <= 0n || satoshis > MAX_SAFE_SATOSHIS) return null;
  return satoshis.toString();
}

/** Parse an already-normalized positive integer satoshi string without rounding or coercion. */
export function parsePositiveSatoshiAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!SATOSHI_AMOUNT_PATTERN.test(trimmed)) return null;
  const amount = Number(trimmed);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

/** Require a normalized positive safe-integer satoshi string, throwing on invalid input. */
export function requirePositiveSatoshiAmount(value: string, label = 'amount'): number {
  const amount = parsePositiveSatoshiAmount(value);
  if (amount === null) throw new Error(`Invalid ${label}`);
  return amount;
}

/** Require a numeric value to already be a positive safe-integer satoshi amount. */
export function requirePositiveSatoshiNumber(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${label}`);
  return value;
}
