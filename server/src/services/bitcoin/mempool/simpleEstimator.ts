/**
 * Simple Fee Estimator
 *
 * Simple fee bucket algorithm for mempool block estimation.
 * Used as fallback or when 'simple' estimator is configured.
 */

import { formatConfirmedBlocks, formatFeeRate } from './formatting';
import type { MempoolBlock, MempoolInfo, FeeEstimates } from './types';

/**
 * Simple fee bucket algorithm for mempool block estimation
 * Used as fallback or when 'simple' estimator is configured
 */
export function getBlocksAndMempoolSimple(
  blocks: MempoolBlock[],
  mempoolInfo: MempoolInfo,
  fees: FeeEstimates,
  mempoolSizeMB: number
) {
  const maxBlockSizeMB = 1.0; // 1M vbytes = Bitcoin block weight limit / 4
  const avgTxCount = 3000; // Average transactions per block estimate
  const blocksInMempool = Math.ceil(mempoolSizeMB / maxBlockSizeMB);

  const estimateTxCount = (sizeMB: number) => {
    return Math.round((sizeMB / maxBlockSizeMB) * avgTxCount);
  };

  const avgTxSize = 250;
  const estimateTotalFees = (medianFee: number, txCount: number) => {
    return (medianFee * avgTxSize * txCount) / 100000000;
  };

  const mempoolBlocks: Array<{
    height: string;
    medianFee: number;
    avgFeeRate: number;
    feeRange: string;
    size: number;
    time: string;
    status: 'pending';
    txCount: number;
    totalFees: number;
  }> = [];

  if (blocksInMempool >= 1) {
    const blockSize = Math.min(mempoolSizeMB, maxBlockSizeMB);
    const txCount = estimateTxCount(blockSize);
    const totalFees = estimateTotalFees(fees.fastestFee, txCount);
    const minFee = Math.max(fees.fastestFee - 5, 0.1);
    const maxFee = fees.fastestFee + 50;
    mempoolBlocks.push({
      height: 'Next',
      medianFee: fees.fastestFee,
      avgFeeRate: fees.fastestFee, // Simple estimate: avg ~= median
      feeRange: `${formatFeeRate(minFee)}-${formatFeeRate(maxFee)} sat/vB`,
      size: blockSize,
      time: '~10m',
      status: 'pending' as const,
      txCount,
      totalFees,
    });
  }

  if (blocksInMempool >= 2) {
    const blockSize = Math.min(mempoolSizeMB - maxBlockSizeMB, maxBlockSizeMB);
    const txCount = estimateTxCount(blockSize);
    const totalFees = estimateTotalFees(fees.halfHourFee, txCount);
    const minFee = Math.max(fees.halfHourFee - 5, 0.1);
    const maxFee = fees.halfHourFee + 20;
    mempoolBlocks.push({
      height: '+2',
      medianFee: fees.halfHourFee,
      avgFeeRate: fees.halfHourFee, // Simple estimate: avg ~= median
      feeRange: `${formatFeeRate(minFee)}-${formatFeeRate(maxFee)} sat/vB`,
      size: blockSize,
      time: '~20m',
      status: 'pending' as const,
      txCount,
      totalFees,
    });
  }

  if (blocksInMempool >= 3) {
    const blockSize = Math.min(mempoolSizeMB - (maxBlockSizeMB * 2), maxBlockSizeMB);
    const txCount = estimateTxCount(blockSize);
    const totalFees = estimateTotalFees(fees.hourFee, txCount);
    const minFee = Math.max(fees.hourFee - 3, 0.1);
    const maxFee = fees.hourFee + 10;
    mempoolBlocks.push({
      height: '+3',
      medianFee: fees.hourFee,
      avgFeeRate: fees.hourFee, // Simple estimate: avg ~= median
      feeRange: `${formatFeeRate(minFee)}-${formatFeeRate(maxFee)} sat/vB`,
      size: blockSize,
      time: '~30m',
      status: 'pending' as const,
      txCount,
      totalFees,
    });
  }

  const confirmedBlocks = formatConfirmedBlocks(blocks);

  const displayedMempoolBlocks = Math.min(blocksInMempool, 3);
  const additionalBlocks = Math.max(blocksInMempool - displayedMempoolBlocks, 0);

  let queuedBlocksSummary = null;
  if (additionalBlocks > 0) {
    const additionalBlockSize = Math.max(mempoolSizeMB - (maxBlockSizeMB * displayedMempoolBlocks), 0);
    const totalTxCount = estimateTxCount(additionalBlockSize);
    const avgFee = fees.economyFee;
    const estimatedTotalFees = (avgFee * 250 * totalTxCount) / 100000000;

    queuedBlocksSummary = {
      blockCount: additionalBlocks,
      totalTransactions: totalTxCount,
      averageFee: avgFee,
      totalFees: estimatedTotalFees,
    };
  }

  return {
    mempool: mempoolBlocks.reverse(),
    blocks: confirmedBlocks,
    mempoolInfo: {
      count: mempoolInfo.count,
      size: mempoolSizeMB,
      totalFees: mempoolInfo.total_fee,
    },
    queuedBlocksSummary,
  };
}
