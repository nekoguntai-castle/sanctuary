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
import type { CircuitBreaker } from '../../circuitBreaker';
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
  LoadBalancingStrategy,
} from './types';
import {
  DEFAULT_POOL_CONFIG,
  DEFAULT_BACKOFF_CONFIG,
  createDefaultServerState,
} from './types';
import { selectServer, sortServersCanonically } from './serverSelector';
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
import {
  currentFailoverTarget,
  rerouteAfterFailoverTargetFailure,
  acquireByEvictingBackupForFailoverTarget,
} from './failoverAcquisition';
import {
  getEffectiveMinConnections,
  getEffectiveMaxConnections,
  getOperationalConfigSnapshot,
  applyHealthCheckResults,
  recordHealthCheckResultsForCycle,
} from './poolHealthCycle';
import { getSubscriptionConnection as getSubscriptionConn } from './subscriptionConnection';
import { loadPoolConfigFromDatabase } from './poolConfig';
import { createElectrumPoolCircuitBreaker } from './poolCircuitBreaker';

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
  private subscriptionConnectionPromise: Promise<import('../electrum').ElectrumClient> | null = null;
  // Lock to prevent concurrent initialization
  private initializePromise: Promise<void> | null = null;
  private pendingAcquisitionConnections = 0;

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

    this.circuitBreaker = createElectrumPoolCircuitBreaker((newState, oldState) => {
      log.info(`Electrum pool circuit breaker: ${oldState} → ${newState}`);
      this.emit('circuitStateChange', { newState, oldState });
    });
  }

  // Get circuit breaker health for monitoring
  getCircuitHealth() {
    return this.circuitBreaker.getHealth();
  }

  /**
   * Set the server list for the pool
   */
  setServers(servers: ServerConfig[]): void {
    const oldServerIds = new Set(this.servers.map(s => s.id));
    this.servers = sortServersCanonically(servers.filter(s => s.enabled));
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

  // Disconnect all connections to a specific server (server disabled/removed)
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

  // Get current proxy configuration
  getProxyConfig(): ProxyConfig | null {
    return this.proxyConfig;
  }

  // Check if proxy (Tor) is enabled
  isProxyEnabled(): boolean {
    return this.proxyConfig?.enabled ?? false;
  }

  // Set the network identifier for this pool (used for metrics)
  setNetwork(network: NetworkType): void {
    this.network = network;
  }

  // Get the network this pool is configured for
  getNetwork(): NetworkType {
    return this.network;
  }

  /**
   * Get effective minimum connections (at least 1 per server)
   * This ensures even distribution across all configured servers at startup.
   */
  getEffectiveMinConnections(): number {
    return getEffectiveMinConnections(this.config, this.servers.length);
  }

  /**
   * Get effective maximum connections (at least 1 per server)
   * This ensures the pool can maintain at least 1 connection per server.
   */
  getEffectiveMaxConnections(): number {
    return getEffectiveMaxConnections(this.config, this.servers.length);
  }

  // Get the list of configured servers
  getServers(): ServerConfig[] {
    return [...this.servers];
  }

  /**
   * Reload servers and proxy config from database (can be called to pick up config changes)
   */
  async reloadServers(): Promise<void> {
    try {
      const { config, servers, proxy } = await loadPoolConfigFromDatabase(this.network);
      const hasReloadedState =
        Object.keys(config).length > 0 || servers.length > 0 || proxy !== null;

      if (!hasReloadedState) {
        log.warn('No Electrum database config available during reload; keeping current pool state', {
          network: this.network,
        });
        return;
      }

      this.config = { ...this.config, ...config };
      this.setServers(servers);
      this.setProxyConfig(proxy);

      log.info(`Reloaded ${servers.length} servers from database`, {
        network: this.network,
        proxyEnabled: this.proxyConfig?.enabled ?? false,
      });

      // Ensure new servers have connections
      if (this.isInitialized) {
        await this.ensureMinimumConnections();
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

    if (this.isShuttingDown) {
      return;
    }

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
    const initialization = this.initializePromise;

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

    if (initialization) {
      await initialization.catch((error) => {
        log.debug('Pool initialization stopped during shutdown', {
          error: getErrorMessage(error),
        });
      });
    }
    this.initializePromise = null;
    this.connections.clear();
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

    // Under failover_only, prefer capacity on the current eligible primary
    // over an idle backup socket. Other strategies keep unconstrained
    // first-idle behaviour.
    const failoverTarget = this.currentFailoverTarget();

    // Try to get an idle connection
    const conn = this.findIdleConnection(failoverTarget?.id);
    if (conn) {
      return this.activateConnection(conn, options.purpose, startTime);
    }

    // Try to create a new connection if under limit
    if (
      this.connections.size + this.pendingAcquisitionConnections
      < this.getEffectiveMaxConnections()
    ) {
      this.pendingAcquisitionConnections++;
      try {
        const newConn = await this.createConnection(failoverTarget ?? undefined, false, true);
        return this.activateConnection(newConn, options.purpose, startTime);
      } catch (error) {
        log.warn('Failed to create new connection', { error: getErrorMessage(error) });
        if (this.isShuttingDown) throw error;
        if (failoverTarget) {
          const rerouted = await this.rerouteAfterFailoverTargetFailure(
            failoverTarget,
            error,
            options.purpose,
            startTime,
          );
          if (rerouted) return rerouted;
        }
        // Fall through to queue
      } finally {
        this.pendingAcquisitionConnections--;
      }
    } else if (failoverTarget) {
      // At effective capacity with no idle target socket: prefer evicting
      // an idle backup socket over starving the request until periodic
      // idle cleanup happens to free one.
      const evicted = await this.acquireByEvictingBackupForFailoverTarget(
        failoverTarget,
        options.purpose,
        startTime,
      );
      if (evicted) return evicted;
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
    if (this.subscriptionConnectionPromise) {
      return this.subscriptionConnectionPromise;
    }

    const acquisition = getSubscriptionConn(
      this.connections,
      this.subscriptionConnectionId,
      this.config,
      {
        findIdleConnection: () => this.findIdleConnection(),
        createConnection: (allowOverCapacity) =>
          this.createConnection(undefined, allowOverCapacity),
        reconnectConnection: (conn) => this.reconnectConnection(conn),
        hasAvailableCapacity: () =>
          this.connections.size + this.pendingAcquisitionConnections
            < this.getEffectiveMaxConnections(),
      },
    );
    this.subscriptionConnectionPromise = acquisition;
    try {
      return await acquisition;
    } finally {
      this.subscriptionConnectionPromise = null;
    }
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

  // Check if the pool is initialized
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

  // Check if a server is currently in cooldown
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

  // Manually reset backoff state for a server (e.g., after manual health check)
  resetServerBackoff(serverId: string): void {
    resetServerBackoff(serverId, this.servers, this.serverStats);
  }

  // Private helper methods

  // Select a server based on load balancing strategy with backoff awareness
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
  private async createConnection(
    server?: ServerConfig,
    allowOverCapacity = false,
    reservationHeld = false,
  ): Promise<PooledConnection> {
    if (this.isShuttingDown) {
      throw new Error('Pool is shutting down');
    }
    if (
      !allowOverCapacity
      && !reservationHeld
      && this.connections.size + this.pendingAcquisitionConnections
        >= this.getEffectiveMaxConnections()
    ) {
      throw new Error('Pool connection capacity is reserved');
    }

    if (!reservationHeld) this.pendingAcquisitionConnections++;
    const targetServer = server || this.selectServer();
    try {
      const conn = await createConnection(
        this.connections,
        this.config,
        this.proxyConfig,
        targetServer,
        (created) => this.handleConnectionError(created),
        this.network,
      );
      if (this.isShuttingDown) {
        conn.state = 'closed';
        try {
          conn.client.disconnect();
        } finally {
          this.connections.delete(conn.id);
        }
        throw new Error('Pool shut down while creating connection');
      }
      return conn;
    } finally {
      if (!reservationHeld) this.pendingAcquisitionConnections--;
    }
  }

  // Activate a connection for use
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

  // Process the waiting queue when a connection becomes available
  private processWaitingQueue(): void {
    processWaitingQueue(
      this.waitingQueue,
      // Re-evaluate the failover target at drain time so a released backup
      // socket cannot satisfy a request whose primary is still eligible.
      () => this.findIdleConnection(this.currentFailoverTarget()?.id),
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
    recordHealthCheckResultsForCycle(serverHealthResults, this.serverStats);

    // Update per-server health stats and database
    applyHealthCheckResults(
      serverHealthResults,
      this.serverStats,
      (serverId, errorType) => this.recordServerFailure(serverId, errorType),
      (serverId) => this.recordServerSuccess(serverId),
    );

    // After checking existing connections, ensure each server has at least one connection
    await this.ensureMinimumConnections();

    // Export metrics to Prometheus
    this.exportMetrics();
  }

  // Export pool metrics to Prometheus (called after each health check cycle)
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
      /* v8 ignore start -- delegate callback; error handling behavior is covered through handleConnectionError */
      (conn) => this.handleConnectionError(conn),
      /* v8 ignore stop */
      (serverId) => this.recordServerSuccess(serverId),
      (serverId, errorType) => this.recordServerFailure(serverId, errorType),
      (serverId, success, latencyMs, error) =>
        recordHealthCheckResult(this.serverStats, serverId, success, latencyMs, error),
      (serverId, isHealthy, failCount, errorMessage) =>
        updateServerHealthInDb(serverId, isHealthy, failCount, errorMessage),
      /* v8 ignore next -- delegate callback; connection creation behavior is covered in connectionManager tests */
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
      /* v8 ignore start -- delegate callbacks; class reconnection behavior is covered through direct methods */
      (client) => this.emit('subscriptionReconnected', client),
      (c) => this.handleConnectionError(c),
      /* v8 ignore stop */
      () => this.selectServer(),
      (server) => this.createConnection(server ?? undefined),
    );
    await this.wakeWaitingRequestsAfterConnectionLoss();
  }

  private async wakeWaitingRequestsAfterConnectionLoss(): Promise<void> {
    if (this.isShuttingDown || this.waitingQueue.length === 0) return;
    const failoverTarget = this.currentFailoverTarget();
    if (
      !this.findIdleConnection(failoverTarget?.id)
      && this.connections.size + this.pendingAcquisitionConnections
        < this.getEffectiveMaxConnections()
    ) {
      await this.createConnection(failoverTarget ?? undefined).catch((error) => {
        log.warn('Failed to restore capacity for queued pool requests', {
          error: getErrorMessage(error),
        });
      });
    }
    this.processWaitingQueue();
  }

  // Wrapper for testability and internal reuse.
  private findIdleConnection(serverId?: string): PooledConnection | null {
    return findIdleConnection(this.connections, serverId);
  }

  /**
   * The failover target the pool would currently route to, or null when the
   * strategy is not failover_only or no enabled servers exist. Pure/cheap:
   * never mutates roundRobinIndex and never calls the weighted selector.
   */
  private currentFailoverTarget(): ServerConfig | null {
    return currentFailoverTarget(this.config.loadBalancing, this.servers, this.serverStats);
  }

  /**
   * After a failed connection attempt to the current failover target,
   * re-evaluate the target once. If it changed and an idle socket exists
   * for the new target, hand it out immediately instead of leaving a dead
   * primary starving every request until periodic health checks catch up.
   * Returns null when no immediate alternative exists (caller falls
   * through to the queue).
   */
  private async rerouteAfterFailoverTargetFailure(
    failedTarget: ServerConfig,
    error: unknown,
    purpose: string | undefined,
    startTime: number,
  ): Promise<PooledConnectionHandle | null> {
    return rerouteAfterFailoverTargetFailure(
      failedTarget,
      error,
      purpose,
      startTime,
      this.config.loadBalancing,
      this.servers,
      this.serverStats,
      (serverId, errorType) => this.recordServerFailure(serverId, errorType),
      (serverId) => this.findIdleConnection(serverId),
      (conn, p, s) => this.activateConnection(conn, p, s),
    );
  }

  /**
   * Under failover_only, when the pool is already at effective capacity and
   * the current failover target has no idle socket, evict one idle
   * non-target, non-dedicated backup socket and create a connection to the
   * target with the freed slot. Delegates to failoverAcquisition.ts; see
   * that module for the full eviction/reroute rationale.
   */
  private async acquireByEvictingBackupForFailoverTarget(
    failoverTarget: ServerConfig,
    purpose: string | undefined,
    startTime: number,
  ): Promise<PooledConnectionHandle | null> {
    return acquireByEvictingBackupForFailoverTarget(
      failoverTarget,
      purpose,
      startTime,
      this.connections,
      this.config.loadBalancing,
      this.servers,
      this.serverStats,
      (serverId, errorType) => this.recordServerFailure(serverId, errorType),
      (serverId) => this.findIdleConnection(serverId),
      (conn, p, s) => this.activateConnection(conn, p, s),
      (target) => this.createConnection(target, false, true),
      () => this.isShuttingDown,
      () => { this.pendingAcquisitionConnections++; },
      () => { this.pendingAcquisitionConnections--; },
    );
  }

  /**
   * Read-only snapshot of the live operational configuration, for the
   * status projector.
   */
  getOperationalConfigSnapshot(): {
    loadBalancing: LoadBalancingStrategy;
    healthCheckIntervalMs: number;
    enabled: boolean;
  } {
    return getOperationalConfigSnapshot(this.config);
  }

  // Wrapper for testability and internal reuse.
  private async reconnectConnection(conn: PooledConnection): Promise<void> {
    await reconnectConnection(
      conn,
      this.config,
      this.connections,
      this.subscriptionConnectionId,
      (client) => this.emit('subscriptionReconnected', client),
      this.network,
      () => this.isShuttingDown,
    );
  }

  // Wrapper for testability and interval scheduling.
  private cleanupIdleConnections(): void {
    cleanupIdleConnections(this.connections, this.config.idleTimeoutMs, this.getEffectiveMinConnections());
  }

  // Wrapper for testability and interval scheduling.
  private async sendKeepalives(): Promise<void> {
    await sendKeepalives(this.connections, this.isShuttingDown);
  }
}
