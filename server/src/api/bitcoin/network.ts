/**
 * Bitcoin - Network Router
 *
 * Network status, mempool data, and block information
 */

import { Router, Request, Response } from 'express';
import * as blockchain from '../../services/bitcoin/blockchain';
import { getElectrumClient } from '../../services/bitcoin/electrum';
import { getElectrumPoolAsync } from '../../services/bitcoin/electrumPool';
import type { PooledConnectionHandle } from '../../services/bitcoin/electrumPool/types';
import * as mempool from '../../services/bitcoin/mempool';
import { db as prisma } from '../../repositories/db';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { asyncHandler } from '../../errors/errorHandler';
import { ValidationError } from '../../errors/ApiError';
import { DEFAULT_CONFIRMATION_THRESHOLD, DEFAULT_DEEP_CONFIRMATION_THRESHOLD } from '../../constants';
import { safeJsonParse, SystemSettingSchemas } from '../../utils/safeJson';

const router = Router();
const log = createLogger('BITCOIN_NETWORK:ROUTE');

// Simple cache for mempool data to avoid hammering external APIs
let mempoolCache: { data: Awaited<ReturnType<typeof mempool.getBlocksAndMempool>>; timestamp: number; } | null = null;
const MEMPOOL_CACHE_TTL = 15000; // 15 seconds
const MEMPOOL_STALE_TTL = 300000; // 5 minutes for stale fallback

/**
 * GET /api/v1/bitcoin/status
 * Get Bitcoin network status
 *
 * NOTE: Intentionally keeps try/catch for graceful degradation -
 * returns { connected: false } instead of a 500 error.
 */
router.get('/status', async (_req: Request, res: Response) => {
  try {
    // Get the node config first to determine connection strategy
    const nodeConfig = await prisma.nodeConfig.findFirst({
      where: { isDefault: true },
    });

    let version: { server: string; protocol: string } | null = null;
    let blockHeight: number | undefined;
    let poolStats = null;
    // Use per-network settings if available, otherwise fall back to legacy pool settings
    let effectiveMin = nodeConfig?.mainnetPoolMin ?? nodeConfig?.poolMinConnections;
    let effectiveMax = nodeConfig?.mainnetPoolMax ?? nodeConfig?.poolMaxConnections;
    let poolHandle: PooledConnectionHandle | null = null;

    // Try to use pool first if enabled and initialized
    // Check both legacy poolEnabled flag and per-network mainnetMode
    const usePool = nodeConfig?.poolEnabled || nodeConfig?.mainnetMode === 'pool';
    if (nodeConfig?.type === 'electrum' && usePool) {
      try {
        const pool = await getElectrumPoolAsync();
        if (pool.isPoolInitialized()) {
          poolStats = pool.getPoolStats();
          effectiveMin = pool.getEffectiveMinConnections();
          effectiveMax = pool.getEffectiveMaxConnections();

          // If pool has healthy connections, use one for status
          if (poolStats.idleConnections > 0 || poolStats.activeConnections > 0) {
            poolHandle = await pool.acquire({ purpose: 'status', timeoutMs: 5000 });
            const [ver, height] = await Promise.all([
              poolHandle.client.getServerVersion(),
              poolHandle.client.getBlockHeight(),
            ]);
            version = ver;
            blockHeight = height;
          }
        }
      } catch (poolError) {
        // Pool failed, will fall back to singleton
        log.debug('Pool status check failed, falling back to singleton', { error: String(poolError) });
      } finally {
        if (poolHandle) {
          poolHandle.release();
        }
      }
    }

    // Fall back to singleton client if pool didn't provide status
    if (!version) {
      const client = getElectrumClient();
      if (!client.isConnected()) {
        await client.connect();
      }
      const [ver, height] = await Promise.all([
        client.getServerVersion(),
        blockchain.getBlockHeight(),
      ]);
      version = ver;
      blockHeight = height;
    }

    // Get confirmation threshold settings
    const [thresholdSetting, deepThresholdSetting] = await Promise.all([
      prisma.systemSetting.findUnique({ where: { key: 'confirmationThreshold' } }),
      prisma.systemSetting.findUnique({ where: { key: 'deepConfirmationThreshold' } }),
    ]);
    const confirmationThreshold = safeJsonParse(
      thresholdSetting?.value,
      SystemSettingSchemas.number,
      DEFAULT_CONFIRMATION_THRESHOLD,
      'confirmationThreshold'
    );
    const deepConfirmationThreshold = safeJsonParse(
      deepThresholdSetting?.value,
      SystemSettingSchemas.number,
      DEFAULT_DEEP_CONFIRMATION_THRESHOLD,
      'deepConfirmationThreshold'
    );

    res.json({
      connected: true,
      server: version.server,
      protocol: version.protocol,
      blockHeight,
      network: 'mainnet',
      explorerUrl: nodeConfig?.explorerUrl || 'https://mempool.space',
      confirmationThreshold,
      deepConfirmationThreshold,
      // Pool status (Electrum only) - no infrastructure details exposed
      pool: nodeConfig?.type === 'electrum' ? {
        enabled: nodeConfig.poolEnabled,
        stats: poolStats,
      } : null,
    });
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
router.get('/mempool', async (_req: Request, res: Response) => {
  const now = Date.now();

  // Return fresh cache if available
  if (mempoolCache && (now - mempoolCache.timestamp) < MEMPOOL_CACHE_TTL) {
    return res.json(mempoolCache.data);
  }

  try {
    const data = await mempool.getBlocksAndMempool();
    mempoolCache = { data, timestamp: now };
    res.json(data);
  } catch (error) {
    log.error('Get mempool error', { error: String(error) });

    // Return stale cache if available (better than 500)
    if (mempoolCache && (now - mempoolCache.timestamp) < MEMPOOL_STALE_TTL) {
      log.warn('Returning stale mempool cache due to fetch failure');
      return res.json({ ...mempoolCache.data, stale: true });
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
router.get('/blocks/recent', asyncHandler(async (req: Request, res: Response) => {
  const count = parseInt(req.query.count as string, 10) || 10;
  const blocks = await mempool.getRecentBlocks(count);

  res.json(blocks);
}));

/**
 * GET /api/v1/bitcoin/block/:height
 * Get block information
 */
router.get('/block/:height', asyncHandler(async (req: Request, res: Response) => {
  const height = parseInt(req.params.height, 10);

  if (isNaN(height) || height < 0) {
    throw new ValidationError('Invalid block height');
  }

  const client = getElectrumClient();

  if (!client.isConnected()) {
    await client.connect();
  }

  const header = await client.getBlockHeader(height);

  res.json(header);
}));

export default router;
