/**
 * Health Checker
 *
 * Per-server health checks, latency tracking, and health history management
 * for the Electrum connection pool.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { db as prisma } from '../../../repositories/db';
import {
  electrumPoolHealthCheckFailures,
} from '../../../observability/metrics';
import type {
  PooledConnection,
  ServerState,
  HealthCheckResult,
  NetworkType,
} from './types';
import { MAX_HEALTH_HISTORY } from './types';

const log = createLogger('ELECTRUM_POOL:HEALTH');

/**
 * Record a health check result to a server's history
 */
export function recordHealthCheckResult(
  serverStats: Map<string, ServerState>,
  serverId: string,
  success: boolean,
  latencyMs?: number,
  error?: string,
): void {
  const stats = serverStats.get(serverId);
  if (!stats) return;

  const result: HealthCheckResult = {
    timestamp: new Date(),
    success,
    latencyMs,
    error: error ? error.substring(0, 200) : undefined, // Limit error message length
  };

  // Add to front of array (most recent first)
  stats.healthHistory.unshift(result);

  // Trim to max length
  if (stats.healthHistory.length > MAX_HEALTH_HISTORY) {
    stats.healthHistory = stats.healthHistory.slice(0, MAX_HEALTH_HISTORY);
  }
}

/**
 * Mark a server as healthy or unhealthy in the database
 */
export async function updateServerHealthInDb(
  serverId: string,
  isHealthy: boolean,
  failCount?: number,
  errorMessage?: string,
): Promise<void> {
  try {
    await prisma.electrumServer.update({
      where: { id: serverId },
      data: {
        isHealthy,
        lastHealthCheck: new Date(),
        lastHealthCheckError: isHealthy ? null : (errorMessage || null),
        ...(failCount !== undefined ? { healthCheckFails: failCount } : {}),
      },
    });
  } catch (error) {
    // Don't log loudly - this is a background operation
    log.debug(`Failed to update server health in db: ${error}`);
  }
}

/**
 * Perform health checks on all pool connections.
 * Returns a map of serverId -> { success, fail, latencyMs } aggregations.
 */
export async function performConnectionHealthChecks(
  connections: Map<string, PooledConnection>,
  network: NetworkType,
  stats: { healthCheckFailures: number },
  reconnectConnection: (conn: PooledConnection) => Promise<void>,
  handleConnectionError: (conn: PooledConnection) => Promise<void>,
): Promise<Map<string, { success: number; fail: number; latencyMs?: number }>> {
  const serverHealthResults = new Map<string, { success: number; fail: number; latencyMs?: number }>();
  // Snapshot entries so connection map mutations during health handling
  // do not affect this cycle's per-server aggregation.
  const connectionsToCheck = Array.from(connections.entries());

  for (const [id, conn] of connectionsToCheck) {
    if (conn.state === 'idle' || (conn.state === 'active' && conn.isDedicated)) {
      // Initialize server tracking
      if (!serverHealthResults.has(conn.serverId)) {
        serverHealthResults.set(conn.serverId, { success: 0, fail: 0 });
      }

      const startTime = Date.now();
      try {
        if (!conn.client.isConnected()) {
          throw new Error('Connection not connected');
        }
        // Lightweight health check
        await conn.client.getBlockHeight();
        const latencyMs = Date.now() - startTime;
        conn.lastHealthCheck = new Date();

        // Track success for this server
        const serverResult = serverHealthResults.get(conn.serverId)!;
        serverResult.success++;
        serverResult.latencyMs = latencyMs;
      } catch (error) {
        stats.healthCheckFailures++;
        electrumPoolHealthCheckFailures.inc({ network });
        const errorStr = getErrorMessage(error);
        log.warn(`Health check failed for connection ${id} (${conn.serverLabel})`, { error: errorStr });

        // Track failure for this server
        const serverResult = serverHealthResults.get(conn.serverId)!;
        serverResult.fail++;

        if (conn.isDedicated) {
          // For dedicated connection, try to reconnect
          await reconnectConnection(conn);
        } else {
          await handleConnectionError(conn);
        }
      }
    }
  }

  return serverHealthResults;
}

/**
 * Send keepalive pings to idle connections to prevent server-side timeouts.
 * Some servers (like BlueWallet) drop idle TCP connections after ~30 seconds.
 */
export async function sendKeepalives(
  connections: Map<string, PooledConnection>,
  isShuttingDown: boolean,
): Promise<void> {
  if (isShuttingDown) return;

  for (const [id, conn] of connections) {
    // Only ping idle, non-dedicated connections
    if (conn.state === 'idle' && !conn.isDedicated) {
      try {
        if (conn.client.isConnected()) {
          await conn.client.ping();
          log.debug(`Keepalive ping sent to ${conn.serverLabel}`);
        }
      } catch (error) {
        log.debug(`Keepalive ping failed for ${id} (${conn.serverLabel}): ${error}`);
        // Don't handle errors here - the health check will catch dead connections
      }
    }
  }
}
