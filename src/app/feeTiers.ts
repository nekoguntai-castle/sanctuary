import type { FeeEstimates } from '../api/bitcoin';
import type { FeeEstimate } from '../types';

/**
 * The one mapping from the server's fee tiers to the client's. Each client tier
 * reads the server tier with the same confirmation target (fastest, ~3 blocks,
 * ~6 blocks, economy), so the send presets, the default send rate and the
 * Dashboard fee card agree on what each label means.
 */
export function toClientFeeEstimate(feeEstimates: FeeEstimates): FeeEstimate {
  return {
    fastestFee: feeEstimates.fastest,
    halfHourFee: feeEstimates.halfHour,
    hourFee: feeEstimates.hour,
    economyFee: feeEstimates.economy,
    minimumFee: feeEstimates.minimum || 1,
  };
}
