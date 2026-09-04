/**
 * Small pure helpers for the Electrum pool's health-check cycle and
 * effective-capacity math, extracted from electrumPool.ts to keep that file
 * under the large-file budget. No behaviour change: these mirror exactly
 * what the pool class used to do inline.
 */

import { createLogger } from '../../../utils/logger';
import type { ElectrumPoolConfig, ServerState, LoadBalancingStrategy } from './types';
import { recordHealthCheckResult, updateServerHealthInDb } from './healthChecker';

const log = createLogger('ELECTRUM_POOL:SVC_HEALTH_CYCLE');

/**
 * Get effective minimum connections (at least 1 per server)
 * This ensures even distribution across all configured servers at startup.
 */
export function getEffectiveMinConnections(config: ElectrumPoolConfig, serverCount: number): number {
  if (serverCount === 0) return config.minConnections;
  return Math.max(config.minConnections, serverCount);
}

/**
 * Get effective maximum connections (at least 1 per server)
 * This ensures the pool can maintain at least 1 connection per server.
 */
export function getEffectiveMaxConnections(config: ElectrumPoolConfig, serverCount: number): number {
  if (serverCount === 0) return config.maxConnections;
  return Math.max(config.maxConnections, serverCount);
}

/**
 * Read-only snapshot of the live operational configuration, for the
 * status projector.
 */
export function getOperationalConfigSnapshot(config: ElectrumPoolConfig): {
  loadBalancing: LoadBalancingStrategy;
  healthCheckIntervalMs: number;
  enabled: boolean;
} {
  return {
    loadBalancing: config.loadBalancing,
    healthCheckIntervalMs: config.healthCheckIntervalMs,
    enabled: config.enabled,
  };
}

/**
 * Update per-server health stats and the database after a health-check
 * cycle. Mirrors performHealthChecks' second pass exactly: marks each
 * server healthy/unhealthy based on that cycle's connection results,
 * records success/failure for backoff, and persists to the DB
 * (fire-and-forget, as before).
 */
export function applyHealthCheckResults(
  serverHealthResults: Map<string, { success: number; fail: number; latencyMs?: number }>,
  serverStats: Map<string, ServerState>,
  recordServerFailure: (serverId: string, errorType: 'timeout' | 'error' | 'disconnect') => void,
  recordServerSuccess: (serverId: string) => void,
): void {
  for (const [serverId, results] of serverHealthResults) {
    const stats = serverStats.get(serverId);
    if (!stats) continue;

    stats.lastHealthCheck = new Date();

    // If all connections to this server failed, mark unhealthy and record failure
    if (results.fail > 0 && results.success === 0) {
      stats.isHealthy = false;
      // Record failure for backoff (once per server per cycle, not per connection)
      recordServerFailure(serverId, 'error');
      // Update database (fire and forget)
      updateServerHealthInDb(serverId, false, stats.consecutiveFailures);
      log.warn(`Server ${serverId} marked unhealthy after all connections failed health check`);
    } else {
      // At least one success - mark healthy and record success
      stats.isHealthy = true;
      // Record success for backoff recovery (once per server per cycle, not per connection)
      recordServerSuccess(serverId);
      updateServerHealthInDb(serverId, true, 0);
    }
  }
}

/**
 * Record health-check results into serverStats (only the first
 * success/failure per server per cycle). Split out of performHealthChecks'
 * first pass purely to shrink electrumPool.ts; behaviour is unchanged.
 */
export function recordHealthCheckResultsForCycle(
  serverHealthResults: Map<string, { success: number; fail: number; latencyMs?: number }>,
  serverStats: Map<string, ServerState>,
): void {
  for (const [serverId, results] of serverHealthResults) {
    /* v8 ignore start -- aggregate branch details are covered in healthChecker helper tests */
    if (results.success > 0 && results.fail === 0) {
      recordHealthCheckResult(serverStats, serverId, true, results.latencyMs);
    } else if (results.fail > 0 && results.success === 0) {
      recordHealthCheckResult(serverStats, serverId, false, results.latencyMs);
    }
    /* v8 ignore stop */
  }
}
