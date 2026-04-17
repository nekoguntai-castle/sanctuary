/**
 * Admin Infrastructure Router
 *
 * Endpoints for Tor container, cache metrics, WebSocket stats, and dead letter queue (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import { InvalidInputError, NotFoundError } from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { cache } from '../../services/cache';
import { deadLetterQueue, type DeadLetterCategory } from '../../services/deadLetterQueue';
import { getSyncService } from '../../services/syncService';
import { getWebSocketServer, getRateLimitEvents } from '../../websocket/server';
import { getErrorMessage } from '../../utils/errors';
import * as docker from '../../utils/docker';

const router = Router();
const log = createLogger('ADMIN_INFRA:ROUTE');

// ========================================
// TOR CONTAINER MANAGEMENT
// ========================================

/**
 * GET /api/v1/admin/tor-container/status
 * Get the status of the bundled Tor container
 */
router.get('/tor-container/status', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const proxyAvailable = await docker.isDockerProxyAvailable();

  if (!proxyAvailable) {
    return res.json({
      available: false,
      exists: false,
      running: false,
      message: 'Docker management not available',
    });
  }

  const status = await docker.getTorStatus();

  res.json({
    available: true,
    ...status,
  });
}));

/**
 * POST /api/v1/admin/tor-container/start
 * Start the bundled Tor container
 */
router.post('/tor-container/start', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const result = await docker.startTor();

  if (!result.success) {
    return res.status(400).json({
      error: 'Failed to start',
      message: result.message,
    });
  }

  res.json(result);
}));

/**
 * POST /api/v1/admin/tor-container/stop
 * Stop the bundled Tor container
 */
router.post('/tor-container/stop', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const result = await docker.stopTor();

  if (!result.success) {
    return res.status(400).json({
      error: 'Failed to stop',
      message: result.message,
    });
  }

  res.json(result);
}));

// ========================================
// CACHE METRICS
// ========================================

/**
 * GET /api/v1/admin/metrics/cache
 * Get cache statistics for monitoring
 */
router.get('/metrics/cache', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const stats = cache.getStats();
  const total = stats.hits + stats.misses;

  res.json({
    timestamp: new Date().toISOString(),
    stats,
    hitRate: total > 0
      ? ((stats.hits / total) * 100).toFixed(1) + '%'
      : 'N/A',
  });
}));

// ========================================
// WEBSOCKET STATS
// ========================================

/**
 * GET /api/v1/admin/websocket/stats
 * Get WebSocket server statistics and rate limit configuration
 */
router.get('/websocket/stats', authenticate, requireAdmin, asyncHandler(async (_req, res) => {
  const wsServer = getWebSocketServer();
  const stats = wsServer.getStats();

  res.json({
    connections: {
      current: stats.clients,
      max: stats.maxClients,
      uniqueUsers: stats.uniqueUsers,
      maxPerUser: stats.maxPerUser,
    },
    subscriptions: {
      total: stats.subscriptions,
      channels: stats.channels,
      channelList: stats.channelList,
    },
    rateLimits: stats.rateLimits,
    recentRateLimitEvents: getRateLimitEvents(),
  });
}));

// ========================================
// DEAD LETTER QUEUE
// ========================================

/**
 * GET /api/v1/admin/dlq
 * Get dead letter queue entries and statistics
 */
router.get('/dlq', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const category = req.query.category as DeadLetterCategory | undefined;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  const stats = deadLetterQueue.getStats();
  const entries = category
    ? deadLetterQueue.getByCategory(category)
    : deadLetterQueue.getAll(limit);

  res.json({
    stats,
    entries: entries.map((e) => ({
      ...e,
      // Truncate long error stacks for API response
      errorStack: e.errorStack?.substring(0, 500),
    })),
  });
}));

/**
 * DELETE /api/v1/admin/dlq/:id
 * Remove a specific dead letter entry
 */
router.delete('/dlq/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const removed = await deadLetterQueue.remove(id);

  if (removed) {
    log.info('DLQ entry removed', { id, admin: req.user?.username });
    res.json({ success: true });
  } else {
    throw new NotFoundError('Dead letter entry not found');
  }
}));

/**
 * POST /api/v1/admin/dlq/:id/retry
 * Re-attempt a dead letter entry by dispatching it to the appropriate subsystem
 */
router.post('/dlq/:id/retry', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const entry = await deadLetterQueue.dequeueForRetry(req.params.id);
  if (!entry) {
    throw new NotFoundError('Dead letter entry not found');
  }

  let retryResult: { success: boolean; message: string };
  try {
    switch (entry.category) {
      case 'sync': {
        const walletId = entry.payload.walletId as string | undefined;
        if (walletId) {
          getSyncService().queueSync(walletId, 'normal');
          retryResult = { success: true, message: `Queued wallet sync for ${walletId}` };
        } else {
          retryResult = { success: false, message: 'Missing walletId in payload' };
        }
        break;
      }
      default:
        retryResult = { success: false, message: `Retry not implemented for category: ${entry.category}` };
    }
  } catch (error) {
    // Re-add to DLQ on dispatch failure with incremented attempt count
    await deadLetterQueue.add(
      entry.category,
      entry.operation,
      entry.payload,
      /* v8 ignore next -- caught errors are Error instances in current dispatchers */
      error instanceof Error ? error : String(error),
      entry.attempts + 1,
      entry.metadata,
    );
    log.error('DLQ retry dispatch failed, re-added to queue', {
      id: entry.id,
      category: entry.category,
      error: getErrorMessage(error),
    });
    return res.status(500).json({
      error: 'Internal Server Error',
      message: 'Retry dispatch failed — entry re-added to DLQ',
    });
  }

  log.info('DLQ retry attempted', {
    id: entry.id,
    category: entry.category,
    ...retryResult,
    admin: req.user?.username,
  });
  res.json({
    entry: { id: entry.id, category: entry.category, operation: entry.operation },
    retry: retryResult,
  });
}));

/**
 * DELETE /api/v1/admin/dlq/category/:category
 * Clear all entries for a specific category
 */
router.delete('/dlq/category/:category', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const category = req.params.category as DeadLetterCategory;
  const validCategories: DeadLetterCategory[] = [
    'sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other',
  ];

  if (!validCategories.includes(category)) {
    throw new InvalidInputError(`Invalid category. Valid categories: ${validCategories.join(', ')}`);
  }

  const count = await deadLetterQueue.clearCategory(category);
  log.info('DLQ category cleared', { category, count, admin: req.user?.username });

  res.json({ success: true, removed: count });
}));

export default router;
