/**
 * Server Selection
 *
 * Implements server selection strategies for the Electrum connection pool:
 * - round_robin: Weighted round-robin distribution
 * - least_connections: Prefers servers with fewer active connections
 * - failover_only: Uses highest-priority server, fails over when unhealthy
 */

import { createLogger } from '../../../utils/logger';
import type {
  ServerConfig,
  ServerState,
  PooledConnection,
  LoadBalancingStrategy,
} from './types';

const log = createLogger('ELECTRUM_POOL:SVC_SELECTOR');

type ServerStats = Map<string, ServerState>;
type PoolConnections = Map<string, PooledConnection>;
type RoundRobinIndex = { value: number };

const getAvailableServers = (
  servers: ServerConfig[],
  serverStats: ServerStats,
  now: number,
): ServerConfig[] => {
  return servers.filter(server => isServerAvailable(server, serverStats, now));
};

const isServerAvailable = (
  server: ServerConfig,
  serverStats: ServerStats,
  now: number,
): boolean => {
  if (!server.enabled) return false;

  const stats = serverStats.get(server.id);
  if (!stats) return true;

  return stats.isHealthy && !isInCooldown(stats, now);
};

const isInCooldown = (stats: ServerState | undefined, now: number): boolean => {
  return Boolean(stats?.cooldownUntil && stats.cooldownUntil.getTime() > now);
};

const selectFallbackServer = (
  servers: ServerConfig[],
  serverStats: ServerStats,
  now: number,
): ServerConfig | null => {
  const cooldownFallback = selectCooldownFallbackServer(servers, serverStats, now);
  if (cooldownFallback) {
    return cooldownFallback;
  }

  const enabledServers = servers.filter(server => server.enabled);
  return enabledServers[0] ?? null;
};

const selectCooldownFallbackServer = (
  servers: ServerConfig[],
  serverStats: ServerStats,
  now: number,
): ServerConfig | undefined => {
  const cooldownServers = servers.filter(server => {
    const stats = serverStats.get(server.id);
    return server.enabled && Boolean(stats?.isHealthy && isInCooldown(stats, now));
  });

  if (cooldownServers.length === 0) {
    return undefined;
  }

  log.warn('All available servers in cooldown, using server with shortest cooldown');
  return cooldownServers.sort((a, b) =>
    getCooldownUntilMs(a, serverStats) - getCooldownUntilMs(b, serverStats)
  )[0];
};

const getCooldownUntilMs = (server: ServerConfig, serverStats: ServerStats): number => {
  return serverStats.get(server.id)?.cooldownUntil?.getTime() || 0;
};

const selectAvailableServer = (
  availableServers: ServerConfig[],
  serverStats: ServerStats,
  connections: PoolConnections,
  strategy: LoadBalancingStrategy,
  roundRobinIndex: RoundRobinIndex,
): ServerConfig => {
  switch (strategy) {
    case 'failover_only':
      // Always use highest priority (lowest number) available server
      return availableServers[0];

    case 'least_connections':
      // Select server with fewest active connections, weighted by reliability
      return selectLeastConnections(availableServers, serverStats, connections);

    case 'round_robin':
    default:
      // Weighted round robin - servers with higher weight are selected more often
      return selectWeightedRoundRobin(availableServers, serverStats, roundRobinIndex);
  }
};

/**
 * Select server with fewest active connections, weighted by reliability.
 * Verbose-capable servers get a small (10%) weight bonus.
 */
const selectLeastConnections = (
  availableServers: ServerConfig[],
  serverStats: ServerStats,
  connections: PoolConnections,
): ServerConfig => {
  let bestScore = -Infinity;
  let selectedServer = availableServers[0];
  for (const server of availableServers) {
    const stats = serverStats.get(server.id);
    let weight = stats?.weight ?? 1.0;
    // Small bonus (10%) for verbose-capable servers - secondary to health
    if (server.supportsVerbose === true) {
      weight *= 1.1;
    }
    const serverConnections = Array.from(connections.values())
      .filter(c => c.serverId === server.id && c.state === 'active').length;
    // Higher weight = better, fewer connections = better
    // Score combines both factors
    const score = weight * 10 - serverConnections;
    if (score > bestScore) {
      bestScore = score;
      selectedServer = server;
    }
  }
  return selectedServer;
};

/**
 * Weighted round-robin selection.
 * Servers with higher weights are selected more frequently.
 * Verbose-capable servers get a small (10%) weight bonus.
 */
const selectWeightedRoundRobin = (
  servers: ServerConfig[],
  serverStats: ServerStats,
  roundRobinIndex: RoundRobinIndex,
): ServerConfig => {
  // Calculate total weight
  let totalWeight = 0;
  const weights: number[] = [];
  for (const server of servers) {
    const stats = serverStats.get(server.id);
    let weight = stats?.weight ?? 1.0;
    // Small bonus (10%) for verbose-capable servers - secondary to health
    if (server.supportsVerbose === true) {
      weight *= 1.1;
    }
    weights.push(weight);
    totalWeight += weight;
  }

  // Generate a random point in the weight space
  // Use round robin index as seed for deterministic but varied selection
  roundRobinIndex.value++;
  const point = (roundRobinIndex.value * 0.618033988749895) % 1 * totalWeight; // Golden ratio for good distribution

  // Find which server this point falls into
  let cumulative = 0;
  for (let i = 0; i < servers.length; i++) {
    cumulative += weights[i];
    if (point < cumulative) {
      return servers[i];
    }
  }

  // Fallback to last server
  return servers[servers.length - 1];
};

/**
 * Select a server based on load balancing strategy with backoff awareness
 */
export function selectServer(
  servers: ServerConfig[],
  serverStats: ServerStats,
  connections: PoolConnections,
  strategy: LoadBalancingStrategy,
  roundRobinIndex: RoundRobinIndex,
): ServerConfig | null {
  const now = Date.now();
  const availableServers = getAvailableServers(servers, serverStats, now);

  if (availableServers.length === 0) {
    return selectFallbackServer(servers, serverStats, now);
  }

  return selectAvailableServer(availableServers, serverStats, connections, strategy, roundRobinIndex);
}
