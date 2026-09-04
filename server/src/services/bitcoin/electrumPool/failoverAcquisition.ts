/**
 * Failover-target acquisition helpers for the Electrum pool.
 *
 * Under the `failover_only` load-balancing strategy, acquisition prefers
 * capacity on the current eligible primary over an idle backup socket, and
 * reroutes around a failed primary rather than starving requests until the
 * next periodic health check catches up. These functions are pure/callback
 * driven so they can be unit tested without a live ElectrumPool instance.
 */

import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type {
  ServerConfig,
  ServerState,
  PooledConnection,
  PooledConnectionHandle,
  LoadBalancingStrategy,
} from './types';
import { selectFailoverServerFromSorted } from './serverSelector';
import { evictIdleConnectionForFailoverTarget } from './connectionManager';
import { recordHealthCheckResult, updateServerHealthInDb } from './healthChecker';

const log = createLogger('ELECTRUM_POOL:SVC_FAILOVER');

/**
 * The failover target the pool would currently route to, or null when the
 * strategy is not failover_only or no enabled servers exist. Pure/cheap:
 * never mutates roundRobinIndex and never calls the weighted selector.
 */
export function currentFailoverTarget(
  loadBalancing: LoadBalancingStrategy,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
): ServerConfig | null {
  if (loadBalancing !== 'failover_only') return null;
  return selectFailoverServerFromSorted(servers, serverStats, Date.now());
}

/**
 * Record a failed connection attempt to a failover target the same way
 * the pool's other health paths do (ensureMinimumConnections /
 * performHealthChecks): mark unhealthy, record the failure for backoff,
 * append health history, and persist to the DB. This does not double as
 * a full health-check cycle; ensureMinimumConnections/performHealthChecks
 * will independently record their own failures if the server is still
 * unreachable later, but this call itself only fires once per failed
 * acquisition attempt.
 */
export async function recordFailoverTargetConnectFailure(
  server: ServerConfig,
  error: unknown,
  serverStats: Map<string, ServerState>,
  recordServerFailure: (serverId: string, errorType: 'timeout' | 'error' | 'disconnect') => void,
): Promise<void> {
  const errorStr = getErrorMessage(error);
  const stats = serverStats.get(server.id);
  if (stats) {
    stats.isHealthy = false;
    stats.lastHealthCheck = new Date();
  }
  recordServerFailure(server.id, 'error');
  recordHealthCheckResult(serverStats, server.id, false, 0, errorStr);
  await updateServerHealthInDb(server.id, false, stats?.consecutiveFailures, errorStr).catch(
    (dbError) => {
      log.warn('Failed to persist failover target health after connect failure', {
        error: getErrorMessage(dbError),
      });
    },
  );
}

/**
 * After a failed connection attempt to the current failover target,
 * re-evaluate the target once. If it changed and an idle socket exists
 * for the new target, hand it out immediately instead of leaving a dead
 * primary starving every request until periodic health checks catch up.
 * Returns null when no immediate alternative exists (caller falls
 * through to the queue).
 */
export async function rerouteAfterFailoverTargetFailure(
  failedTarget: ServerConfig,
  error: unknown,
  purpose: string | undefined,
  startTime: number,
  loadBalancing: LoadBalancingStrategy,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  recordServerFailure: (serverId: string, errorType: 'timeout' | 'error' | 'disconnect') => void,
  findIdleConnection: (serverId?: string) => PooledConnection | null,
  activateConnection: (
    conn: PooledConnection,
    purpose: string | undefined,
    startTime: number,
  ) => PooledConnectionHandle,
): Promise<PooledConnectionHandle | null> {
  await recordFailoverTargetConnectFailure(failedTarget, error, serverStats, recordServerFailure);

  const revisedTarget = currentFailoverTarget(loadBalancing, servers, serverStats);
  if (!revisedTarget || revisedTarget.id === failedTarget.id) {
    return null;
  }

  const backupConn = findIdleConnection(revisedTarget.id);
  if (!backupConn) {
    return null;
  }

  return activateConnection(backupConn, purpose, startTime);
}

/**
 * Under failover_only, when the pool is already at effective capacity and
 * the current failover target has no idle socket, evict one idle
 * non-target, non-dedicated backup socket and create a connection to the
 * target with the freed slot. Never evicts the dedicated subscription
 * connection or an active socket (evictIdleConnectionForFailoverTarget
 * only considers idle, non-dedicated sockets). Returns null when there is
 * no eligible idle backup to evict, or when the subsequent create fails
 * and reroute finds no immediate alternative -- both fall through to the
 * caller's queueing path.
 */
export async function acquireByEvictingBackupForFailoverTarget(
  failoverTarget: ServerConfig,
  purpose: string | undefined,
  startTime: number,
  connections: Map<string, PooledConnection>,
  loadBalancing: LoadBalancingStrategy,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  recordServerFailure: (serverId: string, errorType: 'timeout' | 'error' | 'disconnect') => void,
  findIdleConnection: (serverId?: string) => PooledConnection | null,
  activateConnection: (
    conn: PooledConnection,
    purpose: string | undefined,
    startTime: number,
  ) => PooledConnectionHandle,
  createConnectionForTarget: (target: ServerConfig) => Promise<PooledConnection>,
  isShuttingDown: () => boolean,
  incrementPending: () => void,
  decrementPending: () => void,
): Promise<PooledConnectionHandle | null> {
  if (!evictIdleConnectionForFailoverTarget(connections, failoverTarget.id)) {
    return null;
  }

  incrementPending();
  try {
    const newConn = await createConnectionForTarget(failoverTarget);
    return activateConnection(newConn, purpose, startTime);
  } catch (error) {
    log.warn('Failed to create failover target connection after evicting idle backup', {
      error: getErrorMessage(error),
    });
    if (isShuttingDown()) throw error;
    return rerouteAfterFailoverTargetFailure(
      failoverTarget,
      error,
      purpose,
      startTime,
      loadBalancing,
      servers,
      serverStats,
      recordServerFailure,
      findIdleConnection,
      activateConnection,
    );
  } finally {
    decrementPending();
  }
}
