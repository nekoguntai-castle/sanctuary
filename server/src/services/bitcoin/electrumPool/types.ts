/**
 * Electrum Pool Types
 *
 * Shared type definitions for the Electrum connection pool modules.
 */

import { ElectrumClient } from '../electrum';

/**
 * Load balancing strategies
 */
export type LoadBalancingStrategy = 'round_robin' | 'least_connections' | 'failover_only';

/**
 * Network type for pool operations
 */
export type NetworkType = 'mainnet' | 'testnet' | 'signet' | 'regtest';

/**
 * SOCKS5 proxy configuration (for Tor support)
 */
export interface ProxyConfig {
  enabled: boolean;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  useSsl: boolean;
  priority: number;
  enabled: boolean;
  // Capability flags
  supportsVerbose?: boolean | null; // null = unknown
}

/**
 * Per-server statistics
 */
export interface ServerStats {
  serverId: string;
  label: string;
  host: string;
  port: number;
  connectionCount: number;
  healthyConnections: number;
  totalRequests: number;
  failedRequests: number;
  isHealthy: boolean;
  lastHealthCheck: Date | null;
  // Backoff state
  consecutiveFailures: number;
  backoffLevel: number;
  cooldownUntil: Date | null;
  weight: number;
  // Health check history (most recent first)
  healthHistory: HealthCheckResult[];
  // Capability flags
  supportsVerbose?: boolean | null; // null = unknown
}

/**
 * Health check result for history tracking
 */
export interface HealthCheckResult {
  timestamp: Date;
  success: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Maximum number of health check results to keep per server
 */
export const MAX_HEALTH_HISTORY = 20;

/**
 * Backoff configuration
 */
export interface BackoffConfig {
  // Initial cooldown duration after first failure (ms)
  baseDelayMs: number;
  // Maximum cooldown duration (ms)
  maxDelayMs: number;
  // Number of consecutive failures before triggering backoff
  failureThreshold: number;
  // Number of consecutive successes needed to fully recover
  recoveryThreshold: number;
  // Weight reduction per backoff level (0.0 - 1.0)
  weightPenalty: number;
  // Minimum weight for a server (prevents complete exclusion)
  minWeight: number;
}

/**
 * Default backoff configuration
 */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: 30000,        // 30 seconds initial backoff
  maxDelayMs: 300000,        // 5 minutes max backoff
  failureThreshold: 2,       // 2 failures triggers backoff
  recoveryThreshold: 3,      // 3 successes for full recovery
  weightPenalty: 0.3,        // 30% weight reduction per level
  minWeight: 0.1,            // Never go below 10% weight
};

/**
 * Pool configuration options
 */
export interface ElectrumPoolConfig {
  // Pool mode
  enabled: boolean; // If false, acts as single connection (legacy mode)

  // Pool sizing
  minConnections: number;
  maxConnections: number;

  // Load balancing
  loadBalancing: LoadBalancingStrategy;

  // Connection lifecycle
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  healthCheckIntervalMs: number;

  // Acquisition
  acquisitionTimeoutMs: number;
  maxWaitingRequests: number;

  // Resilience
  maxReconnectAttempts: number;
  reconnectDelayMs: number;

  // Keepalive (to prevent servers from dropping idle connections)
  keepaliveIntervalMs: number;
}

/**
 * Default pool configuration
 */
export const DEFAULT_POOL_CONFIG: ElectrumPoolConfig = {
  enabled: true, // Set to false for single-connection mode
  minConnections: 1,
  maxConnections: 5,
  loadBalancing: 'round_robin',
  connectionTimeoutMs: 10000,
  idleTimeoutMs: 300000,
  healthCheckIntervalMs: 30000,
  acquisitionTimeoutMs: 5000,
  maxWaitingRequests: 100,
  maxReconnectAttempts: 3,
  reconnectDelayMs: 1000,
  keepaliveIntervalMs: 15000, // Ping idle connections every 15 seconds
};

/**
 * Connection states
 */
export type ConnectionState = 'idle' | 'active' | 'reconnecting' | 'closed';

/**
 * Pooled connection wrapper
 */
export interface PooledConnection {
  id: string;
  client: ElectrumClient;
  state: ConnectionState;
  createdAt: Date;
  lastUsedAt: Date;
  lastHealthCheck: Date;
  useCount: number;
  isDedicated: boolean;
  // Multi-server support
  serverId: string;
  serverLabel: string;
  serverHost: string;
  serverPort: number;
}

/**
 * Pool statistics
 */
export interface PoolStats {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalAcquisitions: number;
  averageAcquisitionTimeMs: number;
  healthCheckFailures: number;
  // Multi-server stats
  serverCount: number;
  servers: ServerStats[];
}

/**
 * Acquisition options
 */
export interface AcquireOptions {
  purpose?: string;
  timeoutMs?: number;
  network?: NetworkType;
}

/**
 * Connection handle returned to consumers
 */
export interface PooledConnectionHandle {
  client: ElectrumClient;
  release(): void;
  withClient<T>(fn: (client: ElectrumClient) => Promise<T>): Promise<T>;
}

/**
 * Waiting request in queue
 */
export interface WaitingRequest {
  resolve: (handle: PooledConnectionHandle) => void;
  reject: (error: Error) => void;
  timeoutId: NodeJS.Timeout;
  purpose?: string;
  startTime: number;
}

/**
 * Internal per-server state tracked by the pool
 */
export interface ServerState {
  totalRequests: number;
  failedRequests: number;
  lastHealthCheck: Date | null;
  isHealthy: boolean;
  // Backoff state
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  backoffLevel: number;
  cooldownUntil: Date | null;
  weight: number;
  // Health check history
  healthHistory: HealthCheckResult[];
}

/**
 * Create a fresh default server state
 */
export function createDefaultServerState(): ServerState {
  return {
    totalRequests: 0,
    failedRequests: 0,
    lastHealthCheck: null,
    isHealthy: true,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
    backoffLevel: 0,
    cooldownUntil: null,
    weight: 1.0,
    healthHistory: [],
  };
}
