/**
 * Infrastructure Health Checks
 *
 * Checks for circuit breakers, cache invalidation, and startup status.
 */

import { circuitBreakerRegistry } from '../../services/circuitBreaker';
import { getCacheInvalidationStatus } from '../../services/cacheInvalidation';
import { getStartupStatus } from '../../services/startupManager';
import type { ComponentHealth } from './types';

/**
 * Check all circuit breakers
 */
export function checkCircuitBreakers(): ComponentHealth {
  const breakers = circuitBreakerRegistry.getAllHealth();

  if (breakers.length === 0) {
    return {
      status: 'healthy',
      message: 'No circuit breakers registered',
    };
  }

  const openBreakers = breakers.filter(b => b.state === 'open');
  const halfOpenBreakers = breakers.filter(b => b.state === 'half-open');

  if (openBreakers.length === breakers.length) {
    return {
      status: 'unhealthy',
      message: `All ${breakers.length} circuits open`,
      details: { breakers: breakers.map(b => ({ name: b.name, state: b.state })) },
    };
  }

  if (openBreakers.length > 0) {
    return {
      status: 'degraded',
      message: `${openBreakers.length}/${breakers.length} circuits open`,
      details: { breakers: breakers.map(b => ({ name: b.name, state: b.state })) },
    };
  }

  if (halfOpenBreakers.length > 0) {
    return {
      status: 'degraded',
      message: `${halfOpenBreakers.length}/${breakers.length} circuits recovering`,
      details: { breakers: breakers.map(b => ({ name: b.name, state: b.state })) },
    };
  }

  return {
    status: 'healthy',
    details: {
      total: breakers.length,
      healthy: breakers.filter(b => b.state === 'closed').length,
    },
  };
}

/**
 * Check cache invalidation status
 */
export function checkCacheInvalidation(): ComponentHealth {
  const status = getCacheInvalidationStatus();

  if (!status.initialized) {
    return {
      status: 'degraded',
      message: 'Cache invalidation not initialized',
      details: status,
    };
  }

  return {
    status: 'healthy',
    details: status,
  };
}

/**
 * Check startup manager status
 */
export function checkStartup(): ComponentHealth {
  const status = getStartupStatus();

  if (!status.started) {
    return {
      status: 'degraded',
      message: 'Startup not initiated',
      details: status,
    };
  }

  if (!status.overallSuccess) {
    return {
      status: 'unhealthy',
      message: 'Startup failed for one or more services',
      details: status,
    };
  }

  const hasDegraded = status.services.some(service => service.degraded);
  if (hasDegraded) {
    return {
      status: 'degraded',
      message: 'One or more services running in degraded mode',
      details: status,
    };
  }

  return {
    status: 'healthy',
    details: status,
  };
}
