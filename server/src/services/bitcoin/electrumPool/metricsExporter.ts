/**
 * Metrics Exporter
 *
 * Pure functions for computing pool statistics and exporting
 * Prometheus metrics. These are read-only aggregations over
 * connection and server state.
 */

import { updateElectrumPoolMetrics } from '../../../observability/metrics';

import type {
  PooledConnection,
  ServerConfig,
  ServerState,
  ServerStats,
  PoolStats,
  NetworkType,
} from './types';

function connectionsForServer(
  connections: PooledConnection[],
  serverId: string,
) {
  return connections.filter(connection => connection.serverId === serverId);
}

function countHealthyConnections(connections: PooledConnection[]) {
  return connections.filter(isHealthyConnection).length;
}

function isHealthyConnection(connection: PooledConnection) {
  return connection.state !== 'closed' && connection.client.isConnected();
}

function activeCooldownUntil(stats: ServerState | undefined, now: number) {
  if (!stats?.cooldownUntil) return null;
  return stats.cooldownUntil.getTime() > now ? stats.cooldownUntil : null;
}

function buildServerStat(
  server: ServerConfig,
  stats: ServerState | undefined,
  connections: PooledConnection[],
  now: number,
) {
  return {
    serverId: server.id,
    label: server.label,
    host: server.host,
    port: server.port,
    connectionCount: connections.length,
    healthyConnections: countHealthyConnections(connections),
    totalRequests: stats?.totalRequests || 0,
    failedRequests: stats?.failedRequests || 0,
    isHealthy: stats?.isHealthy ?? true,
    lastHealthCheck: stats?.lastHealthCheck || null,
    consecutiveFailures: stats?.consecutiveFailures || 0,
    backoffLevel: stats?.backoffLevel || 0,
    cooldownUntil: activeCooldownUntil(stats, now),
    weight: stats?.weight ?? 1.0,
    healthHistory: stats?.healthHistory || [],
    supportsVerbose: server.supportsVerbose,
    supportsSilentPaymentsV0: server.supportsSilentPaymentsV0,
    serverUsage: server.serverUsage,
    lastCapabilityCheck: server.lastCapabilityCheck ?? null,
    lastCapabilityError: server.lastCapabilityError ?? null,
  };
}

/**
 * Build per-server stats array from current server/connection state.
 */
function buildServerStats(
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  connections: PooledConnection[],
) {
  const now = Date.now();

  return servers.map(server => buildServerStat(
    server,
    serverStats.get(server.id),
    connectionsForServer(connections, server.id),
    now,
  ));
}

/**
 * Compute full pool statistics from current state.
 */
export function computePoolStats(
  connections: Map<string, PooledConnection>,
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  waitingQueueLength: number,
  acquisitionStats: {
    totalAcquisitions: number;
    totalAcquisitionTimeMs: number;
    healthCheckFailures: number;
  },
): PoolStats {
  const allConnections = Array.from(connections.values());
  const activeCount = allConnections.filter(c => c.state === 'active').length;
  const idleCount = allConnections.filter(c => c.state === 'idle').length;

  const serverStatsArray = buildServerStats(servers, serverStats, allConnections);

  return {
    totalConnections: allConnections.length,
    activeConnections: activeCount,
    idleConnections: idleCount,
    waitingRequests: waitingQueueLength,
    totalAcquisitions: acquisitionStats.totalAcquisitions,
    averageAcquisitionTimeMs:
      acquisitionStats.totalAcquisitions > 0
        ? Math.round(
            acquisitionStats.totalAcquisitionTimeMs /
              acquisitionStats.totalAcquisitions,
          )
        : 0,
    healthCheckFailures: acquisitionStats.healthCheckFailures,
    serverCount: servers.length,
    servers: serverStatsArray,
  };
}

/**
 * Export pool metrics to Prometheus.
 * Called after each health check cycle.
 */
export function exportMetrics(
  network: NetworkType,
  poolStats: PoolStats,
  circuitState: 'closed' | 'half-open' | 'open',
): void {
  updateElectrumPoolMetrics(
    network,
    {
      totalConnections: poolStats.totalConnections,
      activeConnections: poolStats.activeConnections,
      idleConnections: poolStats.idleConnections,
      waitingRequests: poolStats.waitingRequests,
      totalAcquisitions: poolStats.totalAcquisitions,
      averageAcquisitionTimeMs: poolStats.averageAcquisitionTimeMs,
      healthCheckFailures: poolStats.healthCheckFailures,
      servers: poolStats.servers.map(s => ({
        label: s.label,
        isHealthy: s.isHealthy,
        connectionCount: s.connectionCount,
        backoffLevel: s.backoffLevel,
        weight: s.weight,
      })),
    },
    circuitState,
  );
}
