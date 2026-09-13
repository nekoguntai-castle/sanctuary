/**
 * Decoy Amount Generation
 *
 * Generates realistic-looking decoy output amounts for privacy-enhancing
 * change output splitting.
 */

import {
  cryptoRandomSource,
  shuffleInPlace,
  type CryptoRandomSource,
} from "../secureRandom";

/**
 * Generate realistic-looking decoy amounts from a total change amount
 * Amounts avoid round numbers and vary in magnitude to look like real payments
 * Exported for testing
 */
export function generateDecoyAmounts(
  totalChange: number,
  count: number,
  dustThreshold: number,
  randomSource: CryptoRandomSource = cryptoRandomSource,
): number[] {
  if (count < 2) {
    return [totalChange];
  }

  // Reserve dust threshold for each output. If the total can't cover
  // `count` outputs at the dust floor, shrink the split count instead of
  // ever emitting a sub-dust amount — every returned amount must stay
  // >= dustThreshold.
  const minPerOutput = dustThreshold;
  let splitCount = count;
  while (splitCount > 1 && totalChange < splitCount * minPerOutput) {
    splitCount--;
  }

  if (splitCount <= 1) {
    return [totalChange];
  }

  // The while loop above guarantees totalChange >= splitCount * minPerOutput,
  // so usableChange is never negative here; it may be exactly 0 (every
  // output lands right on dustThreshold), which the per-step reserve clamp
  // below still handles correctly.
  const usableChange = totalChange - minPerOutput * splitCount;

  // Generate random weights for splitting
  const weights: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < splitCount; i++) {
    // Use varied weight ranges to create different sized outputs
    // Some outputs will be larger, some smaller
    const weight = 0.3 + randomSource.randomFraction() * 0.7; // 0.3 to 1.0
    weights.push(weight);
    totalWeight += weight;
  }

  // Distribute change according to weights
  const amounts: number[] = [];
  let remaining = totalChange;

  for (let i = 0; i < splitCount - 1; i++) {
    // Calculate proportional amount
    let amount =
      Math.floor((weights[i] / totalWeight) * usableChange) + minPerOutput;

    // Add small random variation to avoid patterns (+/- up to 3%)
    const variation = Math.floor(
      amount * (randomSource.randomFraction() * 0.06 - 0.03),
    );
    amount += variation;

    // Every output still to come (the remaining loop iterations plus the
    // final output) must keep at least dustThreshold, so clamp this
    // amount into [minPerOutput, remaining - minPerOutput * outputsAfterThis]
    // rather than only guarding against the immediately-next output.
    const outputsAfterThis = splitCount - 1 - i;
    const maxAllowed = remaining - minPerOutput * outputsAfterThis;
    amount = Math.max(minPerOutput, Math.min(amount, maxAllowed));

    amounts.push(amount);
    remaining -= amount;
  }

  // Last output gets the remainder, guaranteed >= minPerOutput by the
  // per-step reserve above.
  amounts.push(remaining);

  // Shuffle the amounts so the largest isn't predictably in a certain position
  shuffleInPlace(amounts, randomSource);

  return amounts;
}
