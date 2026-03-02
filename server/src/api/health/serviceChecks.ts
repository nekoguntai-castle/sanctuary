/**
 * Service Health Checks
 *
 * Checks for Electrum, WebSocket, sync, Redis, and job queue services.
 */

import { circuitBreakerRegistry } from '../../services/circuitBreaker';
import { getSyncService } from '../../services/syncService';
import { getWebSocketServer } from '../../websocket/server';
import { createLogger } from '../../utils/logger';
import { getErrorMessage } from '../../utils/errors';
import { checkRedisHealth } from '../../infrastructure/redis';
import { jobQueue } from '../../jobs';
import type { ComponentHealth } from './types';

const log = createLogger('HEALTH');

/**
 * Check Electrum/blockchain service status
 */
export function checkElectrum(): ComponentHealth {
  const breakers = circuitBreakerRegistry.getAllHealth();
  const electrumBreaker = breakers.find(b => b.name.includes('electrum'));

  if (!electrumBreaker) {
    return {
      status: 'healthy',
      message: 'No circuit breaker registered',
    };
  }

  if (electrumBreaker.state === 'open') {
    return {
      status: 'unhealthy',
      message: 'Circuit open - service unavailable',
      details: {
        failures: electrumBreaker.failures,
        lastFailure: electrumBreaker.lastFailure,
      },
    };
  }

  if (electrumBreaker.state === 'half-open') {
    return {
      status: 'degraded',
      message: 'Circuit half-open - recovering',
      details: {
        successes: electrumBreaker.successes,
      },
    };
  }

  return {
    status: 'healthy',
    details: {
      totalRequests: electrumBreaker.totalRequests,
      lastSuccess: electrumBreaker.lastSuccess,
    },
  };
}

/**
 * Check WebSocket server status
 */
export function checkWebSocket(): ComponentHealth {
  try {
    const wsServer = getWebSocketServer();
    if (!wsServer) {
      return {
        status: 'degraded',
        message: 'WebSocket server not initialized',
      };
    }

    const stats = wsServer.getStats();
    return {
      status: 'healthy',
      details: {
        connections: stats.clients,
        maxConnections: stats.maxClients,
        subscriptions: stats.subscriptions,
        uniqueUsers: stats.uniqueUsers,
      },
    };
  } catch {
    return {
      status: 'degraded',
      message: 'WebSocket stats unavailable',
    };
  }
}

/**
 * Check sync service status
 */
export function checkSync(): ComponentHealth {
  try {
    const syncService = getSyncService();
    const metrics = syncService.getHealthMetrics();

    if (!metrics.isRunning) {
      return {
        status: 'degraded',
        message: 'Sync service not running',
      };
    }

    // Check if there are stalled jobs
    const hasStalled = metrics.queueLength > 10 && metrics.activeSyncs === 0;
    if (hasStalled) {
      return {
        status: 'degraded',
        message: 'Sync queue appears stalled',
        details: { ...metrics },
      };
    }

    return {
      status: 'healthy',
      details: {
        queueLength: metrics.queueLength,
        activeSyncs: metrics.activeSyncs,
        subscribedAddresses: metrics.subscribedAddresses,
        subscriptionsEnabled: metrics.subscriptionsEnabled,
        subscriptionOwnership: metrics.subscriptionOwnership,
      },
    };
  } catch {
    return {
      status: 'degraded',
      message: 'Sync stats unavailable',
    };
  }
}

/**
 * Check Redis status
 */
export async function checkRedis(): Promise<ComponentHealth> {
  const redisHealth = await checkRedisHealth();

  if (redisHealth.status === 'healthy') {
    return {
      status: 'healthy',
      latency: redisHealth.latencyMs,
    };
  }

  return {
    status: redisHealth.status === 'degraded' ? 'degraded' : 'unhealthy',
    message: redisHealth.error,
    latency: redisHealth.latencyMs,
  };
}

/**
 * Check job queue status
 *
 * In the worker-owned architecture, the API process does not initialize
 * the job queue locally — only the worker process does. When the queue
 * is not available in this process, report it as not applicable rather
 * than unhealthy, to avoid false degraded status on health checks.
 */
export async function checkJobQueue(): Promise<ComponentHealth> {
  try {
    const hasIsAvailable = typeof (jobQueue as { isAvailable?: unknown }).isAvailable === 'function';
    const queueAvailable = hasIsAvailable ? jobQueue.isAvailable() : false;

    if (!queueAvailable) {
      return {
        status: 'healthy',
        message: 'Job queue runs in worker process',
        details: { process: 'api', queueLocal: false },
      };
    }

    if (typeof (jobQueue as { getHealth?: unknown }).getHealth !== 'function') {
      return {
        status: 'degraded',
        message: 'Job queue health unavailable',
        details: { process: 'api', queueLocal: true },
      };
    }

    const health = await jobQueue.getHealth();
    const status = health.healthy ? 'healthy' : 'unhealthy';

    return {
      status,
      details: {
        queueName: health.queueName,
        waiting: health.waiting,
        active: health.active,
        completed: health.completed,
        failed: health.failed,
        delayed: health.delayed,
        paused: health.paused,
      },
    };
  } catch (error) {
    log.warn('Job queue health check unavailable', {
      error: getErrorMessage(error, 'Unknown job queue error'),
    });

    return {
      status: 'degraded',
      message: 'Job queue health check unavailable',
    };
  }
}
