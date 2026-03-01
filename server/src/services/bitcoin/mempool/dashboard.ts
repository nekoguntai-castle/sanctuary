/**
 * Mempool Dashboard
 *
 * Aggregates blocks and mempool data for dashboard visualization.
 * Supports two estimation algorithms: mempool_space (accurate) and simple (fallback).
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { getMempoolEstimatorType } from './config';
import { getRecentBlocks, getMempoolInfo, getRecommendedFees, getProjectedMempoolBlocks } from './endpoints';
import { formatConfirmedBlocks, getValidMedianFee, formatFeeRate } from './formatting';
import { getBlocksAndMempoolSimple } from './simpleEstimator';
import type { MempoolBlock, MempoolInfo, FeeEstimates } from './types';

const log = createLogger('MEMPOOL');

/**
 * Get blocks and mempool data for dashboard visualization
 * Returns recent confirmed blocks + projected mempool blocks
 *
 * Uses one of two algorithms based on mempoolEstimator config:
 * - 'simple': Fee bucket thresholds (faster, less accurate)
 * - 'mempool_space': Actual mempool sorting via API (more accurate)
 */
export async function getBlocksAndMempool() {
  try {
    const estimatorType = await getMempoolEstimatorType();

    const [blocks, mempoolInfo, fees] = await Promise.all([
      getRecentBlocks(7),
      getMempoolInfo(),
      getRecommendedFees(),
    ]);

    // Mempool size in MB
    const mempoolSizeMB = mempoolInfo.vsize / 1000000;

    let mempoolBlocks: Array<{
      height: string;
      medianFee: number;
      feeRange: string;
      size: number;
      time: string;
      status: 'pending';
      txCount: number;
      totalFees: number;
    }> = [];

    let queuedBlocksSummary: {
      blockCount: number;
      totalTransactions: number;
      averageFee: number;
      totalFees: number;
    } | null = null;

    if (estimatorType === 'mempool_space') {
      // Use mempool.space projected blocks API for accurate sorting
      try {
        const projectedBlocks = await getProjectedMempoolBlocks();

        // IMPORTANT: Block ordering documentation
        // =========================================
        // mempool.space API returns blocks in order of confirmation priority:
        //   - projectedBlocks[0] = Next block (highest fee, confirms first)
        //   - projectedBlocks[1] = +2 blocks out
        //   - projectedBlocks[2] = +3 blocks out
        //
        // We convert them with labels and then REVERSE at the end (line ~350),
        // so the final 'mempool' array returned to frontend is:
        //   - mempool[0] = +3 block (furthest from confirmation, leftmost in UI)
        //   - mempool[1] = +2 block
        //   - mempool[2] = Next block (closest to confirmation, rightmost pending)
        //
        // The frontend displays blocks left-to-right in array order:
        //   [+3] [+2] [Next] | [Confirmed blocks...]
        //
        // When matching pending transactions to blocks, use:
        //   - Index 0 = +3 (lowest priority, lowest fees)
        //   - Index (length-1) = Next block (highest priority, highest fees)

        // Convert projected blocks to our format (show up to 3)
        const blockLabels = ['Next', '+2', '+3'];
        const blockTimes = ['~10m', '~20m', '~30m'];

        mempoolBlocks = projectedBlocks.slice(0, 3).map((block, idx) => {
          // Calculate average fee rate: totalFees (sats) / blockVSize (vbytes)
          const avgFeeRate = block.blockVSize > 0 ? block.totalFees / block.blockVSize : 0;
          return {
            height: blockLabels[idx],
            medianFee: block.medianFee < 1 ? parseFloat(block.medianFee.toFixed(2)) : Math.round(block.medianFee),
            avgFeeRate: avgFeeRate < 1 ? parseFloat(avgFeeRate.toFixed(2)) : Math.round(avgFeeRate),
            feeRange: block.feeRange.length >= 2
              ? `${formatFeeRate(block.feeRange[0])}-${formatFeeRate(block.feeRange[block.feeRange.length - 1])} sat/vB`
              : `${formatFeeRate(block.medianFee)} sat/vB`,
            size: block.blockVSize / 1000000, // Convert to MB
            time: blockTimes[idx],
            status: 'pending' as const,
            txCount: block.nTx,
            totalFees: block.totalFees / 100000000, // Convert satoshis to BTC
          };
        });

        // Calculate summary for additional blocks beyond the 3 displayed
        if (projectedBlocks.length > 3) {
          const additionalBlocks = projectedBlocks.slice(3);
          const totalTxCount = additionalBlocks.reduce((sum, b) => sum + b.nTx, 0);
          const totalFees = additionalBlocks.reduce((sum, b) => sum + b.totalFees, 0);
          const totalVsize = additionalBlocks.reduce((sum, b) => sum + b.blockVSize, 0);
          const avgFee = additionalBlocks.reduce((sum, b) => sum + b.medianFee, 0) / additionalBlocks.length;

          // Calculate actual block count based on vsize
          // A typical block is ~1MB (1,000,000 vbytes)
          // The last API block often contains many blocks worth of transactions
          const BLOCK_VSIZE = 1000000; // 1 MB
          const estimatedBlockCount = Math.ceil(totalVsize / BLOCK_VSIZE);

          queuedBlocksSummary = {
            blockCount: estimatedBlockCount,
            totalTransactions: totalTxCount,
            averageFee: avgFee < 1 ? parseFloat(avgFee.toFixed(2)) : Math.round(avgFee),
            totalFees: totalFees / 100000000,
          };
        }

        log.debug('Using mempool.space projected blocks', {
          blocksCount: mempoolBlocks.length,
          additionalBlocks: queuedBlocksSummary?.blockCount || 0,
        });
      } catch (projectedError) {
        // Fall back to simple algorithm if projected blocks API fails
        log.warn('Projected blocks API failed, falling back to simple algorithm', {
          error: getErrorMessage(projectedError),
        });
        return getBlocksAndMempoolSimple(blocks, mempoolInfo, fees, mempoolSizeMB);
      }
    } else {
      // Use simple fee bucket algorithm
      return getBlocksAndMempoolSimple(blocks, mempoolInfo, fees, mempoolSizeMB);
    }

    // Format confirmed blocks
    const confirmedBlocks = formatConfirmedBlocks(blocks);

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
  } catch (error) {
    log.error('Failed to fetch blocks and mempool', { error: getErrorMessage(error) });
    throw error;
  }
}
