/**
 * Advanced Fee Estimation
 *
 * Provides detailed fee estimates with time predictions and
 * optimal fee calculation based on transaction priority.
 */

import { getNodeClient } from '../nodeClient';
import {
  WalletScriptType,
  type WalletScriptType as WalletScriptTypeValue,
} from '@sanctuary/shared/constants/walletIdentity';
import type { BitcoinNetwork } from '../networks';
import { estimateTransactionSize, calculateFee } from '../utils';
import { getErrorMessage } from '../../../utils/errors';
import { ElectrumNoFeeEstimateError } from '../electrum/types';
import { log } from './shared';

type AdvancedFeeTier = { feeRate: number; blocks: number; minutes: number };
type AdvancedFeeEstimates = {
  fastest: AdvancedFeeTier;
  fast: AdvancedFeeTier;
  medium: AdvancedFeeTier;
  slow: AdvancedFeeTier;
  minimum: AdvancedFeeTier;
};

/** Per-target fallback used both for a single missing Electrum estimate and,
 * via `buildDefaultAdvancedFeeEstimates()`, for a genuine failure across every target. */
const ADVANCED_FEE_TARGETS: ReadonlyArray<{
  tier: keyof AdvancedFeeEstimates;
  blocks: number;
  minutes: number;
  fallback: number;
}> = [
  { tier: 'fastest', blocks: 1, minutes: 10, fallback: 50 },
  { tier: 'fast', blocks: 3, minutes: 30, fallback: 30 },
  { tier: 'medium', blocks: 6, minutes: 60, fallback: 15 },
  { tier: 'slow', blocks: 12, minutes: 120, fallback: 8 },
  { tier: 'minimum', blocks: 144, minutes: 1440, fallback: 1 },
];

function buildDefaultAdvancedFeeEstimates(): AdvancedFeeEstimates {
  const defaults = {} as AdvancedFeeEstimates;
  for (const { tier, blocks, minutes, fallback } of ADVANCED_FEE_TARGETS) {
    defaults[tier] = { feeRate: fallback, blocks, minutes };
  }
  return defaults;
}

/**
 * Get detailed fee estimates with time predictions.
 *
 * Electrum servers routinely have no estimate for some confirmation targets
 * (thin mempools, regtest, or the ~144-block horizon), and `estimateFee()`
 * signals that with `ElectrumNoFeeEstimateError` rather than a fee rate.
 * That is expected and routine, not a transport failure: each target is
 * resolved independently so one missing estimate substitutes only that
 * tier's documented fallback, instead of discarding every other tier's live
 * estimate. A genuine failure (a thrown error that is not
 * `ElectrumNoFeeEstimateError`, e.g. a connection drop) still falls back to
 * the full default schedule and is logged at error level, exactly as before.
 */
export async function getAdvancedFeeEstimates(
  network: BitcoinNetwork = 'mainnet',
): Promise<AdvancedFeeEstimates> {
  // Use nodeClient which respects poolEnabled setting from node_configs
  const client = await getNodeClient(network);

  try {
    const settled = await Promise.allSettled(
      ADVANCED_FEE_TARGETS.map(target => client.estimateFee(target.blocks)),
    );

    const estimates = {} as AdvancedFeeEstimates;
    for (let i = 0; i < ADVANCED_FEE_TARGETS.length; i++) {
      const { tier, blocks, minutes, fallback } = ADVANCED_FEE_TARGETS[i];
      const outcome = settled[i];
      if (outcome.status === 'fulfilled') {
        estimates[tier] = { feeRate: Math.max(1, Math.ceil(outcome.value)), blocks, minutes };
        continue;
      }
      if (outcome.reason instanceof ElectrumNoFeeEstimateError) {
        log.warn('No Electrum fee estimate for target; using its fallback', {
          network, blocks, tier, fallback,
        });
        estimates[tier] = { feeRate: fallback, blocks, minutes };
        continue;
      }
      // Genuine transport/other failure: preserve the existing full-fallback
      // behavior by routing it through the catch block below.
      throw outcome.reason;
    }
    return estimates;
  } catch (error) {
    log.error('Failed to get fee estimates', { error: getErrorMessage(error) });
    // Return sensible defaults
    return buildDefaultAdvancedFeeEstimates();
  }
}

/**
 * Estimate optimal fee for a transaction based on priority
 */
export async function estimateOptimalFee(
  inputCount: number,
  outputCount: number,
  priority: 'fastest' | 'fast' | 'medium' | 'slow' | 'minimum' = 'medium',
  scriptType: WalletScriptTypeValue = WalletScriptType.NATIVE_SEGWIT,
  network: BitcoinNetwork = 'mainnet'
): Promise<{
  fee: number;
  feeRate: number;
  size: number;
  confirmationTime: string;
}> {
  const fees = await getAdvancedFeeEstimates(network);
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
