/**
 * Mempool Formatting Utilities
 *
 * Shared formatting helpers for fee rates and confirmed block data.
 */

import type { MempoolBlock } from './types';

/**
 * Format fee rate - always 2 decimal places
 */
export function formatFeeRate(rate: number): string {
  return rate.toFixed(2);
}

/**
 * Get valid medianFee - falls back to avgFeeRate or feeRange middle if medianFee is 0
 */
export function getValidMedianFee(
  medianFee: number | undefined,
  feeRangeArr: number[] | undefined,
  avgFeeRate?: number
): number {
  // If medianFee is valid (non-zero positive), use it
  if (medianFee && medianFee > 0) {
    return medianFee;
  }
  // Second choice: use avgFeeRate from API if available
  if (avgFeeRate && avgFeeRate > 0) {
    return avgFeeRate;
  }
  // Third choice: use middle value of feeRange (represents ~50th percentile)
  // feeRange is typically [min, 10th, 25th, 50th, 75th, 90th, max]
  if (feeRangeArr && feeRangeArr.length >= 3) {
    const middleIndex = Math.floor(feeRangeArr.length / 2);
    return feeRangeArr[middleIndex];
  }
  if (feeRangeArr && feeRangeArr.length >= 1) {
    return feeRangeArr[0];
  }
  // Fallback default - use minimum relay fee
  return 1;
}

/**
 * Format confirmed blocks for dashboard display
 */
export function formatConfirmedBlocks(blocks: MempoolBlock[]) {
  return blocks.slice(0, 4).map((block) => {
    const age = Math.floor((Date.now() / 1000 - block.timestamp) / 60);
    // Calculate average fee rate from totalFees and block weight
    // block.weight is in weight units, vsize = weight / 4
    const vsize = (block.weight || block.size) / 4;
    const totalFeesSats = block.extras?.totalFees || 0;
    const calculatedAvgFeeRate = vsize > 0 ? totalFeesSats / vsize : 0;
    const feeRangeArr = block.extras?.feeRange;
    const rawMedianFee = block.extras?.medianFee ?? block.medianFee;
    // Prefer API's avgFeeRate, fall back to our calculation
    const avgFeeRateFallback = block.extras?.avgFeeRate ?? calculatedAvgFeeRate;
    return {
      height: block.height,
      medianFee: getValidMedianFee(rawMedianFee, feeRangeArr, avgFeeRateFallback),
      avgFeeRate: calculatedAvgFeeRate < 1 ? parseFloat(calculatedAvgFeeRate.toFixed(2)) : Math.round(calculatedAvgFeeRate),
      feeRange: feeRangeArr && feeRangeArr.length >= 2
        ? `${formatFeeRate(feeRangeArr[0])}-${formatFeeRate(feeRangeArr[feeRangeArr.length - 1])} sat/vB`
        : '40.00-200.00 sat/vB',
      size: block.size / 1000000,
      time: age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`,
      status: 'confirmed' as const,
      txCount: block.tx_count,
      totalFees: block.extras?.totalFees ? block.extras.totalFees / 100000000 : undefined,
    };
  });
}
