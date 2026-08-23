/**
 * Admin Infrastructure Router
 *
 * Endpoints for Tor container, cache metrics, WebSocket stats, and dead letter queue (admin only)
 */

import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import { asyncHandler } from '../../errors/errorHandler';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  ServiceUnavailableError,
} from '../../errors/ApiError';
import { createLogger } from '../../utils/logger';
import { cache } from '../../services/cache';
import { deadLetterQueue, type DeadLetterCategory } from '../../services/deadLetterQueue';
import { retryDeadLetterSyncJob } from '../../services/sync/syncDeadLetterRetryAdmission';
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

  const { stats, entries } = await deadLetterQueue.getSnapshot({
    category,
    limit,
  });

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
  const claimResult = await deadLetterQueue.claimForRetry(req.params.id);
  if (claimResult.status === 'missing') {
    throw new NotFoundError('Dead letter entry not found');
  }
  if (claimResult.status === 'busy') {
    throw new ConflictError('Dead letter entry is already being retried');
  }
  const { entry, token } = claimResult.claim;
  if (!entry.job) {
    await deadLetterQueue.releaseRetry(entry.id, token);
    throw new InvalidInputError('Dead letter entry is not a retriable worker job');
  }
  let accepted = false;
  try {
    accepted = await retryDeadLetterSyncJob(entry.job, entry.id);
  } catch (error) {
    await deadLetterQueue.releaseRetry(entry.id, token);
    log.error('DLQ retry dispatch failed', {
      id: entry.id,
      category: entry.category,
      error: getErrorMessage(error),
    });
    throw error;
  }
  if (!accepted) {
    await deadLetterQueue.releaseRetry(entry.id, token);
    throw new ServiceUnavailableError('Worker queue rejected the retry job');
  }
  if (!await deadLetterQueue.acknowledgeRetry(entry.id, token)) {
    throw new ServiceUnavailableError(
      'Retry was accepted but dead letter acknowledgement was not recorded',
    );
  }
  log.info('DLQ retry accepted', {
    id: entry.id,
    category: entry.category,
    admin: req.user?.username,
  });
  res.json({
    entry: { id: entry.id, category: entry.category, operation: entry.operation },
    retry: { success: true, message: 'Worker retry accepted' },
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
