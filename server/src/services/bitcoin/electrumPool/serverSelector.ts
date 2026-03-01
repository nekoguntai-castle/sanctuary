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

const log = createLogger('ELECTRUM_POOL:SERVER_SELECTOR');

/**
 * Select a server based on load balancing strategy with backoff awareness
 */
export function selectServer(
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  connections: Map<string, PooledConnection>,
  strategy: LoadBalancingStrategy,
  roundRobinIndex: { value: number },
): ServerConfig | null {
  const now = Date.now();

  // Filter servers: healthy, not in cooldown
  const availableServers = servers.filter(s => {
    const stats = serverStats.get(s.id);
    if (!s.enabled) return false;
    if (!stats) return true;
    if (!stats.isHealthy) return false;

    // Check if server is in cooldown
    if (stats.cooldownUntil && stats.cooldownUntil.getTime() > now) {
      return false;
    }

    return true;
  });

  if (availableServers.length === 0) {
    // If no available servers, check if any are just in cooldown (not unhealthy)
    // We can use cooldown servers as last resort
    const cooldownServers = servers.filter(s => {
      const stats = serverStats.get(s.id);
      return s.enabled && stats?.isHealthy && stats?.cooldownUntil && stats.cooldownUntil.getTime() > now;
    });

    if (cooldownServers.length > 0) {
      // Use the one with shortest remaining cooldown
      log.warn('All available servers in cooldown, using server with shortest cooldown');
      cooldownServers.sort((a, b) => {
        const statsA = serverStats.get(a.id);
        const statsB = serverStats.get(b.id);
        return (statsA?.cooldownUntil?.getTime() || 0) - (statsB?.cooldownUntil?.getTime() || 0);
      });
      return cooldownServers[0];
    }

    // Fall back to any enabled server
    const enabledServers = servers.filter(s => s.enabled);
    if (enabledServers.length === 0) return null;
    return enabledServers[0];
  }

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
}

/**
 * Select server with fewest active connections, weighted by reliability.
 * Verbose-capable servers get a small (10%) weight bonus.
 */
function selectLeastConnections(
  availableServers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  connections: Map<string, PooledConnection>,
): ServerConfig {
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
}

/**
 * Weighted round-robin selection.
 * Servers with higher weights are selected more frequently.
 * Verbose-capable servers get a small (10%) weight bonus.
 */
function selectWeightedRoundRobin(
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  roundRobinIndex: { value: number },
): ServerConfig {
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
}
