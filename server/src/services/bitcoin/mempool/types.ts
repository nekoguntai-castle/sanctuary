/**
 * Mempool Service Types
 *
 * Shared type definitions for the mempool service modules.
 */

export interface MempoolBlock {
  id: string;
  height: number;
  version: number;
  timestamp: number;
  tx_count: number;
  size: number;
  weight: number;
  merkle_root: string;
  previousblockhash: string;
  medianFee: number;
  feeRange: number[];
  extras: {
    medianFee: number;
    feeRange: number[];
    reward: number;
    totalFees: number;
    avgFeeRate?: number; // Average fee rate in sat/vB (provided by mempool.space)
  };
}

export interface MempoolInfo {
  count: number;
  vsize: number;
  total_fee: number;
  fee_histogram: number[][];
}

export interface FeeEstimates {
  fastestFee: number;    // Next block
  halfHourFee: number;   // ~3 blocks
  hourFee: number;       // ~6 blocks
  economyFee: number;    // ~24 blocks
  minimumFee: number;    // Low priority
}

/**
 * Projected mempool block from mempool.space API
 */
export interface ProjectedMempoolBlock {
  blockSize: number;
  blockVSize: number;
  nTx: number;
  totalFees: number;
  medianFee: number;
  feeRange: number[];
}
