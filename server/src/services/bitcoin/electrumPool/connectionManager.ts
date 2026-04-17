/**
 * Connection Manager
 *
 * Handles connection lifecycle: creation, reconnection, disconnect,
 * idle cleanup, and minimum connection maintenance for the Electrum pool.
 */

import { ElectrumClient } from '../electrum';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import type {
  PooledConnection,
  ServerConfig,
  ServerState,
  ElectrumPoolConfig,
  ProxyConfig,
} from './types';

const log = createLogger('ELECTRUM_POOL:SVC_CONNECTION');

/**
 * Create a new connection to a specific server or auto-select one.
 *
 * @param connections The pool's connection map (mutated: new connection is added)
 * @param config The pool configuration
 * @param proxyConfig Optional proxy configuration for Tor
 * @param targetServer The server to connect to (if null, caller should select one)
 * @param onError Callback for connection error events
 * @returns The created PooledConnection
 */
export async function createConnection(
  connections: Map<string, PooledConnection>,
  config: ElectrumPoolConfig,
  proxyConfig: ProxyConfig | null,
  targetServer: ServerConfig | null,
  onError: (conn: PooledConnection) => void,
): Promise<PooledConnection> {
  const id = `conn-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Determine connection timeout - increase significantly for Tor
  // Tor adds ~2-5 seconds latency for circuit establishment
  const baseTimeout = config.connectionTimeoutMs;
  const connectionTimeout = proxyConfig?.enabled ? baseTimeout * 3 : baseTimeout;

  // Create client with specific server config if available
  // Include proxy config so connections route through Tor when enabled
  const client = targetServer
    ? new ElectrumClient({
        host: targetServer.host,
        port: targetServer.port,
        protocol: targetServer.useSsl ? 'ssl' : 'tcp',
        connectionTimeoutMs: connectionTimeout,
        proxy: proxyConfig ?? undefined,
      })
    : new ElectrumClient();

  const serverLabel = targetServer?.label || 'default';
  log.debug(`Creating connection ${id} to ${serverLabel}...`);

  await client.connect();

  // Negotiate protocol version
  await client.getServerVersion();

  const conn: PooledConnection = {
    id,
    client,
    state: 'idle',
    createdAt: new Date(),
    lastUsedAt: new Date(),
    lastHealthCheck: new Date(),
    useCount: 0,
    isDedicated: false,
    serverId: targetServer?.id || 'default',
    serverLabel: targetServer?.label || 'default',
    serverHost: targetServer?.host || 'unknown',
    serverPort: targetServer?.port || 0,
  };

  // Set up error handling
  client.on('error', (error) => {
    log.error(`Connection ${id} error (${conn.serverLabel})`, { error: getErrorMessage(error) });
    onError(conn);
  });

  connections.set(id, conn);
  log.debug(`Created connection ${id} to ${conn.serverLabel} (${conn.serverHost}:${conn.serverPort})`);

  return conn;
}

/**
 * Attempt to reconnect a connection with exponential backoff.
 *
 * @param conn The connection to reconnect
 * @param config Pool configuration (for max attempts and delay)
 * @param connections The pool's connection map (mutated on permanent failure)
 * @param subscriptionConnectionId Ref object tracking the subscription connection ID
 * @param emitSubscriptionReconnected Callback when a dedicated connection reconnects
 */
export async function reconnectConnection(
  conn: PooledConnection,
  config: ElectrumPoolConfig,
  connections: Map<string, PooledConnection>,
  subscriptionConnectionId: { value: string | null },
  emitSubscriptionReconnected: (client: ElectrumClient) => void,
): Promise<void> {
  conn.state = 'reconnecting';

  for (let attempt = 1; attempt <= config.maxReconnectAttempts; attempt++) {
    try {
      log.info(
        `Reconnecting ${conn.id} (attempt ${attempt}/${config.maxReconnectAttempts})`
      );

      // Disconnect old socket
      try {
        conn.client.disconnect();
      } catch (e) {
        log.debug('Disconnect failed during reconnect (non-critical)', { error: String(e) });
      }

      // Reconnect
      await conn.client.connect();
      await conn.client.getServerVersion();

      conn.state = 'idle';
      conn.lastHealthCheck = new Date();
      log.info(`Reconnected ${conn.id}`);

      // Emit event for subscription re-establishment
      if (conn.isDedicated) {
        emitSubscriptionReconnected(conn.client);
      }

      return;
    } catch (error) {
      log.warn(`Reconnect attempt ${attempt} failed for ${conn.id}`, {
        error: getErrorMessage(error),
      });

      if (attempt < config.maxReconnectAttempts) {
        const delay = config.reconnectDelayMs * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  // All attempts failed
  conn.state = 'closed';
  connections.delete(conn.id);

  if (conn.id === subscriptionConnectionId.value) {
    subscriptionConnectionId.value = null;
    log.error('Subscription connection lost and could not be recovered');
  }

  log.error(
    `Failed to reconnect ${conn.id} after ${config.maxReconnectAttempts} attempts`
  );
}

/**
 * Disconnect all connections to a specific server.
 * Used when a server is disabled or removed from the pool.
 */
export function disconnectServerConnections(
  serverId: string,
  connections: Map<string, PooledConnection>,
  subscriptionConnectionId: { value: string | null },
): void {
  const serverConnections = [...connections.entries()]
    .filter(([_, conn]) => conn.serverId === serverId);

  if (serverConnections.length === 0) {
    log.debug(`No connections to disconnect for server ${serverId}`);
    return;
  }

  log.info(`Disconnecting ${serverConnections.length} connections to server ${serverId}`);

  for (const [connId, conn] of serverConnections) {
    try {
      conn.client.disconnect();
      connections.delete(connId);

      // If this was the subscription connection, clear it
      if (subscriptionConnectionId.value === connId) {
        subscriptionConnectionId.value = null;
        log.info('Subscription connection was disconnected, will be reassigned');
      }
    } catch (error) {
      log.warn(`Error disconnecting connection ${connId}`, { error: getErrorMessage(error) });
    }
  }

  log.info(`Disconnected all connections to server ${serverId}`);
}

/**
 * Clean up idle connections that have exceeded the idle timeout.
 * Won't go below the effective minimum connection count.
 */
export function cleanupIdleConnections(
  connections: Map<string, PooledConnection>,
  idleTimeoutMs: number,
  effectiveMinConnections: number,
): void {
  const now = Date.now();

  for (const [id, conn] of connections) {
    // Don't cleanup dedicated or active connections
    if (conn.isDedicated || conn.state !== 'idle') continue;

    // Don't go below minimum (at least 1 per server)
    if (connections.size <= effectiveMinConnections) break;

    const idleTime = now - conn.lastUsedAt.getTime();
    if (idleTime > idleTimeoutMs) {
      log.debug(`Closing idle connection ${id} (idle for ${idleTime}ms)`);
      conn.state = 'closed';
      try {
        conn.client.disconnect();
      } catch (e) {
        log.debug('Disconnect failed during idle cleanup (non-critical)', { error: String(e) });
      }
      connections.delete(id);
    }
  }
}

/**
 * Ensure each configured server has at least one connection.
 * Called after health checks and after reloading servers.
 */
export async function ensureMinimumConnections(
  servers: ServerConfig[],
  serverStats: Map<string, ServerState>,
  connections: Map<string, PooledConnection>,
  config: ElectrumPoolConfig,
  proxyConfig: ProxyConfig | null,
  isShuttingDown: boolean,
  onError: (conn: PooledConnection) => void,
  recordServerSuccess: (serverId: string) => void,
  recordServerFailure: (serverId: string, errorType: 'timeout' | 'error' | 'disconnect') => void,
  recordHealthCheckResult: (serverId: string, success: boolean, latencyMs?: number, error?: string) => void,
  updateServerHealthInDb: (serverId: string, isHealthy: boolean, failCount?: number, errorMessage?: string) => Promise<void>,
  createConnectionForServer?: (server: ServerConfig) => Promise<PooledConnection>,
): Promise<void> {
  if (isShuttingDown || !config.enabled) return;

  const connectToServer =
    createConnectionForServer ??
    ((server: ServerConfig) => createConnection(connections, config, proxyConfig, server, onError));

  // Count connections per server
  const serverConnectionCounts = new Map<string, number>();
  for (const server of servers) {
    serverConnectionCounts.set(server.id, 0);
  }
  for (const conn of connections.values()) {
    if (conn.state !== 'closed') {
      const count = serverConnectionCounts.get(conn.serverId) || 0;
      serverConnectionCounts.set(conn.serverId, count + 1);
    }
  }

  // Create connections for servers with zero connections
  for (const server of servers) {
    const count = serverConnectionCounts.get(server.id) || 0;
    if (count === 0) {
      log.info(`Server ${server.label} has no connections, creating one...`);
      try {
        await connectToServer(server);
        log.info(`Created connection to ${server.label}`);

        // Connection succeeded - mark server as healthy
        const stats = serverStats.get(server.id);
        if (stats) {
          stats.isHealthy = true;
          stats.lastHealthCheck = new Date();
          recordServerSuccess(server.id);
          recordHealthCheckResult(server.id, true, 0);
          await updateServerHealthInDb(server.id, true, 0);
        }
      } catch (error) {
        const errorStr = getErrorMessage(error);
        log.warn(`Failed to create connection to ${server.label}`, { error: errorStr });

        // Mark server as unhealthy since we can't establish any connection
        const stats = serverStats.get(server.id);
        if (stats) {
          stats.isHealthy = false;
          stats.lastHealthCheck = new Date();
          recordServerFailure(server.id, 'error');
          recordHealthCheckResult(server.id, false, 0, errorStr);
          await updateServerHealthInDb(server.id, false, stats.consecutiveFailures, errorStr);
          log.warn(`Server ${server.label} marked unhealthy - unable to establish connection`);
        }
      }
    }
  }
}

/**
 * Find an idle non-dedicated connection from the pool
 */
export function findIdleConnection(
  connections: Map<string, PooledConnection>,
): PooledConnection | null {
  for (const conn of connections.values()) {
    if (conn.state === 'idle' && !conn.isDedicated && conn.client.isConnected()) {
      return conn;
    }
  }
  return null;
}

/**
 * Handle a connection error by either reconnecting (dedicated) or replacing.
 */
export async function handleConnectionError(
  conn: PooledConnection,
  connections: Map<string, PooledConnection>,
  config: ElectrumPoolConfig,
  proxyConfig: ProxyConfig | null,
  effectiveMinConnections: number,
  isShuttingDown: boolean,
  subscriptionConnectionId: { value: string | null },
  emitSubscriptionReconnected: (client: ElectrumClient) => void,
  onError: (c: PooledConnection) => void,
  selectServer: () => ServerConfig | null,
  createConnectionForServer?: (server: ServerConfig | null) => Promise<PooledConnection>,
): Promise<void> {
  if (conn.isDedicated) {
    await reconnectConnection(conn, config, connections, subscriptionConnectionId, emitSubscriptionReconnected);
  } else {
    // For non-dedicated, remove and create replacement if needed
    conn.state = 'closed';
    try {
      conn.client.disconnect();
    } catch (e) {
      log.debug('Disconnect failed during connection error handling (non-critical)', { error: String(e) });
    }
    connections.delete(conn.id);

    // Ensure minimum connections (at least 1 per server)
    if (connections.size < effectiveMinConnections && !isShuttingDown) {
      const server = selectServer();
      /* v8 ignore start -- default replacement creation schedules asynchronously and is covered through explicit factories */
      const connect =
        createConnectionForServer ??
        ((targetServer: ServerConfig | null) =>
          createConnection(connections, config, proxyConfig, targetServer, onError));
      /* v8 ignore stop */

      connect(server).catch((err) => {
        log.error('Failed to create replacement connection', { error: getErrorMessage(err) });
      });
    }
  }
}
