/**
 * Electrum connection pool with multi-server load balancing, health checks,
 * failover, subscription isolation, and acquisition queueing.
 *
 * Effective connection bounds are raised to at least the enabled server count
 * so every configured server can maintain one connection.
 */

import { EventEmitter } from 'events';
import { createLogger } from '../../../utils/logger';
import { getErrorMessage } from '../../../utils/errors';
import { nodeConfigRepository } from '../../../repositories';
import { CircuitBreaker, createCircuitBreaker } from '../../circuitBreaker';
import type {
  ElectrumPoolConfig,
  ServerConfig,
  ServerState,
  PooledConnection,
  PooledConnectionHandle,
  PoolStats,
  AcquireOptions,
  WaitingRequest,
  ProxyConfig,
  BackoffConfig,
  NetworkType,
} from './types';
import {
  DEFAULT_POOL_CONFIG,
  DEFAULT_BACKOFF_CONFIG,
  createDefaultServerState,
} from './types';
import { selectServer } from './serverSelector';
import {
  recordHealthCheckResult,
  updateServerHealthInDb,
  performConnectionHealthChecks,
  sendKeepalives,
} from './healthChecker';
import {
  createConnection,
  reconnectConnection,
  disconnectServerConnections,
  cleanupIdleConnections,
  ensureMinimumConnections,
  findIdleConnection,
  handleConnectionError,
} from './connectionManager';
import {
  recordServerFailure,
  recordServerSuccess,
  isServerInCooldown,
  getServerBackoffState,
  resetServerBackoff,
} from './backoffManager';
import {
  activateConnection,
  activateConnectionSingleMode,
  processWaitingQueue,
} from './acquisitionQueue';
import { computePoolStats, exportMetrics } from './metricsExporter';
import { getSubscriptionConnection as getSubscriptionConn } from './subscriptionConnection';
import {
  getLoadBalancingStrategy,
  getProxyConfig,
  mapEnabledServers,
} from './nodeConfigMapper';

const log = createLogger('ELECTRUM_POOL:SVC');

/**
 * Electrum Connection Pool
 *
 * Manages a pool of connections to multiple Electrum servers for improved
 * concurrency, resilience, and failover.
 */
export class ElectrumPool extends EventEmitter {
  private config: ElectrumPoolConfig;
  private connections: Map<string, PooledConnection> = new Map();
  private waitingQueue: WaitingRequest[] = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private idleCheckInterval: NodeJS.Timeout | null = null;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private isShuttingDown = false;
  private isInitialized = false;
  private subscriptionConnectionId: { value: string | null } = { value: null };
  // Lock to prevent concurrent initialization
  private initializePromise: Promise<void> | null = null;

  // Network identifier (for metrics)
  private network: NetworkType = 'mainnet';

  // Multi-server support
  private servers: ServerConfig[] = [];
  private serverStats: Map<string, ServerState> = new Map();
  private roundRobinIndex = { value: 0 };

  // Backoff configuration
  private backoffConfig: BackoffConfig = DEFAULT_BACKOFF_CONFIG;

  // Proxy configuration (for Tor support)
  private proxyConfig: ProxyConfig | null = null;

  // Statistics
  private stats = {
    totalAcquisitions: 0,
    totalAcquisitionTimeMs: 0,
    healthCheckFailures: 0,
  };

  // Circuit breaker for pool-level fault tolerance
  private circuitBreaker: CircuitBreaker<PooledConnectionHandle>;

  constructor(poolConfig?: Partial<ElectrumPoolConfig>) {
    super();
    this.config = { ...DEFAULT_POOL_CONFIG, ...poolConfig };

    // Initialize circuit breaker for pool acquisition
    this.circuitBreaker = createCircuitBreaker<PooledConnectionHandle>({
      name: 'electrum-pool',
      failureThreshold: 8,
      recoveryTimeout: 15000,
      successThreshold: 2,
      onStateChange: (newState, oldState) => {
        log.info(`Electrum pool circuit breaker: ${oldState} → ${newState}`);
        this.emit('circuitStateChange', { newState, oldState });
      },
    });
  }

  /**
   * Get circuit breaker health for monitoring
   */
  getCircuitHealth() {
    return this.circuitBreaker.getHealth();
  }

