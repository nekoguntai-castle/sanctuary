/**
 * Mempool.space Service
 *
 * Service for fetching Bitcoin network data from mempool.space API.
 * Provides mempool stats, recent blocks, and enhanced fee estimates.
 * Supports custom mempool.space instances via node configuration.
 */

// Endpoints
export {
  getRecentBlocks,
  getMempoolInfo,
  getRecommendedFees,
  getBlock,
  getBlockAtHeight,
  getTipHeight,
  getProjectedMempoolBlocks,
} from './endpoints';

// Dashboard aggregation
export { getBlocksAndMempool } from './dashboard';
