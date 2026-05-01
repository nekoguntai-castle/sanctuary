/**
 * Bitcoin - Network Router
 *
 * Network status, mempool data, and block information
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getElectrumClient } from '../../services/bitcoin/electrum';
import * as mempool from '../../services/bitcoin/mempool';
import { getBitcoinNetworkStatus } from '../../services/bitcoin/networkStatusService';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError } from '../../errors/ApiError';

const MAX_RECENT_BLOCKS_COUNT = 100;

/** Recent blocks count (defaults invalid values to 10 and caps large requests). */
const RecentBlocksCountSchema = z.coerce.number().int().min(1).catch(10)
  .transform(count => Math.min(count, MAX_RECENT_BLOCKS_COUNT));

/** Block height (must be a non-negative integer) */
const BlockHeightSchema = z.coerce.number().int().min(0);
const StatusNetworkSchema = z.enum(['mainnet', 'testnet', 'signet', 'regtest']).catch('mainnet');
const MempoolNetworkSchema = z.enum(['mainnet', 'testnet', 'signet']).catch('mainnet');

const router = Router();
const log = createLogger('BITCOIN_NETWORK:ROUTE');

// Simple cache for mempool data to avoid hammering external APIs
type MempoolCacheEntry = {
  data: Awaited<ReturnType<typeof mempool.getBlocksAndMempool>>;
  timestamp: number;
};

const mempoolCache = new Map<z.infer<typeof MempoolNetworkSchema>, MempoolCacheEntry>();
const MEMPOOL_CACHE_TTL = 15000; // 15 seconds
const MEMPOOL_STALE_TTL = 300000; // 5 minutes for stale fallback

/**
 * GET /api/v1/bitcoin/status
 * Get Bitcoin network status
 *
 * NOTE: Intentionally keeps try/catch for graceful degradation -
 * returns { connected: false } instead of a 500 error.
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const network = StatusNetworkSchema.parse(req.query.network);
    res.json(await getBitcoinNetworkStatus(network));
  } catch (error) {
    res.json({
      connected: false,
      error: getErrorMessage(error),
    });
  }
});

/**
 * GET /api/v1/bitcoin/mempool
 * Get mempool and recent blocks data for visualization
 *
 * NOTE: Intentionally keeps try/catch for stale cache fallback -
 * returns stale data instead of a 500 error when fresh fetch fails.
 */
router.get('/mempool', async (req: Request, res: Response) => {
  const network = MempoolNetworkSchema.parse(req.query.network);
  const now = Date.now();
  const cached = mempoolCache.get(network);

  // Return fresh cache if available
  if (cached && (now - cached.timestamp) < MEMPOOL_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const data = await mempool.getBlocksAndMempool(network);
    mempoolCache.set(network, { data, timestamp: now });
    res.json(data);
  } catch (error) {
    log.error('Get mempool error', { error: String(error), network });

    // Return stale cache if available (better than 500)
    if (cached && (now - cached.timestamp) < MEMPOOL_STALE_TTL) {
      log.warn('Returning stale mempool cache due to fetch failure', { network });
      return res.json({ ...cached.data, stale: true });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to fetch mempool data',
    });
  }
});

/**
 * GET /api/v1/bitcoin/blocks/recent
 * Get recent confirmed blocks
 */
router.get('/blocks/recent', asyncHandler(async (req, res) => {
  /* v8 ignore next -- fallback is a schema safety net for malformed query input */
  const count = RecentBlocksCountSchema.safeParse(req.query.count).data ?? 10;
  const blocks = await mempool.getRecentBlocks(count);

  res.json(blocks);
}));

/**
 * GET /api/v1/bitcoin/block/:height
 * Get block information
 */
router.get('/block/:height', asyncHandler(async (req, res) => {
  const heightResult = BlockHeightSchema.safeParse(req.params.height);
  if (!heightResult.success) {
    throw new ValidationError('Invalid block height');
  }
  const height = heightResult.data;

  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

  const header = await client.getBlockHeader(height);

  res.json(header);
}));

export default router;
