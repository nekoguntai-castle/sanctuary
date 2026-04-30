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

  // Reserve dust threshold for each output
  const minPerOutput = dustThreshold;
  const usableChange = totalChange - minPerOutput * count;

  if (usableChange <= 0) {
    // Not enough change to split into decoys, return single output
    return [totalChange];
  }

  // Generate random weights for splitting
  const weights: number[] = [];
  let totalWeight = 0;

  for (let i = 0; i < count; i++) {
    // Use varied weight ranges to create different sized outputs
    // Some outputs will be larger, some smaller
    const weight = 0.3 + randomSource.randomFraction() * 0.7; // 0.3 to 1.0
    weights.push(weight);
    totalWeight += weight;
  }

  // Distribute change according to weights
  const amounts: number[] = [];
  let remaining = totalChange;

  for (let i = 0; i < count - 1; i++) {
    // Calculate proportional amount
    let amount =
      Math.floor((weights[i] / totalWeight) * usableChange) + minPerOutput;

    // Add small random variation to avoid patterns (+/- up to 3%)
    const variation = Math.floor(
      amount * (randomSource.randomFraction() * 0.06 - 0.03),
    );
    amount += variation;

    // Ensure minimum threshold
    amount = Math.max(amount, minPerOutput);

    // Don't exceed remaining
    if (amount >= remaining - minPerOutput) {
      amount = Math.floor(remaining / 2);
    }

    amounts.push(amount);
    remaining -= amount;
  }

  // Last output gets the remainder
  amounts.push(remaining);

  // Shuffle the amounts so the largest isn't predictably in a certain position
  shuffleInPlace(amounts, randomSource);

  return amounts;
}
