/**
 * Mempool API Endpoints
 *
 * Individual mempool.space API endpoint methods for blocks, fees, and mempool info.
 */

import axios from 'axios';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { getMempoolApiBase } from './config';
import type { MempoolBlock, MempoolInfo, FeeEstimates, ProjectedMempoolBlock } from './types';

const log = createLogger('MEMPOOL');

/**
 * Get recent blocks from mempool.space
 */
export async function getRecentBlocks(count: number = 10): Promise<MempoolBlock[]> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/v1/blocks`, {
      timeout: 3000,
    });

    // Return only the requested number of blocks
    return response.data.slice(0, count);
  } catch (error) {
    log.error('Failed to fetch recent blocks', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch recent blocks from mempool.space');
  }
}

/**
 * Get mempool information
 */
export async function getMempoolInfo(): Promise<MempoolInfo> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/mempool`, {
      timeout: 3000,
    });

    return response.data;
  } catch (error) {
    log.error('Failed to fetch mempool info', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch mempool info from mempool.space');
  }
}

/**
 * Get recommended fee estimates from mempool.space
 * Uses projected blocks API for decimal precision, falls back to recommended endpoint
 */
export async function getRecommendedFees(): Promise<FeeEstimates> {
  try {
    const apiBase = await getMempoolApiBase();

    // Try projected blocks first for decimal precision
    try {
      const projectedResponse = await axios.get(`${apiBase}/v1/fees/mempool-blocks`, {
        timeout: 3000,
      });

      const blocks: ProjectedMempoolBlock[] = projectedResponse.data;

      if (blocks.length > 0) {
        // Derive fee estimates from projected blocks with decimal precision
        // Block 0 = next block (highest priority), Block 1 = +1 block, etc.
        const nextBlock = blocks[0];
        const secondBlock = blocks[1] || nextBlock;
        const thirdBlock = blocks[2] || secondBlock;
        const lastBlock = blocks[blocks.length - 1];

        // Get minimum fee from the fee range of the last projected block
        const minimumFee = lastBlock?.feeRange?.[0] ?? 1;

        // Format fee with decimal precision
        const formatFee = (fee: number): number => {
          if (fee >= 10) return Math.round(fee);
          return parseFloat(fee.toFixed(1));
        };

        return {
          fastestFee: formatFee(nextBlock.medianFee),
          halfHourFee: formatFee(secondBlock.medianFee),
          hourFee: formatFee(thirdBlock.medianFee),
          economyFee: formatFee(lastBlock.medianFee),
          minimumFee: formatFee(minimumFee),
        };
      }
    } catch (projectedError) {
      log.debug('Projected blocks failed, trying recommended endpoint', { error: getErrorMessage(projectedError) });
    }

    // Fallback to recommended endpoint (returns integers)
    const response = await axios.get(`${apiBase}/v1/fees/recommended`, {
      timeout: 3000,
    });

    return {
      fastestFee: response.data.fastestFee,
      halfHourFee: response.data.halfHourFee,
      hourFee: response.data.hourFee,
      economyFee: response.data.economyFee,
      minimumFee: response.data.minimumFee,
    };
  } catch (error) {
    log.error('Failed to fetch fee estimates', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch fee estimates from mempool.space');
  }
}

/**
 * Get block by hash
 */
export async function getBlock(hash: string): Promise<MempoolBlock> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/block/${hash}`, {
      timeout: 3000,
    });

    return response.data;
  } catch (error) {
    log.error('Failed to fetch block', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch block from mempool.space');
  }
}

/**
 * Get block at specific height
 */
export async function getBlockAtHeight(height: number): Promise<string> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/block-height/${height}`, {
      timeout: 3000,
    });

    // Returns block hash
    return response.data;
  } catch (error) {
    log.error('Failed to fetch block at height', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch block at height from mempool.space');
  }
}

/**
 * Get current block height (tip)
 */
export async function getTipHeight(): Promise<number> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/blocks/tip/height`, {
      timeout: 3000,
    });

    return response.data;
  } catch (error) {
    log.error('Failed to fetch tip height', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch tip height from mempool.space');
  }
}

/**
 * Get projected mempool blocks from mempool.space API
 * This uses actual mempool sorting to show which transactions will be in each block
 */
export async function getProjectedMempoolBlocks(): Promise<ProjectedMempoolBlock[]> {
  try {
    const apiBase = await getMempoolApiBase();
    const response = await axios.get(`${apiBase}/v1/fees/mempool-blocks`, {
      timeout: 3000,
    });

    return response.data;
  } catch (error) {
    log.error('Failed to fetch projected mempool blocks', { error: getErrorMessage(error) });
    throw new Error('Failed to fetch projected mempool blocks from mempool.space');
  }
}