  /**
   * Set the server list for the pool
   */
  setServers(servers: ServerConfig[]): void {
    const oldServerIds = new Set(this.servers.map(s => s.id));
    this.servers = servers.filter(s => s.enabled).sort((a, b) => a.priority - b.priority);
    const newServerIds = new Set(this.servers.map(s => s.id));

    // Initialize stats for each server
    for (const server of this.servers) {
      if (!this.serverStats.has(server.id)) {
        this.serverStats.set(server.id, createDefaultServerState());
      }
    }

    // Disconnect connections to servers that were removed or disabled
    const removedServerIds = [...oldServerIds].filter(id => !newServerIds.has(id));
    if (removedServerIds.length > 0) {
      log.info(`Disconnecting connections to ${removedServerIds.length} removed/disabled servers`);
      for (const serverId of removedServerIds) {
        this.disconnectServerConnections(serverId);
        this.serverStats.delete(serverId);
      }
    }

    log.info(`Pool configured with ${this.servers.length} servers`, {
      effectiveMin: this.getEffectiveMinConnections(),
      effectiveMax: this.getEffectiveMaxConnections(),
      configuredMin: this.config.minConnections,
      configuredMax: this.config.maxConnections,
    });
  }

  /**
   * Disconnect all connections to a specific server
   * Used when a server is disabled or removed from the pool
   */
  disconnectServerConnections(serverId: string): void {
    disconnectServerConnections(serverId, this.connections, this.subscriptionConnectionId);
  }

  /**
   * Set proxy configuration for all pool connections
   * When proxy is enabled, all connections will route through it (for Tor support)
   */
  setProxyConfig(proxy: ProxyConfig | null): void {
    this.proxyConfig = proxy;
    if (proxy?.enabled) {
      log.info(`Pool proxy configured: ${proxy.host}:${proxy.port}`);
    } else {
      log.info('Pool proxy disabled');
    }
  }

  /**
   * Get current proxy configuration
   */
  getProxyConfig(): ProxyConfig | null {
    return this.proxyConfig;
  }

  /**
   * Check if proxy (Tor) is enabled
   */
  isProxyEnabled(): boolean {
    return this.proxyConfig?.enabled ?? false;
  }

  /**
   * Set the network identifier for this pool (used for metrics)
   */
  setNetwork(network: NetworkType): void {
    this.network = network;
  }

  /**
   * Get the network this pool is configured for
   */
  getNetwork(): NetworkType {
    return this.network;
  }

  /**
   * Get effective minimum connections (at least 1 per server)
   * This ensures even distribution across all configured servers at startup.
   */
  getEffectiveMinConnections(): number {
    const serverCount = this.servers.length;
    if (serverCount === 0) return this.config.minConnections;
    return Math.max(this.config.minConnections, serverCount);
  }

  /**
   * Get effective maximum connections (at least 1 per server)
   * This ensures the pool can maintain at least 1 connection per server.
   */
  getEffectiveMaxConnections(): number {
    const serverCount = this.servers.length;
    if (serverCount === 0) return this.config.maxConnections;
    return Math.max(this.config.maxConnections, serverCount);
  }

  /**
   * Get the list of configured servers
   */
  getServers(): ServerConfig[] {
    return [...this.servers];
  }

  /**
   * Reload servers and proxy config from database (can be called to pick up config changes)
   */
  async reloadServers(): Promise<void> {
    try {
      const nodeConfig = await nodeConfigRepository.findDefaultWithServers();

      if (nodeConfig && nodeConfig.type === 'electrum') {
        const servers = mapEnabledServers(nodeConfig.servers);

        this.setServers(servers);

        const loadBalancing = getLoadBalancingStrategy(nodeConfig);
        if (loadBalancing) {
          this.config.loadBalancing = loadBalancing;
        }

        this.setProxyConfig(getProxyConfig(nodeConfig));

        log.info(`Reloaded ${servers.length} servers from database`, {
          proxyEnabled: this.proxyConfig?.enabled ?? false,
        });

        // Ensure new servers have connections
        if (this.isInitialized) {
          await this.ensureMinimumConnections();
        }
      }
    } catch (error) {
      log.error('Failed to reload servers from database', { error: getErrorMessage(error) });
    }
  }

  /**
   * Initialize the pool by creating minimum connections
   */
  async initialize(): Promise<void> {
    // Fast path: already initialized
    if (this.isInitialized) {
      log.debug('Pool already initialized');
      return;
    }

    // Another caller is already initializing - wait for their result
    if (this.initializePromise) {
      return this.initializePromise;
    }

    // We're the first caller - create and store the init promise
    this.initializePromise = this.doInitialize();

    try {
      await this.initializePromise;
    } finally {
      // Clear the promise after completion
      this.initializePromise = null;
    }
  }

