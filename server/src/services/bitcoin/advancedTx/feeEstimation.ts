/**
 * Advanced Fee Estimation
 *
 * Provides detailed fee estimates with time predictions and
 * optimal fee calculation based on transaction priority.
 */

import { getNodeClient } from '../nodeClient';
import { estimateTransactionSize, calculateFee } from '../utils';
import { log } from './shared';

/**
 * Get detailed fee estimates with time predictions
 */
export async function getAdvancedFeeEstimates(): Promise<{
  fastest: { feeRate: number; blocks: number; minutes: number };
  fast: { feeRate: number; blocks: number; minutes: number };
  medium: { feeRate: number; blocks: number; minutes: number };
  slow: { feeRate: number; blocks: number; minutes: number };
  minimum: { feeRate: number; blocks: number; minutes: number };
}> {
  // Use nodeClient which respects poolEnabled setting from node_configs
  const client = await getNodeClient();

  try {
    const [fastest, fast, medium, slow, minimum] = await Promise.all([
      client.estimateFee(1),
      client.estimateFee(3),
      client.estimateFee(6),
      client.estimateFee(12),
      client.estimateFee(144),
    ]);

    return {
      fastest: { feeRate: Math.max(1, Math.ceil(fastest)), blocks: 1, minutes: 10 },
      fast: { feeRate: Math.max(1, Math.ceil(fast)), blocks: 3, minutes: 30 },
      medium: { feeRate: Math.max(1, Math.ceil(medium)), blocks: 6, minutes: 60 },
      slow: { feeRate: Math.max(1, Math.ceil(slow)), blocks: 12, minutes: 120 },
      minimum: { feeRate: Math.max(1, Math.ceil(minimum)), blocks: 144, minutes: 1440 },
    };
  } catch (error) {
    log.error('Failed to get fee estimates', { error });
    // Return sensible defaults
    return {
      fastest: { feeRate: 50, blocks: 1, minutes: 10 },
      fast: { feeRate: 30, blocks: 3, minutes: 30 },
      medium: { feeRate: 15, blocks: 6, minutes: 60 },
      slow: { feeRate: 8, blocks: 12, minutes: 120 },
      minimum: { feeRate: 1, blocks: 144, minutes: 1440 },
    };
  }
}

/**
 * Estimate optimal fee for a transaction based on priority
 */
export async function estimateOptimalFee(
  inputCount: number,
  outputCount: number,
  priority: 'fastest' | 'fast' | 'medium' | 'slow' | 'minimum' = 'medium',
  scriptType: 'legacy' | 'nested_segwit' | 'native_segwit' | 'taproot' = 'native_segwit'
): Promise<{
  fee: number;
  feeRate: number;
  size: number;
  confirmationTime: string;
}> {
  const fees = await getAdvancedFeeEstimates();
  const feeData = fees[priority];
  const size = estimateTransactionSize(inputCount, outputCount, scriptType);
  const fee = calculateFee(size, feeData.feeRate);

  let confirmationTime = '';
  if (feeData.minutes < 60) {
    confirmationTime = `~${feeData.minutes} minutes`;
  } else if (feeData.minutes < 1440) {
    confirmationTime = `~${Math.round(feeData.minutes / 60)} hours`;
  } else {
    confirmationTime = `~${Math.round(feeData.minutes / 1440)} days`;
  }

  return {
    fee,
    feeRate: feeData.feeRate,
    size,
    confirmationTime,
  };
}
