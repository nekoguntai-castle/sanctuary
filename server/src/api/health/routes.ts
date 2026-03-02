/**
 * Health Check Routes
 *
 * Express router for health check endpoints.
 */

import { Router, Request, Response } from 'express';
import { circuitBreakerRegistry } from '../../services/circuitBreaker';
import type { ComponentHealth, HealthStatus, HealthResponse } from './types';
import { checkDatabase, checkDiskSpace, checkMemory } from './systemChecks';
import { checkElectrum, checkWebSocket, checkSync, checkRedis, checkJobQueue } from './serviceChecks';
import { checkCircuitBreakers, checkCacheInvalidation, checkStartup } from './infrastructureChecks';

const router = Router();

const startTime = Date.now();

/**
 * Determine overall status from component statuses
 */
function determineOverallStatus(components: Record<string, ComponentHealth>): HealthStatus {
  const statuses = Object.values(components).map(c => c.status);

  // Database unhealthy = overall unhealthy
  if (components.database?.status === 'unhealthy') {
    return 'unhealthy';
  }

  if (components.redis?.status === 'unhealthy') {
    return 'unhealthy';
  }

  // Any unhealthy = overall degraded (unless database)
  if (statuses.includes('unhealthy')) {
    return 'degraded';
  }

  // Any degraded = overall degraded
  if (statuses.includes('degraded')) {
    return 'degraded';
  }

  return 'healthy';
}

/**
 * GET /api/v1/health
 * Comprehensive health check
 */
router.get('/', async (req: Request, res: Response) => {
  const components = {
    database: await checkDatabase(),
    redis: await checkRedis(),
    electrum: checkElectrum(),
    websocket: checkWebSocket(),
    sync: checkSync(),
    jobQueue: await checkJobQueue(),
    cacheInvalidation: checkCacheInvalidation(),
    startup: checkStartup(),
    circuitBreakers: checkCircuitBreakers(),
    memory: checkMemory(),
    disk: await checkDiskSpace(),
  };

  const status = determineOverallStatus(components);

  const response: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
    version: process.env.npm_package_version || '0.0.0',
    components,
  };

  // Return 503 for unhealthy, 200 for healthy/degraded
  const httpStatus = status === 'unhealthy' ? 503 : 200;
  res.status(httpStatus).json(response);
});

/**
 * GET /api/v1/health/live
 * Kubernetes liveness probe - just checks if server is responding
 */
router.get('/live', (req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});

/**
 * GET /api/v1/health/ready
 * Kubernetes readiness probe - checks if ready to accept traffic
 */
router.get('/ready', async (req: Request, res: Response) => {
  const dbHealth = await checkDatabase();

  if (dbHealth.status === 'unhealthy') {
    return res.status(503).json({
      status: 'not ready',
      reason: 'Database unavailable',
    });
  }

  res.status(200).json({ status: 'ready' });
});

/**
 * GET /api/v1/health/circuits
 * Detailed circuit breaker status
 */
router.get('/circuits', (req: Request, res: Response) => {
  const breakers = circuitBreakerRegistry.getAllHealth();
  res.json({
    overall: circuitBreakerRegistry.getOverallStatus(),
    circuits: breakers,
  });
});

export default router;