  /**
   * Internal initialization logic (called only once via lock)
   */
  private async doInitialize(): Promise<void> {
    // Double-check in case of race
    if (this.isInitialized) {
      return;
    }

    // Single-connection mode
    if (!this.config.enabled) {
      log.info('Initializing Electrum in single-connection mode (pool disabled)');
      await this.createConnection();
      this.isInitialized = true;

      // Still run health checks in single mode
      this.healthCheckInterval = setInterval(
        () => this.performHealthChecks(),
        this.config.healthCheckIntervalMs
      );

      log.info('Electrum single connection initialized');
      return;
    }

    const effectiveMin = this.getEffectiveMinConnections();
    const effectiveMax = this.getEffectiveMaxConnections();

    log.info(
      `Initializing Electrum pool (min: ${effectiveMin}, max: ${effectiveMax})`,
      {
        serverCount: this.servers.length,
        configuredMin: this.config.minConnections,
        configuredMax: this.config.maxConnections,
      }
    );

    // Create minimum connections (at least 1 per server)
    const initPromises: Promise<void>[] = [];
    for (let i = 0; i < effectiveMin; i++) {
      initPromises.push(
        this.createConnection().then(() => {}).catch((err) => {
          log.error(`Failed to create initial connection ${i + 1}`, { error: getErrorMessage(err) });
        })
      );
    }

    await Promise.all(initPromises);

    // Start health check interval
    this.healthCheckInterval = setInterval(
      () => this.performHealthChecks(),
      this.config.healthCheckIntervalMs
    );

    // Start idle connection cleanup (only in pool mode)
    this.idleCheckInterval = setInterval(
      () => this.cleanupIdleConnections(),
      this.config.idleTimeoutMs / 2
    );

    // Start keepalive interval (ping idle connections to prevent server-side timeouts)
    this.keepaliveInterval = setInterval(
      () => this.sendKeepalives(),
      this.config.keepaliveIntervalMs
    );

    this.isInitialized = true;
    log.info(`Electrum pool initialized with ${this.connections.size} connections`);
  }

  /**
   * Shutdown the pool and close all connections
   */
  async shutdown(): Promise<void> {
    log.info('Shutting down Electrum pool...');
    this.isShuttingDown = true;
    this.initializePromise = null;

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }

    // Reject all waiting requests
    for (const req of this.waitingQueue) {
      clearTimeout(req.timeoutId);
      req.reject(new Error('Pool is shutting down'));
    }
    this.waitingQueue = [];

    // Close all connections
    for (const [id, conn] of this.connections) {
      try {
        conn.client.disconnect();
        conn.state = 'closed';
      } catch (error) {
        log.warn(`Error closing connection ${id}`, { error: getErrorMessage(error) });
      }
    }
    this.connections.clear();
    this.subscriptionConnectionId.value = null;
    this.isInitialized = false;

