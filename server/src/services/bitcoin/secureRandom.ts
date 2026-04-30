import { randomInt as cryptoRandomInt } from "crypto";

const RANDOM_FRACTION_SCALE = 1_000_000;
// Node crypto.randomInt supports safe integer ranges below 2^48.
const MAX_RANDOM_INT_EXCLUSIVE = 2 ** 48;

/**
 * Random source for privacy-sensitive Bitcoin transaction construction.
 * Use this instead of Math.random when output order or decoy amounts affect
 * chain-analysis resistance.
 */
export interface CryptoRandomSource {
  /** Returns a crypto-backed fraction in the range [0, 1). */
  randomFraction(): number;
  /** Returns a crypto-backed integer in the range [0, maxExclusive). */
  randomInt(maxExclusive: number): number;
}

const assertRandomIntBound = (maxExclusive: number): void => {
  if (
    !Number.isSafeInteger(maxExclusive) ||
    maxExclusive <= 0 ||
    maxExclusive >= MAX_RANDOM_INT_EXCLUSIVE
  ) {
    throw new RangeError(
      `Random integer upper bound must be a safe integer from 1 to ${MAX_RANDOM_INT_EXCLUSIVE - 1}`,
    );
  }
};

export const cryptoRandomSource: CryptoRandomSource = {
  randomFraction(): number {
    return cryptoRandomInt(RANDOM_FRACTION_SCALE) / RANDOM_FRACTION_SCALE;
  },

  randomInt(maxExclusive: number): number {
    assertRandomIntBound(maxExclusive);
    return cryptoRandomInt(maxExclusive);
  },
};

/**
 * Fisher-Yates shuffle using an injected crypto-backed integer source by default.
 */
export const shuffleInPlace = <T>(
  items: T[],
  randomSource: Pick<CryptoRandomSource, "randomInt"> = cryptoRandomSource,
): T[] => {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomSource.randomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
};
