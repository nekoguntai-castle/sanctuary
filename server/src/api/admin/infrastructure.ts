/**
 * Admin Infrastructure Router
 *
 * Endpoints for Tor container, cache metrics, WebSocket stats, and dead letter queue (admin only)
 */

import { Router, Request, Response } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { createLogger } from '../../utils/logger';
import { cache } from '../../services/cache';
import { deadLetterQueue, type DeadLetterCategory } from '../../services/deadLetterQueue';
import { getSyncService } from '../../services/syncService';
import { getWebSocketServer, getRateLimitEvents } from '../../websocket/server';
import { getErrorMessage } from '../../utils/errors';
import * as docker from '../../utils/docker';

const router = Router();
const log = createLogger('ADMIN:INFRA');

// ========================================
// TOR CONTAINER MANAGEMENT
// ========================================

/**
 * GET /api/v1/admin/tor-container/status
 * Get the status of the bundled Tor container
 */
router.get('/tor-container/status', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get Tor container status failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get Tor container status',
    });
  }
});

/**
 * POST /api/v1/admin/tor-container/start
 * Start the bundled Tor container
 */
router.post('/tor-container/start', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await docker.startTor();

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to start',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Start Tor container failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to start Tor container',
    });
  }
});

/**
 * POST /api/v1/admin/tor-container/stop
 * Stop the bundled Tor container
 */
router.post('/tor-container/stop', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const result = await docker.stopTor();

    if (!result.success) {
      return res.status(400).json({
        error: 'Failed to stop',
        message: result.message,
      });
    }

    res.json(result);
  } catch (error) {
    log.error('Stop Tor container failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to stop Tor container',
    });
  }
});

// ========================================
// CACHE METRICS
// ========================================

/**
 * GET /api/v1/admin/metrics/cache
 * Get cache statistics for monitoring
 */
router.get('/metrics/cache', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const stats = cache.getStats();
    const total = stats.hits + stats.misses;

    res.json({
      timestamp: new Date().toISOString(),
      stats,
      hitRate: total > 0
        ? ((stats.hits / total) * 100).toFixed(1) + '%'
        : 'N/A',
    });
  } catch (error) {
    log.error('Get cache metrics failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get cache metrics',
    });
  }
});

// ========================================
// WEBSOCKET STATS
// ========================================

/**
 * GET /api/v1/admin/websocket/stats
 * Get WebSocket server statistics and rate limit configuration
 */
router.get('/websocket/stats', authenticate, requireAdmin, async (_req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get WebSocket stats failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get WebSocket statistics',
    });
  }
});

// ========================================
// DEAD LETTER QUEUE
// ========================================

/**
 * GET /api/v1/admin/dlq
 * Get dead letter queue entries and statistics
 */
router.get('/dlq', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
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
  } catch (error) {
    log.error('Get DLQ failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to get dead letter queue',
    });
  }
});

/**
 * DELETE /api/v1/admin/dlq/:id
 * Remove a specific dead letter entry
 */
router.delete('/dlq/:id', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const removed = await deadLetterQueue.remove(id);

    if (removed) {
      log.info('DLQ entry removed', { id, admin: req.user?.username });
      res.json({ success: true });
    } else {
      res.status(404).json({
        error: 'Not Found',
        message: 'Dead letter entry not found',
      });
    }
  } catch (error) {
    log.error('Delete DLQ entry failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to delete dead letter entry',
    });
  }
});

/**
 * POST /api/v1/admin/dlq/:id/retry
 * Re-attempt a dead letter entry by dispatching it to the appropriate subsystem
 */
router.post('/dlq/:id/retry', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const entry = await deadLetterQueue.dequeueForRetry(req.params.id);
    if (!entry) {
      return res.status(404).json({
        error: 'Not Found',
        message: 'Dead letter entry not found',
      });
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
  } catch (error) {
    log.error('DLQ retry failed', { error: getErrorMessage(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to retry dead letter entry',
    });
  }
});

/**
 * DELETE /api/v1/admin/dlq/category/:category
 * Clear all entries for a specific category
 */
router.delete('/dlq/category/:category', authenticate, requireAdmin, async (req: Request, res: Response) => {
  try {
    const category = req.params.category as DeadLetterCategory;
    const validCategories: DeadLetterCategory[] = [
      'sync', 'push', 'telegram', 'notification', 'electrum', 'transaction', 'other',
    ];

    if (!validCategories.includes(category)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid category. Valid categories: ${validCategories.join(', ')}`,
      });
    }

    const count = await deadLetterQueue.clearCategory(category);
    log.info('DLQ category cleared', { category, count, admin: req.user?.username });

    res.json({ success: true, removed: count });
  } catch (error) {
    log.error('Clear DLQ category failed', { error: String(error) });
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Failed to clear dead letter category',
    });
  }
});

export default router;