    log.info('Electrum pool shut down');
  }

  /**
   * Acquire a connection from the pool
   * Protected by circuit breaker to prevent cascade failures
   */
  async acquire(options: AcquireOptions = {}): Promise<PooledConnectionHandle> {
    // Use circuit breaker for resilience
    return this.circuitBreaker.execute(() => this.acquireInternal(options));
  }

  /**
   * Internal acquire implementation (called by circuit breaker)
   */
  private async acquireInternal(options: AcquireOptions = {}): Promise<PooledConnectionHandle> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }

    if (!this.isInitialized) {
      await this.initialize();
    }

    const startTime = Date.now();

    // Single-connection mode - always return the one connection
    if (!this.config.enabled) {
      let conn = this.connections.values().next().value as PooledConnection | undefined;
      if (!conn || !conn.client.isConnected()) {
        // Reconnect if needed
        if (conn) {
          await this.reconnectConnection(conn);
        } else {
          await this.createConnection();
        }
        conn = this.connections.values().next().value as PooledConnection;
      }
      return activateConnectionSingleMode(conn, startTime, this.network, this.stats);
    }

    const timeoutMs = options.timeoutMs ?? this.config.acquisitionTimeoutMs;

    // Try to get an idle connection
    const conn = this.findIdleConnection();
    if (conn) {
      return this.activateConnection(conn, options.purpose, startTime);
    }

    // Try to create a new connection if under limit
    if (this.connections.size < this.getEffectiveMaxConnections()) {
      try {
        const newConn = await this.createConnection();
        return this.activateConnection(newConn, options.purpose, startTime);
      } catch (error) {
        log.warn('Failed to create new connection', { error: getErrorMessage(error) });
        // Fall through to queue
      }
    }

    // Queue the request
    if (this.waitingQueue.length >= this.config.maxWaitingRequests) {
      throw new Error('Pool request queue is full');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const idx = this.waitingQueue.findIndex((r) => r.resolve === resolve);
        if (idx !== -1) {
          this.waitingQueue.splice(idx, 1);
        }
        reject(new Error(`Connection acquisition timeout (${timeoutMs}ms)`));
      }, timeoutMs);

      this.waitingQueue.push({
        resolve,
        reject,
        timeoutId,
        purpose: options.purpose,
        startTime,
      });
    });
  }

  /**
   * Get the dedicated subscription connection
   * This connection is reserved for real-time subscriptions and events
   */
  async getSubscriptionConnection(): Promise<import('../electrum').ElectrumClient> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    return getSubscriptionConn(
      this.connections,
      this.subscriptionConnectionId,
      this.config,
      {
        findIdleConnection: () => this.findIdleConnection(),
        createConnection: () => this.createConnection(),
        reconnectConnection: (conn) => this.reconnectConnection(conn),
        getEffectiveMaxConnections: () => this.getEffectiveMaxConnections(),
      },
    );
  }

  /**
   * Get pool statistics
   */
  getPoolStats(): PoolStats {
    return computePoolStats(
      this.connections,
      this.servers,
      this.serverStats,
      this.waitingQueue.length,
      this.stats,
    );
  }

  /**
   * Check if the pool is healthy (has available capacity)
   */
  isHealthy(): boolean {
    if (!this.isInitialized) return false;
    const stats = this.getPoolStats();
    return stats.idleConnections > 0 || stats.totalConnections < this.getEffectiveMaxConnections();
  }

  /**
   * Check if the pool is initialized
   */
  isPoolInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Record a failure for a server (call this when requests fail)
   */
  recordServerFailure(serverId: string, errorType: 'timeout' | 'error' | 'disconnect' = 'error'): void {
    recordServerFailure(serverId, this.servers, this.serverStats, this.backoffConfig, errorType);
  }

  /**
   * Record a success for a server (call this when requests succeed)
   */
  recordServerSuccess(serverId: string): void {
    recordServerSuccess(serverId, this.servers, this.serverStats, this.backoffConfig);
  }

  /**
   * Check if a server is currently in cooldown
   */
  isServerInCooldown(serverId: string): boolean {
    return isServerInCooldown(serverId, this.serverStats);
  }

  /**
   * Get current backoff state for a server
   */
  getServerBackoffState(serverId: string): {
    level: number;
    weight: number;
    inCooldown: boolean;
    cooldownRemaining: number;
    consecutiveFailures: number;
  } | null {
    return getServerBackoffState(serverId, this.serverStats);
  }

  /**
   * Manually reset backoff state for a server (e.g., after manual health check)
   */
  resetServerBackoff(serverId: string): void {
    resetServerBackoff(serverId, this.servers, this.serverStats);
  }

  // Private helper methods

  /**
   * Select a server based on load balancing strategy with backoff awareness
   */
  private selectServer(): ServerConfig | null {
    return selectServer(
      this.servers,
      this.serverStats,
      this.connections,
      this.config.loadBalancing,
      this.roundRobinIndex,
    );
  }

  /**
   * Create a new connection to a specific server or auto-select
   */
  private async createConnection(server?: ServerConfig): Promise<PooledConnection> {
    const targetServer = server || this.selectServer();
    return createConnection(
      this.connections,
      this.config,
      this.proxyConfig,
      targetServer,
      (conn) => this.handleConnectionError(conn),
    );
  }

  /**
   * Activate a connection for use
   */
  private activateConnection(
    conn: PooledConnection,
    purpose: string | undefined,
    startTime: number,
  ): PooledConnectionHandle {
    return activateConnection(
      conn,
      purpose,
      startTime,
      this.network,
      this.stats,
      () => this.processWaitingQueue(),
    );
  }

  /**
   * Process the waiting queue when a connection becomes available
   */
  private processWaitingQueue(): void {
    processWaitingQueue(
      this.waitingQueue,
      () => this.findIdleConnection(),
      (conn, purpose, startTime) => this.activateConnection(conn, purpose, startTime),
    );
  }

  /**
   * Perform health checks on all connections
   */
  private async performHealthChecks(): Promise<void> {
    const serverHealthResults = await performConnectionHealthChecks(
      this.connections,
      this.network,
      this.stats,
      (conn) => this.reconnectConnection(conn),
      (conn) => this.handleConnectionError(conn),
    );

    // Record health check results (only first success/failure per server per cycle)
    for (const [serverId, results] of serverHealthResults) {
      if (results.success > 0 && results.fail === 0) {
        // Only record once per server per cycle
        recordHealthCheckResult(this.serverStats, serverId, true, results.latencyMs);
      } else if (results.fail > 0 && results.success === 0) {
        recordHealthCheckResult(this.serverStats, serverId, false, results.latencyMs);
      }
    }

    // Update per-server health stats and database
    for (const [serverId, results] of serverHealthResults) {
      const stats = this.serverStats.get(serverId);
      if (stats) {
        stats.lastHealthCheck = new Date();

        // If all connections to this server failed, mark unhealthy and record failure
        if (results.fail > 0 && results.success === 0) {
          stats.isHealthy = false;
          // Record failure for backoff (once per server per cycle, not per connection)
          this.recordServerFailure(serverId, 'error');
          // Update database (fire and forget)
          updateServerHealthInDb(serverId, false, stats.consecutiveFailures);
          log.warn(`Server ${serverId} marked unhealthy after all connections failed health check`);
        } else {
          // At least one success - mark healthy and record success
          stats.isHealthy = true;
          // Record success for backoff recovery (once per server per cycle, not per connection)
          this.recordServerSuccess(serverId);
          updateServerHealthInDb(serverId, true, 0);
        }
      }
    }

    // After checking existing connections, ensure each server has at least one connection
    await this.ensureMinimumConnections();

    // Export metrics to Prometheus
    this.exportMetrics();
  }

  /**
   * Export pool metrics to Prometheus
   * Called after each health check cycle
   */
  private exportMetrics(): void {
    const poolStats = this.getPoolStats();
    const circuitState = this.circuitBreaker.getHealth().state;
    exportMetrics(this.network, poolStats, circuitState);
  }

  /**
   * Ensure each configured server has at least one connection
   */
  private async ensureMinimumConnections(): Promise<void> {
    await ensureMinimumConnections(
      this.servers,
      this.serverStats,
      this.connections,
      this.config,
      this.proxyConfig,
      this.isShuttingDown,
      (conn) => this.handleConnectionError(conn),
      (serverId) => this.recordServerSuccess(serverId),
      (serverId, errorType) => this.recordServerFailure(serverId, errorType),
      (serverId, success, latencyMs, error) =>
        recordHealthCheckResult(this.serverStats, serverId, success, latencyMs, error),
      (serverId, isHealthy, failCount, errorMessage) =>
        updateServerHealthInDb(serverId, isHealthy, failCount, errorMessage),
      (server) => this.createConnection(server),
    );
  }

  /**
   * Handle a connection error
   */
  private async handleConnectionError(conn: PooledConnection): Promise<void> {
    if (conn.isDedicated) {
      await this.reconnectConnection(conn);
      return;
    }

    await handleConnectionError(
      conn,
      this.connections,
      this.config,
      this.proxyConfig,
      this.getEffectiveMinConnections(),
      this.isShuttingDown,
      this.subscriptionConnectionId,
      (client) => this.emit('subscriptionReconnected', client),
      (c) => this.handleConnectionError(c),
      () => this.selectServer(),
      (server) => this.createConnection(server ?? undefined),
    );
  }

  /**
   * Wrapper for testability and internal reuse.
   */
  private findIdleConnection(): PooledConnection | null {
    return findIdleConnection(this.connections);
  }

  /**
   * Wrapper for testability and internal reuse.
   */
  private async reconnectConnection(conn: PooledConnection): Promise<void> {
    await reconnectConnection(
      conn,
      this.config,
      this.connections,
      this.subscriptionConnectionId,
      (client) => this.emit('subscriptionReconnected', client),
    );
  }

  /**
   * Wrapper for testability and interval scheduling.
   */
  private cleanupIdleConnections(): void {
    cleanupIdleConnections(this.connections, this.config.idleTimeoutMs, this.getEffectiveMinConnections());
  }

  /**
   * Wrapper for testability and interval scheduling.
   */
  private async sendKeepalives(): Promise<void> {
    await sendKeepalives(this.connections, this.isShuttingDown);
  }
}
